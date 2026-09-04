import publicIntelLayer from './publicIntel.js';
import houstonMobilityFeed from './houstonMobility.js';
import noaaRadarFeed from './noaaRadar.js';
import houstonTransitLayer from './houstonTransit.js';
import houstonAirQualityLayer from './houstonAirQuality.js';
import houstonCoastalLayer from './houstonCoastal.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';

const firmsLayer = createFirmsHeatmapLayer({
  id: 'public-intel-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

function syncMobilityPanel() {
  houstonMobilityFeed.setCompanionStats?.({
    radar: noaaRadarFeed.getStats(),
    transit: houstonTransitLayer.getStats(),
    air: houstonAirQualityLayer.getStats(),
    coastal: houstonCoastalLayer.getStats(),
  });
}

/**
 * Stable `local-firms` wrapper for the hosted build.
 *
 * The slot is now the civilian situational-awareness bundle: public weather and
 * disaster feeds, Houston TranStar mobility, NOAA radar/coastal stations,
 * mapped Houston transit, modeled air quality, plus optional NASA FIRMS.
 * Keeping one stable id avoids a share-state migration during field testing.
 */
const publicIntelWithFirms = {
  id: 'local-firms',
  name: 'Mobility + Public Data',
  icon: '🚗',
  source: 'TranStar · NOAA/NWS · OSM · Open-Meteo · NASA · USGS',
  updateInterval: 120_000,

  async init(viewer) {
    publicIntelLayer.init(viewer);
    houstonMobilityFeed.init(viewer);
    noaaRadarFeed.init(viewer);
    houstonTransitLayer.init(viewer);
    houstonAirQualityLayer.init(viewer);
    houstonCoastalLayer.init(viewer);
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
    firmsLayer.destroy(viewer);
  },

  getStats() {
    const publicStats = publicIntelLayer.getStats();
    const mobilityStats = houstonMobilityFeed.getStats();
    const radarStats = noaaRadarFeed.getStats();
    const transitStats = houstonTransitLayer.getStats();
    const airStats = houstonAirQualityLayer.getStats();
    const coastalStats = houstonCoastalLayer.getStats();
    const firmsStats = firmsLayer.getStats();
    const allStats = [publicStats, mobilityStats, radarStats, transitStats, airStats, coastalStats, firmsStats];
    const count = allStats.reduce((sum, stats) => sum + (Number(stats?.count) || 0), 0);
    const criticalFailures = [publicStats, mobilityStats, radarStats]
      .filter((stats) => stats?.error && !stats?.lastUpdate);
    return {
      count,
      lastUpdate: Math.max(...allStats.map((stats) => Number(stats?.lastUpdate) || 0)) || null,
      error: criticalFailures.length >= 3 ? 'Civilian public feeds unavailable' : null,
      source: 'TranStar · NOAA/NWS · OSM · Open-Meteo · NASA · USGS',
      mode: 'live',
      truthStatus: 'MIXED',
      feeds: {
        ...(publicStats.feeds || {}),
        houstonMobility: mobilityStats,
        radar: radarStats,
        transit: transitStats,
        airQuality: airStats,
        coastal: coastalStats,
        firms: firmsStats,
      },
      loadingLabel: [
        'NEAR LIVE MOBILITY',
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
