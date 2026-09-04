const TRANSTAR_FEEDS = Object.freeze({
  incidents: 'https://traffic.houstontranstar.org/data/rss/incidents_rss.xml',
  closures: 'https://traffic.houstontranstar.org/data/rss/laneclosures_rss.xml',
  travel: 'https://traffic.houstontranstar.org/data/rss/traveltimes_rss.xml',
});

const CACHE_TTL_MS = 120_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const cache = new Map();

const TOMTOM_LIMIT_DEFAULTS = Object.freeze({ segment: 300, incidents: 50, route: 100 });
const TOMTOM_CACHE_MS = Object.freeze({ segment: 60_000, incidents: 30 * 60_000, route: 60_000 });
let tomtomUsage = { date: '', segment: 0, incidents: 0, route: 0 };

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function resetTomTomUsageIfNeeded() {
  const date = utcDay();
  if (tomtomUsage.date !== date) tomtomUsage = { date, segment: 0, incidents: 0, route: 0 };
}

function tomtomLimit(kind) {
  const envName = `TOMTOM_DAILY_${kind.toUpperCase()}_BUDGET`;
  const value = Number.parseInt(process.env[envName] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : TOMTOM_LIMIT_DEFAULTS[kind];
}

function tomtomConfigured() {
  return Boolean(String(process.env.TOMTOM_API_KEY || '').trim());
}

function tomtomUsageSnapshot() {
  resetTomTomUsageIfNeeded();
  return {
    date: tomtomUsage.date,
    segment: { used: tomtomUsage.segment, limit: tomtomLimit('segment') },
    incidents: { used: tomtomUsage.incidents, limit: tomtomLimit('incidents') },
    route: { used: tomtomUsage.route, limit: tomtomLimit('route') },
  };
}

function claimTomTom(kind) {
  resetTomTomUsageIfNeeded();
  const limit = tomtomLimit(kind);
  if (tomtomUsage[kind] >= limit) return false;
  tomtomUsage[kind] += 1;
  return true;
}

function boundedNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function parseLatLonPair(value) {
  const [latRaw, lonRaw] = String(value || '').split(',');
  const lat = boundedNumber(latRaw, -90, 90);
  const lon = boundedNumber(lonRaw, -180, 180);
  return lat === null || lon === null ? null : { lat, lon };
}

async function fetchTextBounded(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      'User-Agent': 'GodsEyeView-Mobility/1.0',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('response too large');
  return text;
}

async function fetchJsonBounded(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', 'User-Agent': 'GodsEyeView-Mobility/1.0', ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('response too large');
  return JSON.parse(text);
}

async function cachedText(key, url) {
  const now = Date.now();
  const current = cache.get(key);
  if (current && now - current.at < CACHE_TTL_MS) return { ...current, cached: true };
  const body = await fetchTextBounded(url);
  const next = { body, at: now };
  cache.set(key, next);
  return { ...next, cached: false };
}

async function cachedJson(key, ttlMs, loader) {
  const current = cache.get(key);
  if (current && Date.now() - current.at < ttlMs) return { body: current.body, cached: true };
  const body = await loader();
  cache.set(key, { body, at: Date.now() });
  return { body, cached: false };
}

async function handleTranstar(req, res, url) {
  const feed = String(url.searchParams.get('feed') || '').toLowerCase();
  const upstream = TRANSTAR_FEEDS[feed];
  if (!upstream) return json(res, 400, { error: 'invalid_feed' });
  try {
    const payload = await cachedText(`transtar:${feed}`, upstream);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-GEV-Source', 'Houston TranStar RSS');
    res.setHeader('X-GEV-Cached', payload.cached ? '1' : '0');
    res.end(payload.body);
  } catch (error) {
    const stale = cache.get(`transtar:${feed}`);
    if (stale?.body) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('X-GEV-Source', 'Houston TranStar RSS');
      res.setHeader('X-GEV-Stale', '1');
      res.end(stale.body);
      return;
    }
    json(res, 502, { error: 'transtar_unavailable', detail: String(error?.message || error) });
  }
}

function metroConfigured() {
  return Boolean(String(process.env.METRO_API_KEY || '').trim());
}

