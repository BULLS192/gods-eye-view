import * as Cesium from 'cesium';
import { registerDynamicCredit, TOMTOM_CREDIT } from './dataCredits.js';

const STATUS_URL = '/api/mobility/tomtom/status';
const SEGMENT_URL = '/api/mobility/tomtom/segment';
const INCIDENTS_URL = '/api/mobility/tomtom/incidents';
const ROUTE_URL = '/api/mobility/tomtom/route';
const HOUSTON_BBOX = '-95.90,29.40,-94.80,30.20';
const STATUS_TTL_MS = 5 * 60_000;
const INCIDENT_TTL_MS = 30 * 60_000;

const INCIDENT_TYPES = Object.freeze({
  0: 'Unknown', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain',
  5: 'Ice', 6: 'Traffic jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road works',
  10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle',
});

function ensurePanel() {
  let panel = document.getElementById('tomtom-traffic-intel-panel');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = 'tomtom-traffic-intel-panel';
  panel.setAttribute('aria-label', 'TomTom traffic intelligence');
  Object.assign(panel.style, {
    position: 'fixed', left: '18px', bottom: '18px', zIndex: '1190', width: 'min(390px, calc(100vw - 36px))',
    maxHeight: '48vh', overflow: 'auto', padding: '12px 14px', border: '1px solid rgba(80,255,145,.4)',
    background: 'rgba(5,18,13,.91)', color: '#e7fff1', font: '12px/1.4 "JetBrains Mono", monospace',
    boxShadow: '0 8px 30px rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', display: 'none',
  });
  document.body.appendChild(panel);
  return panel;
}

function button(label, title, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.title = title;
  element.style.cssText = 'border:1px solid rgba(80,255,145,.38);background:rgba(8,45,28,.84);color:#e7fff1;padding:5px 7px;font:700 10px "JetBrains Mono",monospace;cursor:pointer;letter-spacing:.04em';
  element.addEventListener('click', onClick);
  return element;
}

