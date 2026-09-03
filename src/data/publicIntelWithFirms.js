import publicIntelLayer from './publicIntel.js';
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
 * The four keyless feeds are always available. NASA FIRMS remains wired as an
 * optional fifth feed and becomes live automatically if FIRMS_MAP_KEY is added
 * server-side later. A missing FIRMS key never marks the fused layer failed.
 */
const publicIntelWithFirms = {
  id: 'local-firms',
  name: 'Public Intel (Free)',
  icon: '◎',
  source: 'NWS · NASA EONET/FIRMS · NOAA SWPC · USGS Water',
  updateInterval: 120_000,

  async init(viewer) {
    publicIntelLayer.init(viewer);
    firmsLayer.init(viewer);
  },

  async enable(viewer) {
    publicIntelLayer.enable(viewer);
    await firmsLayer.enable(viewer);
  },

  disable(viewer) {
    publicIntelLayer.disable(viewer);
    firmsLayer.disable(viewer);
  },

  async update(viewer) {
    const publicOk = await publicIntelLayer.update(viewer);
    // FIRMS is optional. In the keyless state it reports KEY REQUIRED through
    // its own stats but must not make the four public feeds appear unavailable.
    try {
      await firmsLayer.update(viewer);
    } catch (error) {
      console.warn('[Data:PublicIntel] Optional FIRMS refresh failed:', error);
    }
    return publicOk;
  },

  destroy(viewer) {
    publicIntelLayer.destroy(viewer);
    firmsLayer.destroy(viewer);
  },

  getStats() {
    const publicStats = publicIntelLayer.getStats();
    const firmsStats = firmsLayer.getStats();
    return {
      ...publicStats,
      count: (Number(publicStats.count) || 0) + (Number(firmsStats.count) || 0),
      feeds: {
        ...(publicStats.feeds || {}),
        firms: firmsStats,
      },
      loadingLabel: firmsStats.keyRequired
        ? '4 KEYLESS FEEDS · FIRMS KEY OPTIONAL'
        : publicStats.loadingLabel,
    };
  },
};

export default publicIntelWithFirms;
