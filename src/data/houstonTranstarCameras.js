import * as Cesium from 'cesium';

const TXDOT_CAMERA_SERVICES = [
  'https://services1.arcgis.com/7DRakJXKPEhwv0fM/ArcGIS/rest/services/TxDOT_CCTV_Locations/FeatureServer/0/query',
  'https://services1.arcgis.com/7DRakJXKPEhwv0fM/ArcGIS/rest/services/TxDOT_CCTV_Locations_MiddleHUC6s/FeatureServer/0/query',
];
const TRANSTAR_CAMERA_MAP = 'https://traffic.houstontranstar.org/layers/layers.aspx?cam=True';
const HOUSTON_BBOX = Object.freeze({ west: -96.35, south: 28.95, east: -94.55, north: 30.45 });
const MAX_CAMERAS = 900;
const NEAREST_COUNT = 8;
const CATALOG_REFRESH_MS = 24 * 60 * 60_000;

function queryUrl(base) {
  const url = new URL(base);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', `${HOUSTON_BBOX.west},${HOUSTON_BBOX.south},${HOUSTON_BBOX.east},${HOUSTON_BBOX.north}`);
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'OBJECTID,District_Name,Equipment_Name,roadway,Direction,latitude,longitude');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('resultRecordCount', String(MAX_CAMERAS));
  url.searchParams.set('f', 'geojson');
  return url.toString();
}

async function fetchCatalog() {
  let lastError = null;
  for (const service of TXDOT_CAMERA_SERVICES) {
    try {
      const response = await fetch(queryUrl(service), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.features)) throw new Error('invalid GeoJSON');
      return payload.features;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('camera catalog unavailable');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCamera(feature, index) {
  const props = feature?.properties || {};
  const geometry = feature?.geometry;
  const geomLon = geometry?.type === 'Point' ? finite(geometry.coordinates?.[0]) : null;
  const geomLat = geometry?.type === 'Point' ? finite(geometry.coordinates?.[1]) : null;
  const lon = finite(props.longitude) ?? geomLon;
  const lat = finite(props.latitude) ?? geomLat;
  if (lat === null || lon === null || lat < HOUSTON_BBOX.south || lat > HOUSTON_BBOX.north || lon < HOUSTON_BBOX.west || lon > HOUSTON_BBOX.east) return null;
  const equipment = String(props.Equipment_Name || props.equipment_name || '').trim();
  const roadway = String(props.roadway || props.Roadway || '').trim();
  const direction = String(props.Direction || props.direction || '').trim();
  return {
    id: String(props.OBJECTID ?? feature.id ?? index),
    name: equipment || roadway || `TxDOT camera ${index + 1}`,
    roadway: roadway || 'Houston-area roadway',
    direction,
    district: String(props.District_Name || '').trim(),
    lat,
    lon,
    officialUrl: TRANSTAR_CAMERA_MAP,
  };
}

function haversineMiles(a, b) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function viewCenter(viewer) {
  if (!viewer?.scene?.canvas) return null;
  const canvas = viewer.scene.canvas;
  const screen = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let cartesian = null;
  try {
    const ray = viewer.camera.getPickRay(screen);
    if (ray) cartesian = viewer.scene.globe.pick(ray, viewer.scene);
  } catch {
    cartesian = null;
  }
  if (!cartesian) {
    try { cartesian = viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid); } catch { cartesian = null; }
  }
  if (!cartesian) return null;
  const position = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(position.latitude),
    lon: Cesium.Math.toDegrees(position.longitude),
  };
}

function nearestTo(cameras, point, count = NEAREST_COUNT) {
  if (!point) return [];
  return cameras
    .map((camera) => ({ ...camera, distanceMiles: haversineMiles(point, camera) }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, count);
}

function button(label, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.style.cssText = 'border:1px solid rgba(80,190,255,.45);background:rgba(7,28,42,.92);color:#dff7ff;padding:5px 7px;font:700 10px "JetBrains Mono",monospace;cursor:pointer';
  element.addEventListener('click', onClick);
  return element;
}

function externalLink(label, href) {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = label;
  link.style.cssText = 'display:inline-block;border:1px solid rgba(80,190,255,.38);color:#8bdcff;padding:4px 6px;text-decoration:none;font-size:10px;font-weight:700';
  return link;
}

function ensureUi(togglePanel) {
  let badge = document.getElementById('houston-camera-badge');
  let panel = document.getElementById('houston-camera-panel');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'houston-camera-badge';
    badge.type = 'button';
    badge.style.cssText = 'position:fixed;right:18px;top:76px;z-index:1195;border:1px solid rgba(80,190,255,.42);background:rgba(4,19,30,.88);color:#dff7ff;padding:6px 9px;font:700 10px "JetBrains Mono",monospace;cursor:pointer;display:none;box-shadow:0 5px 18px rgba(0,0,0,.3)';
    document.body.appendChild(badge);
  }
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'houston-camera-panel';
    panel.setAttribute('aria-label', 'Houston traffic cameras');
    panel.style.cssText = 'position:fixed;right:18px;top:112px;z-index:1195;width:min(370px,calc(100vw - 36px));max-height:52vh;overflow:auto;padding:11px 12px;border:1px solid rgba(80,190,255,.42);background:rgba(4,15,24,.94);color:#dff7ff;font:11px/1.4 "JetBrains Mono",monospace;box-shadow:0 8px 28px rgba(0,0,0,.38);display:none';
    document.body.appendChild(panel);
  }
  if (!badge.dataset.bound) {
    badge.dataset.bound = '1';
    badge.addEventListener('click', () => togglePanel());
  }
  return { badge, panel };
}