function formatMinutes(seconds) {
  if (!Number.isFinite(Number(seconds))) return '—';
  const minutes = Math.max(0, Math.round(Number(seconds) / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function formatDistance(meters) {
  if (!Number.isFinite(Number(meters))) return '—';
  return `${(Number(meters) / 1609.344).toFixed(1)} mi`;
}

function congestionLabel(value) {
  if (!Number.isFinite(Number(value))) return 'UNKNOWN';
  if (value >= 65) return 'SEVERE';
  if (value >= 35) return 'HEAVY';
  if (value >= 15) return 'SLOW';
  return 'FREE FLOW';
}

function anchorForIncident(incident) {
  const geometry = incident?.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
  }
  const line = geometry.type === 'LineString' ? geometry.coordinates
    : geometry.type === 'MultiLineString' ? geometry.coordinates?.[0] : null;
  if (!Array.isArray(line) || !line.length) return null;
  const point = line[Math.floor(line.length / 2)];
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
    ? { lon: point[0], lat: point[1] } : null;
}

function incidentColor(category) {
  if (category === 8) return Cesium.Color.DARKRED;
  if (category === 7 || category === 9) return Cesium.Color.ORANGE;
  if (category === 11) return Cesium.Color.DODGERBLUE;
  if (category === 6) return Cesium.Color.RED;
  return Cesium.Color.YELLOW;
}

function pickGround(viewer, windowPosition) {
  if (!viewer?.scene || !windowPosition) return null;
  let cartesian = null;
  if (viewer.scene.pickPositionSupported) {
    try { cartesian = viewer.scene.pickPosition(windowPosition); } catch { cartesian = null; }
  }
  if (!cartesian) {
    const ray = viewer.camera.getPickRay(windowPosition);
    if (ray) cartesian = viewer.scene.globe.pick(ray, viewer.scene);
  }
  if (!cartesian) return null;
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  if (!cartographic) return null;
  return { lat: Cesium.Math.toDegrees(cartographic.latitude), lon: Cesium.Math.toDegrees(cartographic.longitude) };
}

function renderPanel(panel, state, actions) {
  if (!panel) return;
  panel.replaceChildren();
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:7px';
  const title = document.createElement('strong');
  title.textContent = 'LIVE TRAFFIC INTELLIGENCE';
  title.style.cssText = 'font-size:12px;letter-spacing:.08em;color:#7dffab';
  const live = document.createElement('span');
  live.textContent = state.configured ? 'TOMTOM · LIVE' : 'TOMTOM · KEY REQUIRED';
  live.style.cssText = `font-size:9px;color:${state.configured ? '#7dffab' : '#aaa'}`;
  header.append(title, live);
  panel.appendChild(header);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px';
  controls.append(
    button('⌖ INSPECT ROAD', 'Click a road to read current and free-flow speed', actions.inspect),
    button('A ROUTE START', 'Click the map to set route start', actions.routeStart),
    button('B ROUTE END', 'Click the map to set route destination', actions.routeEnd),
    button('CLEAR ROUTE', 'Clear route and route geometry', actions.clearRoute),
  );
  panel.appendChild(controls);

  if (state.mode) {
    const instruction = document.createElement('div');
    instruction.textContent = state.mode === 'inspect' ? 'CLICK A ROAD TO INSPECT LIVE SPEED'
      : state.mode === 'start' ? 'CLICK MAP TO SET ROUTE START'
        : 'CLICK MAP TO SET ROUTE DESTINATION';
    instruction.style.cssText = 'padding:5px 7px;margin-bottom:8px;background:rgba(90,255,150,.1);color:#aaffc3;font-weight:700;font-size:10px';
    panel.appendChild(instruction);
  }

  if (state.segment) {
    const segment = state.segment;
    const box = document.createElement('section');
    box.style.cssText = 'padding:8px;margin-bottom:8px;border:1px solid rgba(255,255,255,.1)';
    const heading = document.createElement('div');
    heading.textContent = `ROAD FLOW · ${congestionLabel(segment.congestionPct)}`;
    heading.style.cssText = 'font-weight:700;color:#7dffab;margin-bottom:4px';
    const text = document.createElement('div');
    text.textContent = segment.roadClosure
      ? 'ROAD CLOSED'
      : `${segment.currentSpeedMph ?? '—'} mph now · ${segment.freeFlowSpeedMph ?? '—'} mph free flow · ${segment.congestionPct ?? '—'}% speed loss`;
    const detail = document.createElement('div');
    detail.style.cssText = 'opacity:.68;font-size:10px;margin-top:3px';
    detail.textContent = `segment delay ${formatMinutes(segment.delaySec)} · confidence ${Number.isFinite(segment.confidence) ? Math.round(segment.confidence * 100) + '%' : '—'} · ${segment.frc || 'road'}`;
    box.append(heading, text, detail);
    panel.appendChild(box);
  }

  if (state.route) {
    const route = state.route;
    const s = route.summary || {};
    const box = document.createElement('section');
    box.style.cssText = 'padding:8px;margin-bottom:8px;border:1px solid rgba(75,200,255,.25);background:rgba(8,28,45,.35)';
    const heading = document.createElement('div');
    heading.textContent = 'TRAFFIC-AWARE ROUTE';
    heading.style.cssText = 'font-weight:700;color:#8edcff;margin-bottom:4px';
    const eta = document.createElement('div');
    eta.textContent = `${formatDistance(s.lengthMeters)} · ETA ${formatMinutes(s.travelTimeSec)} · traffic delay +${formatMinutes(s.trafficDelaySec)}`;
    const base = document.createElement('div');
    base.style.cssText = 'opacity:.7;font-size:10px;margin-top:3px';
    base.textContent = `no-traffic ${formatMinutes(s.noTrafficTravelTimeSec)} · traffic affected ${formatDistance(s.trafficLengthMeters)}`;
    box.append(heading, eta, base);
    panel.appendChild(box);
  }

  if (state.selectedIncident) {
    const incident = state.selectedIncident;
    const p = incident.properties || {};
    const box = document.createElement('section');
    box.style.cssText = 'padding:8px;margin-bottom:8px;border:1px solid rgba(255,120,80,.3);background:rgba(45,14,8,.32)';
    const heading = document.createElement('div');
    heading.textContent = `TOMTOM INCIDENT · ${INCIDENT_TYPES[p.iconCategory] || 'Traffic event'}`;
    heading.style.cssText = 'font-weight:700;color:#ffab8c;margin-bottom:4px';
    const event = p.events?.[0]?.description || `${p.from || ''}${p.to ? ` → ${p.to}` : ''}` || 'Traffic incident';
    const text = document.createElement('div');
    text.textContent = event;
    const detail = document.createElement('div');
    detail.style.cssText = 'opacity:.7;font-size:10px;margin-top:3px';
    detail.textContent = `${p.roadNumbers?.join(', ') || 'road'} · delay ${formatMinutes(p.delay)} · length ${formatDistance(p.length)} · ${p.probabilityOfOccurrence || 'present'}`;
    box.append(heading, text, detail);
    panel.appendChild(box);
  }

  const usage = state.usage || {};
  const footer = document.createElement('div');
  footer.style.cssText = 'opacity:.5;font-size:9px;border-top:1px solid rgba(255,255,255,.07);padding-top:6px';
  footer.textContent = `TomTom calls today · road ${usage.segment?.used ?? 0}/${usage.segment?.limit ?? '—'} · incidents ${usage.incidents?.used ?? 0}/${usage.incidents?.limit ?? '—'} · routes ${usage.route?.used ?? 0}/${usage.route?.limit ?? '—'} · ${state.incidents.length} Houston incidents`;
  panel.appendChild(footer);
}

export function createTomTomTrafficIntelLayer() {
  let viewer = null;
  let source = null;
  let panel = null;
  let clickHandler = null;
  let enabled = false;
  let lastStatusAt = 0;
  let lastIncidentsAt = 0;
  let lastUpdate = null;
  let error = null;
  let state = {
    configured: false, usage: null, incidents: [], selectedIncident: null,
    segment: null, route: null, start: null, end: null, mode: null,
  };
  const incidentByEntityId = new Map();

  const rerender = () => renderPanel(panel, state, actions);

  const setMode = (mode) => {
    state = { ...state, mode };
    rerender();
  };

  const clearRoute = () => {
    state = { ...state, route: null, start: null, end: null, mode: null };
    if (source) {
      for (const entity of [...source.entities.values]) {
        if (String(entity.id).startsWith('tomtom-route:') || String(entity.id).startsWith('tomtom-route-point:')) source.entities.remove(entity);
      }
    }
    rerender();
  };

  async function inspectPoint(point) {
    try {
      const url = new URL(SEGMENT_URL, window.location.origin);
      url.searchParams.set('lat', point.lat);
      url.searchParams.set('lon', point.lon);
      const response = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state = { ...state, segment: payload, usage: { ...(state.usage || {}), segment: payload.usage }, mode: null };
      source.entities.removeById('tomtom-road-inspection');
      source.entities.add({ id: 'tomtom-road-inspection', position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 8), point: { pixelSize: 10, color: Cesium.Color.LIME, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: 150000 } });
      rerender();
    } catch (caught) {
      error = `Road inspection ${caught?.message || 'failed'}`;
      state = { ...state, mode: null };
      rerender();
    }
  }

  async function calculateRoute() {
    if (!state.start || !state.end) return;
    try {
      const url = new URL(ROUTE_URL, window.location.origin);
      url.searchParams.set('start', `${state.start.lat},${state.start.lon}`);
      url.searchParams.set('end', `${state.end.lat},${state.end.lon}`);
      const response = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state = { ...state, route: payload, usage: { ...(state.usage || {}), route: payload.usage }, mode: null };
      source.entities.removeById('tomtom-route:active');
      const degrees = [];
      for (const point of payload.points || []) {
        if (Number.isFinite(point?.longitude) && Number.isFinite(point?.latitude)) degrees.push(point.longitude, point.latitude);
      }
      if (degrees.length >= 4) source.entities.add({ id: 'tomtom-route:active', polyline: { positions: Cesium.Cartesian3.fromDegreesArray(degrees), width: 6, material: Cesium.Color.CYAN.withAlpha(0.85), clampToGround: true } });
      rerender();
    } catch (caught) {
      error = `Route ${caught?.message || 'failed'}`;
      state = { ...state, mode: null };
      rerender();
    }
  }

  const actions = {
    inspect: () => setMode('inspect'),
    routeStart: () => setMode('start'),
    routeEnd: () => setMode('end'),
    clearRoute,
  };

  async function refreshStatus(force = false) {
    if (!force && lastStatusAt && Date.now() - lastStatusAt < STATUS_TTL_MS) return;
    const response = await fetch(STATUS_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`status HTTP ${response.status}`);
    const payload = await response.json();
    state = { ...state, configured: payload.configured === true, usage: payload.usage || state.usage };
    lastStatusAt = Date.now();
    if (state.configured) registerDynamicCredit(viewer, TOMTOM_CREDIT);
  }

  async function refreshIncidents(force = false) {
    if (!state.configured) return;
    if (!force && lastIncidentsAt && Date.now() - lastIncidentsAt < INCIDENT_TTL_MS) return;
    const url = new URL(INCIDENTS_URL, window.location.origin);
    url.searchParams.set('bbox', HOUSTON_BBOX);
    const response = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `incidents HTTP ${response.status}`);
    state = { ...state, incidents: payload.incidents || [], usage: { ...(state.usage || {}), incidents: payload.usage } };
    lastIncidentsAt = Date.now();
    incidentByEntityId.clear();
    for (const entity of [...source.entities.values]) if (String(entity.id).startsWith('tomtom-incident:')) source.entities.remove(entity);
    for (const incident of state.incidents.slice(0, 180)) {
      const anchor = anchorForIncident(incident);
      if (!anchor) continue;
      const id = `tomtom-incident:${incident.properties?.id || Math.random().toString(36).slice(2)}`;
      incidentByEntityId.set(id, incident);
      const category = Number(incident.properties?.iconCategory);
      source.entities.add({ id, position: Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, 18), point: { pixelSize: 8, color: incidentColor(category).withAlpha(0.9), outlineColor: Cesium.Color.WHITE.withAlpha(0.7), outlineWidth: 1, disableDepthTestDistance: 180000 } });
    }
  }

  return {
    id: 'tomtom-traffic-intel',
    name: 'TomTom Traffic Intelligence',
    icon: '🚦',
    source: 'TomTom Traffic · live',
    showInTogglePanel: false,
    updateInterval: 120_000,

    init(targetViewer) {
      viewer = targetViewer;
      source = new Cesium.CustomDataSource('tomtom-traffic-intel');
      source.show = false;
      viewer.dataSources.add(source);
      panel = ensurePanel();
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction(async (movement) => {
        const picked = viewer.scene.pick(movement.position);
        const id = picked?.id?.id;
        if (typeof id === 'string' && id.startsWith('tomtom-incident:')) {
          state = { ...state, selectedIncident: incidentByEntityId.get(id) || null };
          rerender();
          return;
        }
        if (!state.mode) return;
        const point = pickGround(viewer, movement.position);
        if (!point) return;
        if (state.mode === 'inspect') return inspectPoint(point);
        if (state.mode === 'start') {
          state = { ...state, start: point, mode: null };
          source.entities.removeById('tomtom-route-point:start');
          source.entities.add({ id: 'tomtom-route-point:start', position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 10), point: { pixelSize: 11, color: Cesium.Color.LIME, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 } });
        } else if (state.mode === 'end') {
          state = { ...state, end: point, mode: null };
          source.entities.removeById('tomtom-route-point:end');
          source.entities.add({ id: 'tomtom-route-point:end', position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 10), point: { pixelSize: 11, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 } });
        }
        rerender();
        if (state.start && state.end) await calculateRoute();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    },

    async enable() {
      enabled = true;
      if (source) source.show = true;
      if (panel) panel.style.display = 'block';
      await this.update(viewer, true);
    },

    disable() {
      enabled = false;
      if (source) source.show = false;
      if (panel) panel.style.display = 'none';
    },

    async update(_viewer, force = false) {
      try {
        await refreshStatus(force);
        if (state.configured) await refreshIncidents(force);
        lastUpdate = Date.now();
        error = null;
        rerender();
        if (panel) panel.style.display = enabled ? 'block' : 'none';
        return true;
      } catch (caught) {
        error = `TomTom intelligence ${caught?.message || 'unavailable'}`;
        rerender();
        return false;
      }
    },

    destroy(targetViewer) {
      const activeViewer = targetViewer || viewer;
      clickHandler?.destroy();
      clickHandler = null;
      if (source && activeViewer) activeViewer.dataSources.remove(source, true);
      source = null;
      viewer = null;
      if (panel?.isConnected) panel.remove();
      panel = null;
      incidentByEntityId.clear();
    },

    getStats() {
      return {
        count: state.incidents.length + (state.segment ? 1 : 0) + (state.route ? 1 : 0),
        lastUpdate, error,
        source: 'TomTom Traffic Intelligence',
        mode: state.configured ? 'live' : 'off',
        truthStatus: state.configured ? 'LIVE' : 'UNAVAILABLE',
        configured: state.configured,
        incidents: state.incidents.length,
        roadInspection: state.segment,
        routeSummary: state.route?.summary || null,
        usage: state.usage,
      };
    },
  };
}

export default createTomTomTrafficIntelLayer();
