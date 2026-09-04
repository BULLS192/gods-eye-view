import publicIntelLayer from './publicIntel.js';
import houstonMobilityFeed from './houstonMobility.js';
import noaaRadarFeed from './noaaRadar.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';

const firmsLayer = createFirmsHeatmapLayer({
  id: 'public-intel-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

/**
 * Stable `local-firms` wrapper for the hosted build.
 *
 * This slot now acts as the civilian situational-awareness bundle: the four
 * keyless public-intel feeds, Houston TranStar mobility, NOAA live radar, plus
 * optional NASA FIRMS. The stable id intentionally avoids a share-state schema
 * migration while the mobility experience is being field-tested.
 */
const publicIntelWithFirms = {
  id: 'local-firms',
  name: 'Mobility + Public Data',
  icon: '🚗',
  source: 'Houston TranStar · NOAA/NWS · NASA · USGS · METRO optional',
  updateInterval: 120_000,

  async init(viewer) {
    publicIntelLayer.init(viewer);
    houstonMobilityFeed.init(viewer);
    noaaRadarFeed.init(viewer);
    firmsLayer.init(viewer);
  },

  async enable(viewer) {
    publicIntelLayer.enable(viewer);
    houstonMobilityFeed.enable(viewer);
    await Promise.allSettled([
      noaaRadarFeed.enable(viewer),
      firmsLayer.enable(viewer),
    ]);
  },

  disable(viewer) {
    publicIntelLayer.disable(viewer);
    houstonMobilityFeed.disable(viewer);
    noaaRadarFeed.disable(viewer);
    firmsLayer.disable(viewer);
  },

  async update(viewer) {
    const results = await Promise.allSettled([
      publicIntelLayer.update(viewer),
      houstonMobilityFeed.update(viewer),
      noaaRadarFeed.update(viewer),
    ]);
    // FIRMS is optional. In the keyless state it reports KEY REQUIRED through
    // its own stats but must never make the civilian bundle unavailable.
    try {
      await firmsLayer.update(viewer);
    } catch (error) {
      console.warn('[Data:Mobility] Optional FIRMS refresh failed:', error);
    }
    return results.some((result) => result.status === 'fulfilled' && result.value !== false);
  },

  destroy(viewer) {
    publicIntelLayer.destroy(viewer);
    houstonMobilityFeed.destroy(viewer);
    noaaRadarFeed.destroy(viewer);
    firmsLayer.destroy(viewer);
  },

  getStats() {
    const publicStats = publicIntelLayer.getStats();
    const mobilityStats = houstonMobilityFeed.getStats();
    const radarStats = noaaRadarFeed.getStats();
    const firmsStats = firmsLayer.getStats();
    const count = [publicStats, mobilityStats, radarStats, firmsStats]
      .reduce((sum, stats) => sum + (Number(stats?.count) || 0), 0);
    const hardFailures = [publicStats, mobilityStats, radarStats]
      .filter((stats) => stats?.error && !stats?.lastUpdate);
    return {
      count,
      lastUpdate: Math.max(
        Number(publicStats.lastUpdate) || 0,
        Number(mobilityStats.lastUpdate) || 0,
        Number(radarStats.lastUpdate) || 0,
        Number(firmsStats.lastUpdate) || 0,
      ) || null,
      error: hardFailures.length >= 3 ? 'Civilian public feeds unavailable' : null,
      source: 'Houston TranStar · NOAA/NWS · NASA · USGS',
      mode: 'live',
      feeds: {
        ...(publicStats.feeds || {}),
        houstonMobility: mobilityStats,
        radar: radarStats,
        firms: firmsStats,
      },
      loadingLabel: firmsStats.keyRequired
        ? `LIVE MOBILITY · RADAR · ${mobilityStats.incidents || 0} INCIDENTS · FIRMS KEY OPTIONAL`
        : `LIVE MOBILITY · RADAR · ${mobilityStats.incidents || 0} INCIDENTS`,
    };
  },
};

export default publicIntelWithFirms;
