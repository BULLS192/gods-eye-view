import * as Cesium from 'cesium';

const HOUSTON = { lat: 29.7604, lon: -95.3698 };
const AIR_URL = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
AIR_URL.searchParams.set('latitude', String(HOUSTON.lat));
AIR_URL.searchParams.set('longitude', String(HOUSTON.lon));
AIR_URL.searchParams.set('current', 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide');
AIR_URL.searchParams.set('timezone', 'America/Chicago');
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

function aqiColor(aqi) {
  if (!Number.isFinite(aqi)) return Cesium.Color.GRAY;
  if (aqi <= 50) return Cesium.Color.LIMEGREEN;
  if (aqi <= 100) return Cesium.Color.YELLOW;
  if (aqi <= 150) return Cesium.Color.ORANGE;
  if (aqi <= 200) return Cesium.Color.RED;
  if (aqi <= 300) return Cesium.Color.MEDIUMPURPLE;
  return Cesium.Color.MAROON;
}

function aqiLabel(aqi) {
  if (!Number.isFinite(aqi)) return 'Unknown';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

export function createHoustonAirQualityLayer() {
  let source = null;
  let enabled = false;
  let lastUpdate = null;
  let error = null;
  let current = null;

  return {
    id: 'houston-air-quality',
    name: 'Houston Air Quality',
    icon: '◌',
    source: 'Open-Meteo · CAMS modeled air quality',
    updateInterval: REFRESH_INTERVAL_MS,
    showInTogglePanel: false,

    init(viewer) {
      source = new Cesium.CustomDataSource('houston-air-quality');
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
        const response = await fetch(AIR_URL.toString(), { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const values = payload?.current || {};
        const aqi = Number(values.us_aqi);
        current = {
          aqi: Number.isFinite(aqi) ? aqi : null,
          pm25: Number.isFinite(Number(values.pm2_5)) ? Number(values.pm2_5) : null,
          pm10: Number.isFinite(Number(values.pm10)) ? Number(values.pm10) : null,
          ozone: Number.isFinite(Number(values.ozone)) ? Number(values.ozone) : null,
          no2: Number.isFinite(Number(values.nitrogen_dioxide)) ? Number(values.nitrogen_dioxide) : null,
          observedAt: values.time || null,
        };

        source.entities.removeAll();
        const color = aqiColor(current.aqi);
        source.entities.add({
          id: 'houston-air-quality-current',
          position: Cesium.Cartesian3.fromDegrees(HOUSTON.lon, HOUSTON.lat, 75),
          point: {
            pixelSize: 13,
            color: color.withAlpha(0.88),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
            outlineWidth: 2,
            disableDepthTestDistance: 180000,
          },
          label: {
            text: current.aqi === null ? 'AQI —' : `AQI ${Math.round(current.aqi)} · ${aqiLabel(current.aqi)}`,
            font: '11px monospace',
            fillColor: color,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.62),
            pixelOffset: new Cesium.Cartesian2(0, -18),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 160000),
            disableDepthTestDistance: 180000,
          },
          properties: {
            aqi: current.aqi,
            pm25: current.pm25,
            pm10: current.pm10,
            ozone: current.ozone,
            nitrogenDioxide: current.no2,
            observedAt: current.observedAt,
            source: 'Open-Meteo / CAMS',
            truthStatus: 'MODELED',
          },
        });
        lastUpdate = Date.now();
        error = null;
        return true;
      } catch (caught) {
        error = `Air quality ${caught?.message || 'unavailable'}`;
        return false;
      }
    },

    destroy(viewer) {
      if (source) viewer.dataSources.remove(source, true);
      source = null;
      enabled = false;
      current = null;
    },

    getStats() {
      return {
        count: current ? 1 : 0,
        lastUpdate,
        error,
        source: 'Open-Meteo · CAMS',
        mode: 'modeled',
        truthStatus: 'MODELED',
        aqi: current?.aqi ?? null,
        aqiLabel: aqiLabel(current?.aqi),
        pm25: current?.pm25 ?? null,
        pm10: current?.pm10 ?? null,
        ozone: current?.ozone ?? null,
      };
    },
  };
}

export default createHoustonAirQualityLayer();
