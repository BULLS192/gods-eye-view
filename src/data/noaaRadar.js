import * as Cesium from 'cesium';

const RADAR_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer';
const RADAR_REFRESH_MS = 5 * 60_000;

export function createNoaaRadarFeed() {
  let viewer = null;
  let imageryLayer = null;
  let enabled = false;
  let loading = false;
  let lastUpdate = null;
  let error = null;

  async function ensureLayer(force = false) {
    if (!viewer || loading) return Boolean(imageryLayer);
    if (imageryLayer && !force) {
      imageryLayer.show = enabled;
      return true;
    }
    loading = true;
    try {
      if (imageryLayer) {
        viewer.imageryLayers.remove(imageryLayer, true);
        imageryLayer = null;
      }
      const Provider = Cesium.ArcGisMapServerImageryProvider;
      const options = { layers: '3', enablePickFeatures: false };
      const provider = typeof Provider.fromUrl === 'function'
        ? await Provider.fromUrl(RADAR_URL, options)
        : new Provider({ url: RADAR_URL, ...options });
      imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
      imageryLayer.alpha = 0.58;
      imageryLayer.brightness = 1.08;
      imageryLayer.contrast = 1.08;
      imageryLayer.show = enabled;
      lastUpdate = Date.now();
      error = null;
      return true;
    } catch (caught) {
      error = `NOAA radar ${caught?.message || 'unavailable'}`;
      return false;
    } finally {
      loading = false;
    }
  }

  return {
    init(targetViewer) {
      viewer = targetViewer;
    },
    async enable() {
      enabled = true;
      return ensureLayer(false);
    },
    disable() {
      enabled = false;
      if (imageryLayer) imageryLayer.show = false;
    },
    async update() {
      if (!enabled) return true;
      const due = !lastUpdate || Date.now() - lastUpdate >= RADAR_REFRESH_MS;
      return due ? ensureLayer(true) : true;
    },
    destroy(targetViewer) {
      const activeViewer = targetViewer || viewer;
      if (imageryLayer && activeViewer) activeViewer.imageryLayers.remove(imageryLayer, true);
      imageryLayer = null;
      viewer = null;
      enabled = false;
      loading = false;
      lastUpdate = null;
      error = null;
    },
    getStats() {
      return {
        count: imageryLayer ? 1 : 0,
        lastUpdate,
        loading,
        error,
        source: 'NOAA/NWS MRMS radar',
        mode: 'live',
        truthStatus: 'LIVE',
      };
    },
  };
}

export default createNoaaRadarFeed();
