import * as Cesium from 'cesium';

const OVERPASS_URL = '/api/overpass';
const HOUSTON_BOUNDS = { south: 29.45, west: -95.85, north: 30.15, east: -94.85 };
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_RAIL_WAYS = 450;
const MAX_STATIONS = 220;

function buildQuery() {
  const { south, west, north, east } = HOUSTON_BOUNDS;
  return `[out:json][timeout:25];(
    way["railway"~"^(light_rail|tram)$"](${south},${west},${north},${east});
    node["railway"~"^(station|tram_stop)$"](${south},${west},${north},${east});
    node["public_transport"="station"](${south},${west},${north},${east});
  );out geom qt;`;
}

async function fetchTransit() {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(buildQuery())}`,
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  return response.json();
}

function routeColor(tags = {}) {
  const ref = String(tags.ref || tags.name || '').toLowerCase();
  if (ref.includes('red')) return Cesium.Color.RED;
  if (ref.includes('green')) return Cesium.Color.LIMEGREEN;
  if (ref.includes('purple')) return Cesium.Color.MEDIUMPURPLE;
  return Cesium.Color.CYAN;
}

function stationName(tags = {}) {
  return String(tags.name || tags.ref || tags.local_ref || 'Transit station').trim();
}

export function createHoustonTransitLayer() {
  let source = null;
  let enabled = false;
  let lastUpdate = null;
  let error = null;
  let routeCount = 0;
  let stationCount = 0;

  return {
    id: 'houston-transit-mapped',
    name: 'Houston Transit Network',
    icon: '🚆',
    source: 'OpenStreetMap · mapped/static transit',
    updateInterval: REFRESH_INTERVAL_MS,
    showInTogglePanel: false,

    init(viewer) {
      source = new Cesium.CustomDataSource('houston-transit-mapped');
      source.show = false;
      viewer.dataSources.add(source);
    },

    enable() {
      enabled = true;
      if (source) source.show = true;
    },

    disable() {
      enabled = false;
      if (source) source.show = false;
    },

    async update() {
      if (lastUpdate && Date.now() - lastUpdate < REFRESH_INTERVAL_MS) return true;
      try {
        const payload = await fetchTransit();
        const elements = Array.isArray(payload?.elements) ? payload.elements : [];
        source.entities.removeAll();
        routeCount = 0;
        stationCount = 0;

        for (const element of elements) {
          if (element.type === 'way' && Array.isArray(element.geometry) && element.geometry.length >= 2) {
            if (routeCount >= MAX_RAIL_WAYS) continue;
            const degrees = [];
            for (const point of element.geometry) {
              if (!Number.isFinite(point?.lon) || !Number.isFinite(point?.lat)) continue;
              degrees.push(point.lon, point.lat);
            }
            if (degrees.length < 4) continue;
            const color = routeColor(element.tags);
            source.entities.add({
              id: `houston-transit-way:${element.id}`,
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(degrees),
                width: 4,
                material: color.withAlpha(0.82),
                clampToGround: true,
              },
              properties: {
                name: element.tags?.name || element.tags?.ref || 'Mapped light rail',
                source: 'OpenStreetMap',
                truthStatus: 'MAPPED',
              },
            });
            routeCount += 1;
            continue;
          }

          if (element.type !== 'node' || stationCount >= MAX_STATIONS) continue;
          if (!Number.isFinite(element.lon) || !Number.isFinite(element.lat)) continue;
          const name = stationName(element.tags);
          source.entities.add({
            id: `houston-transit-station:${element.id}`,
            position: Cesium.Cartesian3.fromDegrees(element.lon, element.lat, 8),
            point: {
              pixelSize: 7,
              color: Cesium.Color.WHITE.withAlpha(0.92),
              outlineColor: Cesium.Color.CYAN.withAlpha(0.9),
              outlineWidth: 2,
              disableDepthTestDistance: 120000,
            },
            label: {
              text: name.slice(0, 34),
              font: '10px monospace',
              fillColor: Cesium.Color.CYAN,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
              pixelOffset: new Cesium.Cartesian2(0, -13),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 45000),
              disableDepthTestDistance: 120000,
            },
            properties: {
              name,
              source: 'OpenStreetMap',
              truthStatus: 'MAPPED',
            },
          });
          stationCount += 1;
        }

        lastUpdate = Date.now();
        error = null;
        return true;
      } catch (caught) {
        error = `Transit map ${caught?.message || 'unavailable'}`;
        return false;
      }
    },

    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
      enabled = false;
    },

    getStats() {
      return {
        count: routeCount + stationCount,
        routes: routeCount,
        stations: stationCount,
        lastUpdate,
        error,
        source: 'OpenStreetMap · Houston mapped transit',
        mode: 'static',
        truthStatus: 'MAPPED',
        enabled,
      };
    },
  };
}

export default createHoustonTransitLayer();
