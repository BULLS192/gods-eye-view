import * as Cesium from 'cesium';

const FEEDS = Object.freeze(['incidents', 'closures', 'travel']);
const TRANSTAR_ENDPOINT = (feed) => `/api/mobility/transtar?feed=${encodeURIComponent(feed)}`;
const METRO_STATUS_ENDPOINT = '/api/mobility/metro/status';
const METRO_ALERTS_ENDPOINT = '/api/mobility/metro/alerts';
const TOMTOM_STATUS_ENDPOINT = '/api/tomtom/status';
const MAX_MAP_MARKERS = 180;
const MAX_PANEL_ITEMS = 6;

function textOf(node, names) {
  for (const name of names) {
    const exact = node.getElementsByTagName(name)?.[0];
    if (exact?.textContent?.trim()) return exact.textContent.trim();
    const all = node.getElementsByTagName('*');
    for (const child of all) {
      const local = String(child.localName || child.nodeName || '').toLowerCase();
      if (local === name.toLowerCase() && child.textContent?.trim()) return child.textContent.trim();
    }
  }
  return '';
}

function parseCoordinateText(value) {
  const numbers = String(value || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (numbers.length < 2) return null;
  const [a, b] = numbers;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lon: a };
  return null;
}

function coordsFromText(value) {
  const raw = String(value || '');
  const patterns = [
    /(?:lat|latitude)=(-?\d+(?:\.\d+)?)[^\d-]+(?:lon|lng|longitude)=(-?\d+(?:\.\d+)?)/i,
    /(?:lon|lng|longitude)=(-?\d+(?:\.\d+)?)[^\d-]+(?:lat|latitude)=(-?\d+(?:\.\d+)?)/i,
    /(?:y)=(-?\d+(?:\.\d+)?)[^\d-]+(?:x)=(-?\d+(?:\.\d+)?)/i,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = raw.match(patterns[i]);
    if (!match) continue;
    if (i === 1) return { lat: Number(match[2]), lon: Number(match[1]) };
    return { lat: Number(match[1]), lon: Number(match[2]) };
  }
  return null;
}

function itemCoordinates(item) {
  const point = textOf(item, ['point', 'georss:point']);
  const pointCoords = parseCoordinateText(point);
  if (pointCoords) return pointCoords;
  const lat = Number(textOf(item, ['lat', 'geo:lat', 'latitude']));
  const lon = Number(textOf(item, ['long', 'lon', 'lng', 'geo:long', 'longitude']));
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon };
  }
  return coordsFromText([
    textOf(item, ['link']),
    textOf(item, ['guid']),
    textOf(item, ['description']),
  ].join(' '));
}

export function parseTranstarRss(xmlText, feed) {
  const doc = new DOMParser().parseFromString(String(xmlText || ''), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('invalid TranStar RSS');
  return [...doc.querySelectorAll('item')].map((item, index) => ({
    id: `${feed}:${textOf(item, ['guid']) || index}`,
    feed,
    title: textOf(item, ['title']) || 'Houston TranStar update',
    description: textOf(item, ['description']),
    link: textOf(item, ['link']),
    published: textOf(item, ['pubDate', 'published']),
    coordinates: itemCoordinates(item),
  }));
}

function markerStyle(feed) {
  if (feed === 'incidents') return { color: Cesium.Color.RED, icon: '!' };
  if (feed === 'closures') return { color: Cesium.Color.ORANGE, icon: '×' };
  return { color: Cesium.Color.CYAN, icon: 'T' };
}

function ensurePanel() {
  let panel = document.getElementById('houston-mobility-panel');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = 'houston-mobility-panel';
  panel.setAttribute('aria-label', 'Houston mobility status');
  Object.assign(panel.style, {
    position: 'fixed', right: '18px', bottom: '18px', zIndex: '1200', width: 'min(390px, calc(100vw - 36px))',
    maxHeight: '46vh', overflow: 'auto', padding: '12px 14px', border: '1px solid rgba(75,220,255,.45)',
    background: 'rgba(5,12,18,.88)', color: '#dffaff', font: '12px/1.4 "JetBrains Mono", monospace',
    boxShadow: '0 8px 30px rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', display: 'none',
  });
  document.body.appendChild(panel);
  return panel;
}

function renderPanel(panel, snapshot) {
  if (!panel) return;
  panel.replaceChildren();
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px';
  const title = document.createElement('strong');
  title.textContent = 'HOUSTON MOBILITY';
  title.style.cssText = 'font-size:13px;letter-spacing:.08em';
  const status = document.createElement('span');
  status.textContent = snapshot.tomtomLive ? 'TRAFFIC FLOW · LIVE' : 'TRAFFIC FLOW · SIM';
  status.style.opacity = '.8';
  header.append(title, status);
  panel.appendChild(header);

  const meta = document.createElement('div');
  meta.style.cssText = 'margin-bottom:9px;opacity:.78';
  meta.textContent = `TranStar ${snapshot.incidents.length} incidents · ${snapshot.closures.length} closures · ${snapshot.travel.length} travel-time items · METRO ${snapshot.metroConfigured ? 'connected' : 'key optional'}`;
  panel.appendChild(meta);

  for (const [label, items] of [
    ['INCIDENTS', snapshot.incidents],
    ['CLOSURES', snapshot.closures],
    ['TRAVEL TIMES', snapshot.travel],
    ['METRO ALERTS', snapshot.metroAlerts],
  ]) {
    if (!items.length) continue;
    const section = document.createElement('section');
    const h = document.createElement('div');
    h.textContent = label;
    h.style.cssText = 'margin:8px 0 4px;color:#7eeaff;font-weight:700;letter-spacing:.06em';
    section.appendChild(h);
    for (const item of items.slice(0, MAX_PANEL_ITEMS)) {
      const row = document.createElement(item.link ? 'a' : 'div');
      if (item.link) {
        row.href = item.link;
        row.target = '_blank';
        row.rel = 'noopener';
      }
      row.textContent = item.title || item.header_text || item.short_header_text || 'Update';
      row.style.cssText = 'display:block;color:inherit;text-decoration:none;padding:3px 0;border-top:1px solid rgba(255,255,255,.06)';
      section.appendChild(row);
    }
    panel.appendChild(section);
  }
}

function metroArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.alerts)) return payload.alerts;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

