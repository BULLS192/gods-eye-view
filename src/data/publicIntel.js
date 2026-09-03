import * as Cesium from 'cesium';

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual';
const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30&limit=250';
const SWPC_AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const USGS_WATER_URL = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items';

const NWS_MAX_POLYGONS = 240;
const EONET_MAX_EVENTS = 250;
const AURORA_MAX_POINTS = 1400;
const WATER_MAX_GAUGES = 300;
const WATER_MAX_VIEW_SPAN_DEG = 20;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fetchJson(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Accept: 'application/geo+json, application/json;q=0.9, */*;q=0.8',
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

function alertColor(severity) {
  const value = String(severity || '').toLowerCase();
  if (value === 'extreme') return Cesium.Color.RED;
  if (value === 'severe') return Cesium.Color.ORANGERED;
  if (value === 'moderate') return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

function polygonRings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .map((polygon) => Array.isArray(polygon) && polygon.length ? polygon[0] : null)
      .filter(Boolean);
  }
  return [];
}

function ringHierarchy(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const flat = [];
  for (const coordinate of ring) {
    const lon = finite(coordinate?.[0]);
    const lat = finite(coordinate?.[1]);
    if (lon === null || lat === null) continue;
    flat.push(lon, lat);
  }
  return flat.length >= 6 ? Cesium.Cartesian3.fromDegreesArray(flat) : null;
}

export function eonetAnchor(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const lon = finite(geometry.coordinates?.[0]);
    const lat = finite(geometry.coordinates?.[1]);
    return lon === null || lat === null ? null : [lon, lat];
  }
  const rings = polygonRings(geometry);
  const ring = rings[0];
  if (!ring?.length) return null;
  let lonTotal = 0;
  let latTotal = 0;
  let count = 0;
  for (const coordinate of ring) {
    const lon = finite(coordinate?.[0]);
    const lat = finite(coordinate?.[1]);
    if (lon === null || lat === null) continue;
    lonTotal += lon;
    latTotal += lat;
    count += 1;
  }
  return count ? [lonTotal / count, latTotal / count] : null;
}

function eventColor(categories) {
  const names = (Array.isArray(categories) ? categories : [])
    .map((category) => String(category?.title || category?.id || '').toLowerCase())
    .join(' ');
  if (/wildfire|fire/.test(names)) return Cesium.Color.ORANGERED;
  if (/volcano/.test(names)) return Cesium.Color.MAGENTA;
  if (/storm|cyclone|hurricane/.test(names)) return Cesium.Color.CYAN;
  if (/flood/.test(names)) return Cesium.Color.DODGERBLUE;
  if (/ice|snow/.test(names)) return Cesium.Color.LIGHTCYAN;
  return Cesium.Color.LIME;
}

export function normalizeAuroraCoordinate(row) {
  if (!Array.isArray(row) || row.length < 3) return null;
  const gridLon = finite(row[0]);
  const lat = finite(row[1]);
  const probability = finite(row[2]);
  if (gridLon === null || lat === null || probability === null) return null;
  return {
    lon: clamp(gridLon - 179.5, -180, 180),
    lat: clamp(lat, -90, 90),
    probability: clamp(probability, 0, 100),
  };
}

function cameraRectangleDegrees(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  if (![west, east, south, north].every(Number.isFinite) || east <= west) return null;
  return { west, east, south, north, width: east - west, height: north - south };
}

function createNwsOverlay() {
  let source = null;
  let count = 0;
  let lastUpdate = null;
  let error = null;

  return {
    init(viewer) {
      source = new Cesium.CustomDataSource('public-intel-weather-alerts');
      source.show = false;
      viewer.dataSources.add(source);
    },
    enable() { if (source) source.show = true; },
    disable() { if (source) source.show = false; },
    async update() {
      try {
        const geojson = await fetchJson(NWS_ALERTS_URL);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        source.entities.removeAll();
        let rendered = 0;
        for (const feature of features) {
          if (rendered >= NWS_MAX_POLYGONS) break;
          const props = feature.properties || {};
          const color = alertColor(props.severity);
          for (const ring of polygonRings(feature.geometry)) {
            if (rendered >= NWS_MAX_POLYGONS) break;
            const hierarchy = ringHierarchy(ring);
            if (!hierarchy) continue;
            source.entities.add({
              id: `nws:${feature.id || rendered}:${rendered}`,
              polygon: {
                hierarchy,
                material: color.withAlpha(0.12),
                outline: true,
                outlineColor: color.withAlpha(0.9),
                classificationType: Cesium.ClassificationType.BOTH,
              },
              properties: {
                event: props.event || 'Weather alert',
                severity: props.severity || 'Unknown',
                headline: props.headline || '',
                expires: props.expires || null,
              },
            });
            rendered += 1;
          }
        }
        count = rendered;
        lastUpdate = Date.now();
        error = null;
        return true;
      } catch (caught) {
        error = `NWS ${caught?.message || 'network error'}`;
        return false;
      }
    },
    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
    },
    getStats() { return { count, lastUpdate, error }; },
  };
}