function renderPanel(panel, state, focusCamera) {
  if (!panel) return;
  panel.replaceChildren();
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:5px';
  const title = document.createElement('strong');
  title.textContent = '📹 HOUSTON TRAFFIC CAMERAS';
  title.style.cssText = 'font-size:12px;letter-spacing:.05em';
  const status = document.createElement('span');
  status.textContent = 'MAPPED LOCATIONS';
  status.style.cssText = 'font-size:9px;color:#90dfff';
  header.append(title, status);
  panel.appendChild(header);

  const note = document.createElement('div');
  note.textContent = 'TxDOT GIS camera-location catalog. Camera availability is checked on Houston TranStar; images/video are not proxied by God’s Eye View.';
  note.style.cssText = 'opacity:.65;font-size:9px;margin-bottom:8px';
  panel.appendChild(note);

  if (state.selected) {
    const selected = state.selected;
    const card = document.createElement('section');
    card.style.cssText = 'padding:8px;margin:0 0 8px;border:1px solid rgba(75,200,255,.28);background:rgba(8,35,52,.35)';
    const name = document.createElement('strong');
    name.textContent = selected.name;
    name.style.cssText = 'display:block;color:#fff;margin-bottom:3px';
    const meta = document.createElement('div');
    meta.textContent = `${selected.roadway}${selected.direction ? ` · ${selected.direction}` : ''} · ${selected.lat.toFixed(4)}, ${selected.lon.toFixed(4)}`;
    meta.style.cssText = 'opacity:.7;font-size:9px;margin-bottom:6px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap';
    actions.append(button('⌖ FOCUS', () => focusCamera(selected)), externalLink('OPEN TRANSTAR ↗', selected.officialUrl));
    card.append(name, meta, actions);
    panel.appendChild(card);
  }

  const heading = document.createElement('div');
  heading.textContent = `NEAREST TO MAP CENTER · ${state.nearest.length}`;
  heading.style.cssText = 'font-weight:700;color:#8bdcff;margin:6px 0 3px';
  panel.appendChild(heading);

  for (const camera of state.nearest) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;border-top:1px solid rgba(255,255,255,.06);padding:6px 0';
    const text = document.createElement('button');
    text.type = 'button';
    text.style.cssText = 'border:0;background:transparent;color:inherit;text-align:left;padding:0;cursor:pointer;font:inherit';
    text.textContent = `${camera.name} · ${camera.distanceMiles.toFixed(camera.distanceMiles < 10 ? 1 : 0)} mi`;
    text.title = `${camera.roadway}${camera.direction ? ` · ${camera.direction}` : ''}`;
    text.addEventListener('click', () => focusCamera(camera));
    row.append(text, externalLink('VIEW ↗', camera.officialUrl));
    panel.appendChild(row);
  }

  const footer = document.createElement('div');
  footer.textContent = `${state.cameras.length} mapped Houston-area CCTV locations · source catalog is static, not a live camera-health feed`;
  footer.style.cssText = 'opacity:.48;font-size:9px;margin-top:7px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px';
  panel.appendChild(footer);
}

