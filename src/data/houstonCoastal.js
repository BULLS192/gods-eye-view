import * as Cesium from 'cesium';

const STATIONS = Object.freeze([
  { id: '8770777', name: 'Manchester · Houston Ship Channel', lat: 29.72622, lon: -95.26578 },
  { id: '8770613', name: 'Morgans Point · Barbours Cut', lat: 29.68147, lon: -94.98436 },
  { id: '8771450', name: 'Galveston Pier 21', lat: 29.31, lon: -94.79331 },
]);
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function stationUrl(station) {
  const url = new URL('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter');
  url.searchParams.set('date', 'latest');
  url.searchParams.set('station', station.id);
  url.searchParams.set('product', 'water_level');
  url.searchParams.set('datum', 'MLLW');
  url.searchParams.set('time_zone', 'gmt');
  url.searchParams.set('units', 'english');
  url.searchParams.set('format', 'json');
  url.searchParams.set('application', 'gods-eye-view');
  return url.toString();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createHoustonCoastalLayer() {
  let source = null;
  let enabled = false;
  let lastUpdate = null;
  let error = null;
  let stations = [];

  return {
    id: 'houston-coastal-stations',
    name: 'Houston Coastal Levels',
    icon: '≈',
    source: 'NOAA CO-OPS · water levels',
    updateInterval: REFRESH_INTERVAL_MS,
    showInTogglePanel: false,

    init(viewer) {
      source = new Cesium.CustomDataSource('houston-coastal-stations');
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
      const settled = await Promise.allSettled(STATIONS.map(async (station) => {
        const response = await fetch(stationUrl(station), { cache: 'no-store' });
        if (!response.ok) throw new Error(`${station.id} HTTP ${response.status}`);
        const payload = await response.json();
        const row = Array.isArray(payload?.data) ? payload.data[0] : null;
        if (!row) throw new Error(`${station.id} no observation`);
        return {
          ...station,
          waterLevelFt: numberOrNull(row.v),
          sigma: numberOrNull(row.s),
          flags: row.f || '',
          observedAt: row.t || null,
        };
      }));

      stations = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      if (!stations.length) {
        error = 'NOAA coastal stations unavailable';
        return false;
      }

      source.entities.removeAll();
      for (const station of stations) {
        const level = station.waterLevelFt;
        const color = level !== null && level >= 3 ? Cesium.Color.ORANGERED
          : level !== null && level >= 2 ? Cesium.Color.ORANGE
            : Cesium.Color.DODGERBLUE;
        source.entities.add({
          id: `noaa-coops:${station.id}`,
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 20),
          point: {
            pixelSize: 10,
            color: color.withAlpha(0.9),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
            outlineWidth: 1,
            disableDepthTestDistance: 200000,
          },
          label: {
            text: level === null ? station.name : `${station.name} · ${level.toFixed(2)} ft MLLW`,
            font: '10px monospace',
            fillColor: Cesium.Color.LIGHTCYAN,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.58),
            pixelOffset: new Cesium.Cartesian2(0, -16),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 220000),
            disableDepthTestDistance: 200000,
          },
          properties: {
            stationId: station.id,
            stationName: station.name,
            waterLevelFt: level,
            datum: 'MLLW',
            observedAt: station.observedAt,
            source: 'NOAA CO-OPS',
            truthStatus: 'NEAR LIVE',
          },
        });
      }

      lastUpdate = Date.now();
      error = null;
      return true;
    },

    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
      enabled = false;
      stations = [];
    },

    getStats() {
      return {
        count: stations.length,
        lastUpdate,
        error,
        source: 'NOAA CO-OPS · Houston/Galveston Bay',
        mode: 'live',
        truthStatus: 'NEAR LIVE',
        stations: stations.map((station) => ({
          id: station.id,
          name: station.name,
          waterLevelFt: station.waterLevelFt,
          observedAt: station.observedAt,
        })),
      };
    },
  };
}

export default createHoustonCoastalLayer();
