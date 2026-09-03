import { createLocalGeoJsonLayer } from './localGeojson.js';
import publicIntelLayer from './publicIntelWithFirms.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';

// Use Vite's ?url import to properly resolve these assets in dev and build
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';

/**
 * Registry of local/bundled datasets plus the fused public-intel layer.
 * These are lazily activated by the normal DataLayerManager toggle lifecycle.
 */
const datacenters = createLocalGeoJsonLayer({
  id: 'local-datacenters',
  url: datacentersUrl,
  name: 'Datacenters',
  color: '#00ffff', // Cyan
  icon: '▣',
  source: 'Local',
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
});

const dams = createLocalGeoJsonLayer({
  id: 'local-dams',
  url: damsUrl,
  name: 'Dams',
  color: '#0088ff', // Blue
  icon: '▰',
  source: 'USACE',
  labels: true,
  labelMax: 900,
  labelGridPx: 132,
});

// `local-firms` remains the stable persistence token used by the existing v2
// layer-state codec. It now activates four keyless public feeds and retains
// NASA FIRMS as an optional fifth feed whenever FIRMS_MAP_KEY is configured.
const publicIntel = publicIntelLayer;

export default [
  datacenters,
  dams,
  submarineCablesLayer,
  publicIntel,
];
