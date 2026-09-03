import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOptionalGoogleTiles } from './googleMapAvailability.js';

test('missing and whitespace keys never call Google or abort startup', async () => {
  for (const key of [undefined, null, '', '  \n ']) {
    assert.equal(await loadOptionalGoogleTiles(key,
      () => assert.fail('Google must not be contacted without a key'),
      () => assert.fail('A missing key is not an error')), null);
  }
});

test('configured Google key retains the loaded 3D tileset', async () => {
  const tileset = { show: true };
  assert.equal(await loadOptionalGoogleTiles(' test-key ', async key => {
    assert.equal(key, 'test-key');
    return tileset;
  }, () => assert.fail('Valid loader failed')), tileset);
});

test('Google failure reports the cause and returns the fallback sentinel', async () => {
  const failure = new Error('Tiles unavailable');
  let reported;
  assert.equal(await loadOptionalGoogleTiles('test-key', async () => {
    throw failure;
  }, error => { reported = error; }), null);
  assert.equal(reported, failure);
});