function createEonetOverlay() {
  let source = null;
  let count = 0;
  let lastUpdate = null;
  let error = null;

  return {
    init(viewer) {
      source = new Cesium.CustomDataSource('public-intel-natural-events');
      source.show = false;
      viewer.dataSources.add(source);
    },
    enable() { if (source) source.show = true; },
    disable() { if (source) source.show = false; },
    async update() {
      try {
        const geojson = await fetchJson(EONET_URL);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        source.entities.removeAll();
        let rendered = 0;
        for (const feature of features.slice(0, EONET_MAX_EVENTS)) {
          const anchor = eonetAnchor(feature.geometry);
          if (!anchor) continue;
          const props = feature.properties || {};
          const color = eventColor(props.categories);
          source.entities.add({
            id: `eonet:${feature.id || rendered}`,
            position: Cesium.Cartesian3.fromDegrees(anchor[0], anchor[1], 2500),
            point: {
              pixelSize: 10,
              color: color.withAlpha(0.9),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
              outlineWidth: 1,
              disableDepthTestDistance: 1_500_000,
            },
            label: {
              text: String(props.title || 'Natural event').slice(0, 42),
              font: '11px monospace',
              fillColor: color,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
              pixelOffset: new Cesium.Cartesian2(0, -16),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_500_000),
            },
            properties: {
              title: props.title || '',
              categories: JSON.stringify(props.categories || []),
              sourceUrl: props.link || '',
            },
          });
          rendered += 1;
        }
        count = rendered;
        lastUpdate = Date.now();
        error = null;
        return true;
      } catch (caught) {
        error = `EONET ${caught?.message || 'network error'}`;
        return false;
      }
    },
    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
    },
    getStats() { return { count, lastUpdate, error }; },
  };
}

function createAuroraOverlay() {
  let points = null;
  let count = 0;
  let lastUpdate = null;
  let error = null;
  let enabled = false;

  return {
    init(viewer) {
      points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      points.show = false;
    },
    enable() { enabled = true; if (points) points.show = true; },
    disable() { enabled = false; if (points) points.show = false; },
    async update() {
      try {
        const payload = await fetchJson(SWPC_AURORA_URL);
        const rows = Array.isArray(payload?.coordinates) ? payload.coordinates : [];
        const candidates = [];
        for (let i = 0; i < rows.length; i += 2) {
          const normalized = normalizeAuroraCoordinate(rows[i]);
          if (!normalized || normalized.probability < 8) continue;
          candidates.push(normalized);
        }
        candidates.sort((a, b) => b.probability - a.probability);
        points.removeAll();
        for (const item of candidates.slice(0, AURORA_MAX_POINTS)) {
          const strength = item.probability / 100;
          points.add({
            position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 120_000),
            pixelSize: 3 + strength * 9,
            color: Cesium.Color.LIME.withAlpha(0.22 + strength * 0.72),
            outlineColor: Cesium.Color.CYAN.withAlpha(0.3 + strength * 0.5),
            outlineWidth: strength > 0.3 ? 1 : 0,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          });
        }
        points.show = enabled;
        count = Math.min(candidates.length, AURORA_MAX_POINTS);
        lastUpdate = Date.now();
        error = null;
        return true;
      } catch (caught) {
        error = `NOAA SWPC ${caught?.message || 'network error'}`;
        return false;
      }
    },
    destroy(viewer) {
      if (points) viewer.scene.primitives.remove(points);
      points = null;
    },
    getStats() { return { count, lastUpdate, error }; },
  };
}