async function handleMetroAlerts(req, res) {
  const key = String(process.env.METRO_API_KEY || '').trim();
  if (!key) return json(res, 503, { error: 'no_key', configured: false });
  const cacheKey = 'metro:alerts';
  const current = cache.get(cacheKey);
  if (current && Date.now() - current.at < 60_000) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(current.body);
    return;
  }
  try {
    const response = await fetch(`https://api.ridemetro.org/v2alerts/alerts?subscription-key=${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('response too large');
    cache.set(cacheKey, { body, at: Date.now() });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(body);
  } catch (error) {
    json(res, 502, { error: 'metro_unavailable', detail: String(error?.message || error) });
  }
}

async function handleTomTomSegment(res, url) {
  if (!tomtomConfigured()) return json(res, 503, { error: 'no_key' });
  const lat = boundedNumber(url.searchParams.get('lat'), -90, 90);
  const lon = boundedNumber(url.searchParams.get('lon'), -180, 180);
  if (lat === null || lon === null) return json(res, 400, { error: 'invalid_point' });
  const cacheKey = `tomtom:segment:${lat.toFixed(4)},${lon.toFixed(4)}`;
  try {
    const payload = await cachedJson(cacheKey, TOMTOM_CACHE_MS.segment, async () => {
      if (!claimTomTom('segment')) throw new Error('budget');
      const endpoint = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/relative/12/json');
      endpoint.searchParams.set('key', process.env.TOMTOM_API_KEY);
      endpoint.searchParams.set('point', `${lat},${lon}`);
      endpoint.searchParams.set('unit', 'mph');
      endpoint.searchParams.set('openLr', 'false');
      return fetchJsonBounded(endpoint.toString());
    });
    const data = payload.body?.flowSegmentData || payload.body || {};
    const currentSpeed = Number(data.currentSpeed);
    const freeFlowSpeed = Number(data.freeFlowSpeed);
    const currentTravelTime = Number(data.currentTravelTime);
    const freeFlowTravelTime = Number(data.freeFlowTravelTime);
    const ratio = Number.isFinite(currentSpeed) && Number.isFinite(freeFlowSpeed) && freeFlowSpeed > 0
      ? Math.max(0, Math.min(1, currentSpeed / freeFlowSpeed)) : null;
    json(res, 200, {
      source: 'TomTom Traffic Flow Segment Data', cached: payload.cached,
      point: { lat, lon }, frc: data.frc || null,
      currentSpeedMph: Number.isFinite(currentSpeed) ? currentSpeed : null,
      freeFlowSpeedMph: Number.isFinite(freeFlowSpeed) ? freeFlowSpeed : null,
      congestionPct: ratio === null ? null : Math.round((1 - ratio) * 100),
      currentTravelTimeSec: Number.isFinite(currentTravelTime) ? currentTravelTime : null,
      freeFlowTravelTimeSec: Number.isFinite(freeFlowTravelTime) ? freeFlowTravelTime : null,
      delaySec: Number.isFinite(currentTravelTime) && Number.isFinite(freeFlowTravelTime)
        ? Math.max(0, currentTravelTime - freeFlowTravelTime) : null,
      confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
      roadClosure: Boolean(data.roadClosure), coordinates: data.coordinates || null,
      usage: tomtomUsageSnapshot().segment,
    });
  } catch (error) {
    const message = String(error?.message || error);
    json(res, message === 'budget' ? 429 : 502, { error: message === 'budget' ? 'budget' : 'tomtom_segment_unavailable', detail: message });
  }
}

async function handleTomTomIncidents(res, url) {
  if (!tomtomConfigured()) return json(res, 503, { error: 'no_key' });
  const bboxRaw = url.searchParams.get('bbox') || '-95.90,29.40,-94.80,30.20';
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return json(res, 400, { error: 'invalid_bbox' });
  let [west, south, east, north] = parts;
  west = Math.max(-180, Math.min(180, west)); east = Math.max(-180, Math.min(180, east));
  south = Math.max(-90, Math.min(90, south)); north = Math.max(-90, Math.min(90, north));
  if (east <= west || north <= south || east - west > 3 || north - south > 3) return json(res, 400, { error: 'bbox_too_large' });
  const normalizedBbox = `${west.toFixed(3)},${south.toFixed(3)},${east.toFixed(3)},${north.toFixed(3)}`;
  const cacheKey = `tomtom:incidents:${normalizedBbox}`;
  try {
    const payload = await cachedJson(cacheKey, TOMTOM_CACHE_MS.incidents, async () => {
      if (!claimTomTom('incidents')) throw new Error('budget');
      const endpoint = new URL('https://api.tomtom.com/traffic/services/5/incidentDetails');
      endpoint.searchParams.set('key', process.env.TOMTOM_API_KEY);
      endpoint.searchParams.set('bbox', normalizedBbox);
      endpoint.searchParams.set('language', 'en-US');
      endpoint.searchParams.set('timeValidityFilter', 'present');
      endpoint.searchParams.set('fields', '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence,numberOfReports,lastReportTime}}}');
      return fetchJsonBounded(endpoint.toString());
    });
    const incidents = Array.isArray(payload.body?.incidents) ? payload.body.incidents.slice(0, 200) : [];
    json(res, 200, { source: 'TomTom Traffic Incident Details', cached: payload.cached, bbox: normalizedBbox, incidents, usage: tomtomUsageSnapshot().incidents });
  } catch (error) {
    const message = String(error?.message || error);
    json(res, message === 'budget' ? 429 : 502, { error: message === 'budget' ? 'budget' : 'tomtom_incidents_unavailable', detail: message });
  }
}

async function handleTomTomRoute(res, url) {
  if (!tomtomConfigured()) return json(res, 503, { error: 'no_key' });
  const start = parseLatLonPair(url.searchParams.get('start'));
  const end = parseLatLonPair(url.searchParams.get('end'));
  if (!start || !end) return json(res, 400, { error: 'invalid_route_points' });
  const cacheKey = `tomtom:route:${start.lat.toFixed(4)},${start.lon.toFixed(4)}:${end.lat.toFixed(4)},${end.lon.toFixed(4)}`;
  try {
    const payload = await cachedJson(cacheKey, TOMTOM_CACHE_MS.route, async () => {
      if (!claimTomTom('route')) throw new Error('budget');
      const endpoint = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${start.lat},${start.lon}:${end.lat},${end.lon}/json`);
      endpoint.searchParams.set('key', process.env.TOMTOM_API_KEY);
      endpoint.searchParams.set('traffic', 'true');
      endpoint.searchParams.set('travelMode', 'car');
      endpoint.searchParams.set('routeType', 'fastest');
      endpoint.searchParams.set('routeRepresentation', 'polyline');
      endpoint.searchParams.set('computeTravelTimeFor', 'all');
      endpoint.searchParams.set('sectionType', 'traffic');
      return fetchJsonBounded(endpoint.toString());
    });
    const route = payload.body?.routes?.[0];
    if (!route) return json(res, 502, { error: 'no_route' });
    const summary = route.summary || {};
    const points = (route.legs || []).flatMap((leg) => Array.isArray(leg.points) ? leg.points : []).slice(0, 5000);
    json(res, 200, {
      source: 'TomTom Routing', cached: payload.cached, start, end,
      summary: {
        lengthMeters: summary.lengthInMeters ?? null,
        travelTimeSec: summary.travelTimeInSeconds ?? null,
        trafficDelaySec: summary.trafficDelayInSeconds ?? null,
        trafficLengthMeters: summary.trafficLengthInMeters ?? null,
        noTrafficTravelTimeSec: summary.noTrafficTravelTimeInSeconds ?? null,
        historicTrafficTravelTimeSec: summary.historicTrafficTravelTimeInSeconds ?? null,
        liveTrafficTravelTimeSec: summary.liveTrafficIncidentsTravelTimeInSeconds ?? null,
        departureTime: summary.departureTime ?? null,
        arrivalTime: summary.arrivalTime ?? null,
      },
      points, usage: tomtomUsageSnapshot().route,
    });
  } catch (error) {
    const message = String(error?.message || error);
    json(res, message === 'budget' ? 429 : 502, { error: message === 'budget' ? 'budget' : 'tomtom_route_unavailable', detail: message });
  }
}

export function mobilityProxyPlugin() {
  return {
    name: 'gev-civilian-mobility-proxy',
    configureServer(server) {
      server.middlewares.use('/api/mobility', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const url = new URL(req.url || '/', 'http://local');
        const path = url.pathname.replace(/\/+$/, '') || '/';
        if (path === '/transtar') return handleTranstar(req, res, url);
        if (path === '/metro/status') return json(res, 200, { configured: metroConfigured() });
        if (path === '/metro/alerts') return handleMetroAlerts(req, res);
        if (path === '/tomtom/status') return json(res, 200, { configured: tomtomConfigured(), usage: tomtomUsageSnapshot() });
        if (path === '/tomtom/segment') return handleTomTomSegment(res, url);
        if (path === '/tomtom/incidents') return handleTomTomIncidents(res, url);
        if (path === '/tomtom/route') return handleTomTomRoute(res, url);
        return next();
      });
    },
  };
}

export default mobilityProxyPlugin;
