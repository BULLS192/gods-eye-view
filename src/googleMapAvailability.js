/** Never invoke Google's loader without an explicit key (Cesium has defaults). */
export async function loadOptionalGoogleTiles(apiKey, loadTiles, onError) {
  const key = String(apiKey || '').trim();
  if (!key) return null;
  try {
    return await loadTiles(key);
  } catch (error) {
    onError(error);
    return null;
  }
}
