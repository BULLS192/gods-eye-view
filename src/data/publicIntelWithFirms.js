import publicIntelLayer from './publicIntel.js';
import houstonMobilityFeed from './houstonMobility.js';
import noaaRadarFeed from './noaaRadar.js';
import houstonTransitLayer from './houstonTransit.js';
import houstonAirQualityLayer from './houstonAirQuality.js';
import houstonCoastalLayer from './houstonCoastal.js';
import tomtomTrafficIntelLayer from './tomtomTrafficIntel.js';
import houstonTranstarCameraLayer from './houstonTranstarCameras.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import { registerDynamicCredit } from './dataCredits.js';

const firmsLayer = createFirmsHeatmapLayer({
  id: 'public-intel-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

const CIVILIAN_MOBILITY_CREDIT = {
  key: 'civilian-mobility-v1',
  html:
    'Houston mobility: Houston TranStar · TxDOT GIS camera locations · NOAA/NWS MRMS radar &amp; NOAA CO-OPS water levels · ' +
    'Air quality by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> ' +
    'using Copernicus Atmosphere Monitoring Service (CAMS) data · ' +
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
};

function syncMobilityPanel() {
  houstonMobilityFeed.setCompanionStats?.({
    radar: noaaRadarFeed.getStats(),
    transit: houstonTransitLayer.getStats(),
    air: houstonAirQualityLayer.getStats(),
    coastal: houstonCoastalLayer.getStats(),
    tomtomIntel: tomtomTrafficIntelLayer.getStats(),
    houstonCameras: houstonTranstarCameraLayer.getStats(),
  });
}

const publicIntelWithFirms = {
  id: 'local-firms',
  name: 'Mobility + Public Data',
  icon: '🚗',
  source: 'TranStar · TxDOT · TomTom · NOAA/NWS · OSM · Open-Meteo · NASA · USGS',
  updateInterval: 120_000,

  async init(viewer) {
    registerDynamicCredit(viewer, CIVILIAN_MOBILITY_CREDIT);
    publicIntelLayer.init(viewer);
    houstonMobilityFeed.init(viewer);
    noaaRadarFeed.init(viewer);
    houstonTransitLayer.init(viewer);
    houstonAirQualityLayer.init(viewer);
    houstonCoastalLayer.init(viewer);
    tomtomTrafficIntelLayer.init(viewer);
    houstonTranstarCameraLayer.init(viewer);
    firmsLayer.init(viewer);
    syncMobilityPanel();
  },

  async enable(viewer) {
    publicIntelLayer.enable(viewer);
    houstonMobilityFeed.enable(viewer);
    houstonTransitLayer.enable(viewer);
    houstonAirQualityLayer.enable(viewer);
    houstonCoastalLayer.enable(viewer);
    await Promise.allSettled([
      noaaRadarFeed.enable(viewer),
      tomtomTrafficIntelLayer.enable(viewer),
      houstonTranstarCameraLayer.enable(viewer),
      firmsLayer.enable(viewer),
    ]);
    syncMobilityPanel();
  },

  disable(viewer) {
    publicIntelLayer.disable(viewer);
    houstonMobilityFeed.disable(viewer);
    noaaRadarFeed.disable(viewer);
    houstonTransitLayer.disable(viewer);
    houstonAirQualityLayer.disable(viewer);
    houstonCoastalLayer.disable(viewer);
    tomtomTrafficIntelLayer.disable(viewer);
    houstonTranstarCameraLayer.disable(viewer);
    firmsLayer.disable(viewer);
  },

  async update(viewer) {
    const results = await Promise.allSettled([
      publicIntelLayer.update(viewer),
      houstonMobilityFeed.update(viewer),
      noaaRadarFeed.update(viewer),
      houstonTransitLayer.update(viewer),
      houstonAirQualityLayer.update(viewer),
      houstonCoastalLayer.update(viewer),
      tomtomTrafficIntelLayer.update(viewer),
      houstonTranstarCameraLayer.update(viewer),
    ]);
    try {
      await firmsLayer.update(viewer);
    } catch (error) {
      console.warn('[Data:Mobility] Optional FIRMS refresh failed:', error);
    }
    syncMobilityPanel();
    return results.some((result) => result.status === 'fulfilled' && result.value !== false);
  },

  destroy(viewer) {
    publicIntelLayer.destroy(viewer);
    houstonMobilityFeed.destroy(viewer);
    noaaRadarFeed.destroy(viewer);
    houstonTransitLayer.destroy(viewer);
    houstonAirQualityLayer.destroy(viewer);
    houstonCoastalLayer.destroy(viewer);
    tomtomTrafficIntelLayer.destroy(viewer);
    houstonTranstarCameraLayer.destroy(viewer);
    firmsLayer.destroy(viewer);
  },

  getStats() {
    const publicStats = publicIntelLayer.getStats();
    const mobilityStats = houstonMobilityFeed.getStats();
    const radarStats = noaaRadarFeed.getStats();
    const transitStats = houstonTransitLayer.getStats();
    const airStats = houstonAirQualityLayer.getStats();
    const coastalStats = houstonCoastalLayer.getStats();
    const tomtomStats = tomtomTrafficIntelLayer.getStats();
    const cameraStats = houstonTranstarCameraLayer.getStats();
    const firmsStats = firmsLayer.getStats();
    const allStats = [publicStats, mobilityStats, radarStats, transitStats, airStats, coastalStats, tomtomStats, cameraStats, firmsStats];
    const count = allStats.reduce((sum, stats) => sum + (Number(stats?.count) || 0), 0);
    const criticalFailures = [publicStats, mobilityStats, radarStats]
      .filter((stats) => stats?.error && !stats?.lastUpdate);
    return {
      count,
      lastUpdate: Math.max(...allStats.map((stats) => Number(stats?.lastUpdate) || 0)) || null,
      error: criticalFailures.length >= 3 ? 'Civilian public feeds unavailable' : null,
      source: 'TranStar · TxDOT · TomTom · NOAA/NWS · OSM · Open-Meteo · NASA · USGS',
      mode: 'live',
      truthStatus: 'MIXED',
      feeds: {
        ...(publicStats.feeds || {}),
        houstonMobility: mobilityStats,
        radar: radarStats,
        transit: transitStats,
        airQuality: airStats,
        coastal: coastalStats,
        tomtomTrafficIntel: tomtomStats,
        houstonCameras: cameraStats,
        firms: firmsStats,
      },
      loadingLabel: [
        'NEAR LIVE MOBILITY',
        tomtomStats.configured ? `TOMTOM LIVE · ${tomtomStats.incidents || 0} INCIDENTS` : 'TOMTOM KEY OPTIONAL',
        `${cameraStats.count || 0} CCTV MAPPED`,
        'LIVE RADAR',
        Number.isFinite(airStats.aqi) ? `AQI ${Math.round(airStats.aqi)} MODELED` : 'AQI MODELED',
        `${coastalStats.count || 0} COASTAL`,
        `${transitStats.stations || 0} TRANSIT STATIONS`,
        firmsStats.keyRequired ? 'FIRMS KEY OPTIONAL' : 'FIRMS LIVE',
      ].join(' · '),
    };
  },
};

export default publicIntelWithFirms;
