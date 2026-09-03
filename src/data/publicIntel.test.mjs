import test from 'node:test';
import assert from 'node:assert/strict';
import { eonetAnchor, normalizeAuroraCoordinate } from './publicIntel.js';

test('normalizes NOAA OVATION grid coordinates to globe coordinates', () => {
  assert.deepEqual(normalizeAuroraCoordinate([0, 67, 25]), {
    lon: -179.5,
    lat: 67,
    probability: 25,
  });
  assert.deepEqual(normalizeAuroraCoordinate([359, -72, 120]), {
    lon: 179.5,
    lat: -72,
    probability: 100,
  });
  assert.equal(normalizeAuroraCoordinate(['bad', 10, 20]), null);
});

test('extracts a usable anchor from EONET point and polygon geometry', () => {
  assert.deepEqual(eonetAnchor({ type: 'Point', coordinates: [-95, 29] }), [-95, 29]);
  const anchor = eonetAnchor({
    type: 'Polygon',
    coordinates: [[[-96, 28], [-94, 28], [-94, 30], [-96, 30]]],
  });
  assert.deepEqual(anchor, [-95, 29]);
});