function createWaterOverlay() {
  let source = null;
  let count = 0;
  let lastUpdate = null;
  let error = null;
  let status = 'idle';

  return {
    init(viewer) {
      source = new Cesium.CustomDataSource('public-intel-water-gauges');
      source.show = false;
      viewer.dataSources.add(source);
    },
    enable() { if (source) source.show = true; },
    disable() { if (source) source.show = false; },
    async update(viewer) {
      const box = cameraRectangleDegrees(viewer);
      if (!box || box.width > WATER_MAX_VIEW_SPAN_DEG || box.height > WATER_MAX_VIEW_SPAN_DEG) {
        source.entities.removeAll();
        count = 0;
        status = 'zoom-in';
        error = null;
        return true;
      }
      try {
        const url = new URL(USGS_WATER_URL);
        url.searchParams.set('f', 'json');
        url.searchParams.set('parameter_code', '00060');
        url.searchParams.set('time', 'P1D');
        url.searchParams.set('bbox', `${box.west},${box.south},${box.east},${box.north}`);
        url.searchParams.set('limit', String(WATER_MAX_GAUGES));
        const geojson = await fetchJson(url.toString());
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        source.entities.removeAll();
        let rendered = 0;
        for (const feature of features.slice(0, WATER_MAX_GAUGES)) {
          if (feature.geometry?.type !== 'Point') continue;
          const lon = finite(feature.geometry.coordinates?.[0]);
          const lat = finite(feature.geometry.coordinates?.[1]);
          const value = finite(feature.properties?.value);
          if (lon === null || lat === null || value === null) continue;
          const size = clamp(5 + Math.log10(Math.max(1, value)) * 2, 6, 15);
          const color = value >= 20_000 ? Cesium.Color.ORANGERED
            : value >= 5_000 ? Cesium.Color.ORANGE
              : value >= 1_000 ? Cesium.Color.CYAN
                : Cesium.Color.DODGERBLUE;
          source.entities.add({
            id: `usgs-water:${feature.id || rendered}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 100),
            point: {
              pixelSize: size,
              color: color.withAlpha(0.85),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.65),
              outlineWidth: 1,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: {
              site: feature.properties?.monitoring_location_name || feature.properties?.monitoring_location_id || '',
              dischargeCfs: value,
              unit: feature.properties?.unit_of_measure || 'ft^3/s',
              observedAt: feature.properties?.time || null,
              approval: feature.properties?.approval_status || '',
            },
          });
          rendered += 1;
        }
        count = rendered;
        lastUpdate = Date.now();
        status = 'ready';
        error = null;
        return true;
      } catch (caught) {
        status = 'error';
        error = `USGS Water ${caught?.message || 'network error'}`;
        return false;
      }
    },
    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
    },
    getStats() { return { count, lastUpdate, error, status }; },
  };
}

export function createPublicIntelLayer() {
  const feeds = [createNwsOverlay(), createEonetOverlay(), createAuroraOverlay(), createWaterOverlay()];
  let enabled = false;
  let lastUpdate = null;
  let lastError = null;

  return {
    id: 'local-firms',
    name: 'Public Intel (Free)',
    icon: '◎',
    source: 'NWS · NASA EONET · NOAA SWPC · USGS Water',
    updateInterval: 120_000,

    init(viewer) {
      for (const feed of feeds) feed.init(viewer);
      enabled = false;
      lastUpdate = null;
      lastError = null;
      console.log('[Data:PublicIntel] Initialized four keyless public feeds');
    },

    enable(viewer) {
      enabled = true;
      for (const feed of feeds) feed.enable(viewer);
    },

    disable(viewer) {
      enabled = false;
      for (const feed of feeds) feed.disable(viewer);
    },

    async update(viewer) {
      const results = await Promise.allSettled(feeds.map((feed) => feed.update(viewer)));
      const failures = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status === 'rejected' || result.value === false) {
          failures.push(feeds[index].getStats()?.error || result.reason?.message || `feed ${index + 1} unavailable`);
        }
      }
      lastUpdate = Date.now();
      // This fused layer stays useful when one public upstream is temporarily
      // unavailable. Surface a hard error only if every feed failed.
      lastError = failures.length === feeds.length ? failures.join(' · ') : null;
      return failures.length < feeds.length;
    },

    destroy(viewer) {
      for (const feed of feeds) feed.destroy(viewer);
      enabled = false;
      lastUpdate = null;
      lastError = null;
    },

    getStats() {
      const feedStats = feeds.map((feed) => feed.getStats());
      return {
        count: feedStats.reduce((sum, stats) => sum + (Number(stats?.count) || 0), 0),
        lastUpdate,
        error: lastError,
        status: enabled ? 'ready' : 'idle',
        feeds: {
          weatherAlerts: feedStats[0],
          naturalEvents: feedStats[1],
          aurora: feedStats[2],
          waterGauges: feedStats[3],
        },
      };
    },
  };
}

export default createPublicIntelLayer();
