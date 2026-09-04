const TRANSTAR_FEEDS = Object.freeze({
  incidents: 'https://traffic.houstontranstar.org/data/rss/incidents_rss.xml',
  closures: 'https://traffic.houstontranstar.org/data/rss/laneclosures_rss.xml',
  travel: 'https://traffic.houstontranstar.org/data/rss/traveltimes_rss.xml',
});

const CACHE_TTL_MS = 120_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const cache = new Map();

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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

async function cachedText(key, url) {
  const now = Date.now();
  const current = cache.get(key);
  if (current && now - current.at < CACHE_TTL_MS) return { ...current, cached: true };
  const body = await fetchTextBounded(url);
  const next = { body, at: now };
  cache.set(key, next);
  return { ...next, cached: false };
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
        return next();
      });
    },
  };
}

export default mobilityProxyPlugin;
