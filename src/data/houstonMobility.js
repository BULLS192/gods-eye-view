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
    position: 'fixed', right: '18px', bottom: '18px', zIndex: '1200', width: 'min(420px, calc(100vw - 36px))',
    maxHeight: '54vh', overflow: 'auto', padding: '12px 14px', border: '1px solid rgba(75,220,255,.45)',
    background: 'rgba(5,12,18,.9)', color: '#dffaff', font: '12px/1.4 "JetBrains Mono", monospace',
    boxShadow: '0 8px 30px rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', display: 'none',
  });
  document.body.appendChild(panel);
  return panel;
}

function actionButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.style.cssText = 'border:1px solid rgba(75,220,255,.45);background:rgba(10,34,45,.82);color:#dffaff;padding:5px 7px;font:700 10px "JetBrains Mono",monospace;cursor:pointer;letter-spacing:.04em';
  button.addEventListener('click', onClick);
  return button;
}

function truthChip(label, color, title) {
  const chip = document.createElement('span');
  chip.title = title;
  chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 5px;border:1px solid rgba(255,255,255,.1);font-size:9px;letter-spacing:.05em;white-space:nowrap';
  const dot = document.createElement('i');
  dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${color};display:inline-block`;
  const text = document.createElement('span');
  text.textContent = label;
  chip.append(dot, text);
  return chip;
}

function stripMarkup(value) {
  if (!value) return '';
  const element = document.createElement('div');
  element.innerHTML = String(value);
  return (element.textContent || element.innerText || '').replace(/\s+/g, ' ').trim();
}

function ageText(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

async function activateMobilityMode() {
  const manager = window.__godsEyeView?.dataManager;
  if (!manager?.setEnabled) return;
  const targets = ['traffic', 'cctv', 'bikeshare', 'local-firms'];
  await Promise.allSettled(targets.map((id) => manager.setEnabled(id, true, { origin: 'user' })));
}

function flyHouston() {
  const viewer = window.__godsEyeView?.viewer;
  if (!viewer?.camera) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-95.3698, 29.7604, 6_800),
    duration: 1.5,
  });
}

function focusItem(item, altitude = 1800) {
  const viewer = window.__godsEyeView?.viewer;
  const coords = item?.coordinates;
  if (!viewer?.camera || !coords) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, altitude),
    duration: 1.2,
  });
}

async function showNearbyCameras(item) {
  const manager = window.__godsEyeView?.dataManager;
  if (manager?.setEnabled) await manager.setEnabled('cctv', true, { origin: 'user' });
  focusItem(item, 1200);
}

function renderSelectedCard(panel, selected) {
  if (!selected) return;
  const card = document.createElement('section');
  card.style.cssText = 'margin:8px 0 10px;padding:9px;border:1px solid rgba(255,120,100,.4);background:rgba(50,12,10,.28)';
  const kicker = document.createElement('div');
  kicker.textContent = `${selected.feed === 'closures' ? 'ROAD / LANE CLOSURE' : 'TRAFFIC INCIDENT'} · NEAR LIVE`;
  kicker.style.cssText = 'color:#ff9b83;font-size:9px;font-weight:700;letter-spacing:.08em';
  const title = document.createElement('strong');
  title.textContent = selected.title || 'Houston TranStar update';
  title.style.cssText = 'display:block;margin:4px 0;color:#fff';
  card.append(kicker, title);

  const description = stripMarkup(selected.description);
  if (description) {
    const body = document.createElement('div');
    body.textContent = description.slice(0, 520);
    body.style.cssText = 'opacity:.86;margin-bottom:6px';
    card.appendChild(body);
  }

  const meta = document.createElement('div');
  const age = ageText(selected.published);
  meta.textContent = `Houston TranStar${age ? ` · ${age}` : ''}${selected.coordinates ? ` · ${selected.coordinates.lat.toFixed(4)}, ${selected.coordinates.lon.toFixed(4)}` : ''}`;
  meta.style.cssText = 'font-size:9px;opacity:.64;margin-bottom:7px';
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  actions.append(
    actionButton('⌖ FOCUS', 'Fly to this incident', () => focusItem(selected)),
    actionButton('📹 CAMERAS', 'Enable CCTV and focus near this incident', () => showNearbyCameras(selected)),
  );
  if (selected.link) {
    const link = document.createElement('a');
    link.href = selected.link;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'SOURCE ↗';
    link.style.cssText = 'border:1px solid rgba(75,220,255,.35);color:#7eeaff;padding:5px 7px;text-decoration:none;font-size:10px;font-weight:700';
    actions.appendChild(link);
  }
  card.appendChild(actions);
  panel.appendChild(card);
}

function renderPanel(panel, snapshot, selectItem) {
  if (!panel) return;
  panel.replaceChildren();
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px';
  const title = document.createElement('strong');
  title.textContent = 'HOUSTON MOBILITY';
  title.style.cssText = 'font-size:13px;letter-spacing:.08em';
  const status = document.createElement('span');
  status.textContent = snapshot.tomtomLive ? 'TRAFFIC FLOW · LIVE' : 'TRAFFIC FLOW · SIMULATED';
  status.style.opacity = '.8';
  header.append(title, status);
  panel.appendChild(header);

  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px';
  legend.append(
    truthChip('LIVE', '#35df72', 'Direct current/live feed'),
    truthChip('NEAR LIVE', '#7eeaff', 'Current feed with a short publication/cache delay'),
    truthChip('MODELED', '#c39cff', 'Calculated/model output rather than a direct sensor observation'),
    truthChip('MAPPED', '#ffffff', 'Static mapped infrastructure'),
    truthChip('SIMULATED', '#9a9a9a', 'Visualization only — not live traffic'),
  );
  panel.appendChild(legend);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:0 0 9px';
  actions.append(
    actionButton('🚗 MOBILITY MODE', 'Turn on traffic, cameras, bikeshare and civilian public data', activateMobilityMode),
    actionButton('⌖ HOUSTON VIEW', 'Fly to Houston at city traffic altitude', flyHouston),
  );
  panel.appendChild(actions);

  const companion = snapshot.companion || {};
  const aqi = companion.air?.aqi;
  const transit = companion.transit || {};
  const coastal = companion.coastal || {};
  const meta = document.createElement('div');
  meta.style.cssText = 'margin-bottom:9px;opacity:.8';
  meta.textContent = [
    `TranStar ${snapshot.incidents.length} incidents · ${snapshot.closures.length} closures`,
    `Transit ${transit.routes || 0} mapped segments · ${transit.stations || 0} stations`,
    `AQI ${Number.isFinite(aqi) ? Math.round(aqi) : '—'} (${companion.air?.truthStatus || 'MODELED'})`,
    `Coastal ${coastal.count || 0} stations`,
    `METRO ${snapshot.metroConfigured ? 'realtime connected' : 'realtime key optional'}`,
  ].join(' · ');
  panel.appendChild(meta);

  renderSelectedCard(panel, snapshot.selected);

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
      const row = document.createElement('button');
      row.type = 'button';
      row.textContent = item.title || item.header_text || item.short_header_text || 'Update';
      row.style.cssText = 'display:block;width:100%;text-align:left;border:0;border-top:1px solid rgba(255,255,255,.06);background:transparent;color:inherit;padding:4px 0;cursor:pointer;font:inherit';
      row.addEventListener('click', () => selectItem(item));
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
  let viewer = null;
  let source = null;
  let panel = null;
  let clickHandler = null;
  let enabled = false;
  let lastUpdate = null;
  let error = null;
  let companion = {};
  const itemsByEntityId = new Map();
  let snapshot = {
    incidents: [], closures: [], travel: [], metroAlerts: [], metroConfigured: false, tomtomLive: false, selected: null,
  };

  const selectItem = (item) => {
    snapshot = { ...snapshot, selected: item || null, companion };
    renderPanel(panel, snapshot, selectItem);
    if (panel) panel.style.display = enabled ? 'block' : 'none';
  };

  return {
    init(targetViewer) {
      viewer = targetViewer;
      source = new Cesium.CustomDataSource('houston-mobility');
      source.show = false;
      viewer.dataSources.add(source);
      panel = ensurePanel();
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const entityId = picked?.id?.id;
        if (typeof entityId !== 'string' || !entityId.startsWith('houston:')) return;
        const item = itemsByEntityId.get(entityId);
        if (item) selectItem(item);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    },
    enable() {
      enabled = true;
      if (source) source.show = true;
      if (panel) panel.style.display = 'block';
      renderPanel(panel, { ...snapshot, companion }, selectItem);
    },
    disable() {
      enabled = false;
      if (source) source.show = false;
      if (panel) panel.style.display = 'none';
    },
    setCompanionStats(next = {}) {
      companion = { ...companion, ...next };
      snapshot = { ...snapshot, companion };
      renderPanel(panel, snapshot, selectItem);
      if (panel) panel.style.display = enabled ? 'block' : 'none';
    },
    async update() {
      const results = await Promise.allSettled(FEEDS.map(async (feed) => {
        const response = await fetch(TRANSTAR_ENDPOINT(feed), { cache: 'no-store' });
        if (!response.ok) throw new Error(`${feed} HTTP ${response.status}`);
        return [feed, parseTranstarRss(await response.text(), feed)];
      }));
      const next = { ...snapshot, incidents: [], closures: [], travel: [], companion };
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
      itemsByEntityId.clear();
      let markerCount = 0;
      for (const feed of ['incidents', 'closures']) {
        const style = markerStyle(feed);
        for (const item of next[feed]) {
          if (markerCount >= MAX_MAP_MARKERS) break;
          const coords = item.coordinates;
          if (!coords) continue;
          const entityId = `houston:${item.id}`;
          itemsByEntityId.set(entityId, item);
          source.entities.add({
            id: entityId,
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
              description: stripMarkup(item.description),
              link: item.link,
              published: item.published,
              source: 'Houston TranStar',
              truthStatus: 'NEAR LIVE',
            },
          });
          markerCount += 1;
        }
      }

      snapshot = next;
      lastUpdate = Date.now();
      error = null;
      renderPanel(panel, snapshot, selectItem);
      if (panel) panel.style.display = enabled ? 'block' : 'none';
      return true;
    },
    destroy(targetViewer) {
      const activeViewer = targetViewer || viewer;
      if (source && activeViewer) activeViewer.dataSources.remove(source, true);
      source = null;
      clickHandler?.destroy();
      clickHandler = null;
      viewer = null;
      itemsByEntityId.clear();
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
        truthStatus: 'NEAR LIVE',
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