export function createHoustonTranstarCameraLayer() {
  let viewer = null;
  let source = null;
  let clickHandler = null;
  let moveEndRemover = null;
  let badge = null;
  let panel = null;
  let enabled = false;
  let panelOpen = false;
  let lastCatalogAt = 0;
  let lastUpdate = null;
  let error = null;
  let state = { cameras: [], nearest: [], selected: null };
  const byEntityId = new Map();

  const focusCamera = (camera) => {
    if (!viewer?.camera || !camera) return;
    state = { ...state, selected: camera };
    panelOpen = true;
    if (panel) panel.style.display = enabled ? 'block' : 'none';
    renderPanel(panel, state, focusCamera);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 900),
      duration: 1.0,
    });
  };

  const refreshNearest = () => {
    if (!state.cameras.length || !viewer) return;
    state = { ...state, nearest: nearestTo(state.cameras, viewCenter(viewer)) };
    if (badge) badge.textContent = `📹 HOUSTON CCTV · ${state.cameras.length}`;
    if (panelOpen) renderPanel(panel, state, focusCamera);
  };

  const togglePanel = () => {
    panelOpen = !panelOpen;
    if (panel) panel.style.display = enabled && panelOpen ? 'block' : 'none';
    if (panelOpen) {
      refreshNearest();
      renderPanel(panel, state, focusCamera);
    }
  };

  return {
    id: 'houston-transtar-cameras',
    name: 'Houston Traffic Cameras',
    icon: '📹',
    source: 'TxDOT GIS locations · Houston TranStar viewer',
    showInTogglePanel: false,
    updateInterval: 60 * 60_000,

    init(targetViewer) {
      viewer = targetViewer;
      source = new Cesium.CustomDataSource('houston-transtar-cameras');
      source.show = false;
      viewer.dataSources.add(source);
      ({ badge, panel } = ensureUi(togglePanel));
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const entityId = picked?.id?.id;
        if (typeof entityId !== 'string' || !entityId.startsWith('txdot-camera:')) return;
        const camera = byEntityId.get(entityId);
        if (camera) focusCamera(camera);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      const listener = () => refreshNearest();
      viewer.camera.moveEnd.addEventListener(listener);
      moveEndRemover = () => viewer?.camera?.moveEnd?.removeEventListener(listener);
    },

    async enable() {
      enabled = true;
      if (source) source.show = true;
      if (badge) badge.style.display = 'block';
      if (panel) panel.style.display = panelOpen ? 'block' : 'none';
      await this.update();
    },

    disable() {
      enabled = false;
      if (source) source.show = false;
      if (badge) badge.style.display = 'none';
      if (panel) panel.style.display = 'none';
    },

    async update() {
      if (lastCatalogAt && Date.now() - lastCatalogAt < CATALOG_REFRESH_MS && state.cameras.length) {
        refreshNearest();
        return true;
      }
      try {
        const features = await fetchCatalog();
        const cameras = features.map(normalizeCamera).filter(Boolean).slice(0, MAX_CAMERAS);
        source.entities.removeAll();
        byEntityId.clear();
        for (const camera of cameras) {
          const entityId = `txdot-camera:${camera.id}`;
          byEntityId.set(entityId, camera);
          source.entities.add({
            id: entityId,
            position: Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 12),
            point: {
              pixelSize: 7,
              color: Cesium.Color.DODGERBLUE.withAlpha(0.9),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.7),
              outlineWidth: 1,
              disableDepthTestDistance: 150000,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 90000),
            },
            properties: {
              name: camera.name,
              roadway: camera.roadway,
              direction: camera.direction,
              source: 'TxDOT GIS camera location catalog',
              viewer: 'Houston TranStar',
              truthStatus: 'MAPPED',
            },
          });
        }
        state = { cameras, nearest: nearestTo(cameras, viewCenter(viewer)), selected: state.selected };
        lastCatalogAt = Date.now();
        lastUpdate = Date.now();
        error = null;
        refreshNearest();
        return cameras.length > 0;
      } catch (caught) {
        error = `Houston camera locations ${caught?.message || 'unavailable'}`;
        return false;
      }
    },

    showNearest(point) {
      if (!point || !state.cameras.length) return [];
      state = { ...state, nearest: nearestTo(state.cameras, point), selected: null };
      panelOpen = true;
      if (panel) panel.style.display = enabled ? 'block' : 'none';
      renderPanel(panel, state, focusCamera);
      return state.nearest;
    },

    destroy(targetViewer) {
      const activeViewer = targetViewer || viewer;
      moveEndRemover?.();
      moveEndRemover = null;
      clickHandler?.destroy();
      clickHandler = null;
      if (source && activeViewer) activeViewer.dataSources.remove(source, true);
      source = null;
      viewer = null;
      byEntityId.clear();
      if (badge?.isConnected) badge.remove();
      if (panel?.isConnected) panel.remove();
      badge = null;
      panel = null;
    },

    getStats() {
      return {
        count: state.cameras.length,
        lastUpdate,
        error,
        source: 'TxDOT GIS camera locations · Houston TranStar viewer',
        mode: state.cameras.length ? 'mapped' : 'unavailable',
        truthStatus: 'MAPPED',
        nearest: state.nearest.map(({ id, name, roadway, direction, lat, lon, distanceMiles, officialUrl }) => ({ id, name, roadway, direction, lat, lon, distanceMiles, officialUrl })),
      };
    },
  };
}

export default createHoustonTranstarCameraLayer();