export function createHoustonMobilityFeed() {
  let source = null;
  let panel = null;
  let enabled = false;
  let lastUpdate = null;
  let error = null;
  let snapshot = {
    incidents: [], closures: [], travel: [], metroAlerts: [], metroConfigured: false, tomtomLive: false,
  };

  return {
    init(viewer) {
      source = new Cesium.CustomDataSource('houston-mobility');
      source.show = false;
      viewer.dataSources.add(source);
      panel = ensurePanel();
    },
    enable() {
      enabled = true;
      if (source) source.show = true;
      if (panel) panel.style.display = 'block';
    },
    disable() {
      enabled = false;
      if (source) source.show = false;
      if (panel) panel.style.display = 'none';
    },
    async update() {
      const results = await Promise.allSettled(FEEDS.map(async (feed) => {
        const response = await fetch(TRANSTAR_ENDPOINT(feed), { cache: 'no-store' });
        if (!response.ok) throw new Error(`${feed} HTTP ${response.status}`);
        return [feed, parseTranstarRss(await response.text(), feed)];
      }));
      const next = { ...snapshot, incidents: [], closures: [], travel: [] };
      let successes = 0;
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const [feed, rows] = result.value;
        next[feed] = rows;
        successes += 1;
      }

      try {
        const statusResponse = await fetch(METRO_STATUS_ENDPOINT, { cache: 'no-store' });
        const metroStatus = statusResponse.ok ? await statusResponse.json() : {};
        next.metroConfigured = metroStatus.configured === true;
        if (next.metroConfigured) {
          const alertsResponse = await fetch(METRO_ALERTS_ENDPOINT, { cache: 'no-store' });
          if (alertsResponse.ok) next.metroAlerts = metroArray(await alertsResponse.json());
        } else {
          next.metroAlerts = [];
        }
      } catch {
        next.metroConfigured = false;
        next.metroAlerts = [];
      }

      try {
        const ttResponse = await fetch(TOMTOM_STATUS_ENDPOINT, { cache: 'no-store' });
        const tt = ttResponse.ok ? await ttResponse.json() : {};
        next.tomtomLive = Boolean(tt.configured || tt.hasKey || tt.enabled || tt.live);
      } catch {
        next.tomtomLive = false;
      }

      if (!successes) {
        error = 'Houston TranStar feeds unavailable';
        return false;
      }

      source.entities.removeAll();
      let markerCount = 0;
      for (const feed of ['incidents', 'closures']) {
        const style = markerStyle(feed);
        for (const item of next[feed]) {
          if (markerCount >= MAX_MAP_MARKERS) break;
          const coords = item.coordinates;
          if (!coords) continue;
          source.entities.add({
            id: `houston:${item.id}`,
            position: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 30),
            point: {
              pixelSize: feed === 'incidents' ? 11 : 9,
              color: style.color.withAlpha(0.9),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
              outlineWidth: 1,
              disableDepthTestDistance: 150000,
            },
            label: {
              text: style.icon,
              font: 'bold 11px monospace',
              fillColor: Cesium.Color.WHITE,
              pixelOffset: new Cesium.Cartesian2(0, -1),
              disableDepthTestDistance: 150000,
            },
            properties: {
              feed,
              title: item.title,
              description: item.description,
              link: item.link,
              published: item.published,
              source: 'Houston TranStar',
            },
          });
          markerCount += 1;
        }
      }

      snapshot = next;
      lastUpdate = Date.now();
      error = null;
      renderPanel(panel, snapshot);
      if (panel) panel.style.display = enabled ? 'block' : 'none';
      return true;
    },
    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
      if (panel?.isConnected) panel.remove();
      panel = null;
    },
    getStats() {
      return {
        count: snapshot.incidents.length + snapshot.closures.length + snapshot.travel.length + snapshot.metroAlerts.length,
        lastUpdate,
        error,
        source: 'Houston TranStar · METRO optional',
        mode: 'live',
        incidents: snapshot.incidents.length,
        closures: snapshot.closures.length,
        travelTimes: snapshot.travel.length,
        metroAlerts: snapshot.metroAlerts.length,
        metroConfigured: snapshot.metroConfigured,
        tomtomLive: snapshot.tomtomLive,
      };
    },
  };
}

export default createHoustonMobilityFeed();
