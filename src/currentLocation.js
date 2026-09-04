import * as Cesium from 'cesium';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAXIMUM_AGE_MS = 5 * 60_000;

function geolocationAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
}

export function requestCurrentPosition({
  timeout = DEFAULT_TIMEOUT_MS,
  maximumAge = DEFAULT_MAXIMUM_AGE_MS,
  enableHighAccuracy = true,
} = {}) {
  if (!geolocationAvailable()) {
    return Promise.reject(new Error('Geolocation is not available in this browser'));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      { enableHighAccuracy, timeout, maximumAge },
    );
  });
}

export function flyToCurrentPosition(viewer, position, { duration = 3.5 } = {}) {
  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);
  const accuracy = Number(position?.coords?.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Current location did not include valid coordinates');
  }

  // Start high enough to provide geographic context, but finish close enough
  // for mobility/traffic layers to be immediately useful. Less precise fixes
  // get a slightly higher camera so we do not imply street-level precision.
  const finalAltitude = Number.isFinite(accuracy)
    ? Math.max(900, Math.min(5_000, Math.max(accuracy * 4, 1_500)))
    : 1_800;
  const startAltitude = Math.max(18_000, finalAltitude * 6);

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, startAltitude),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, finalAltitude),
    orientation: {
      heading: Cesium.Math.toRadians(15),
      pitch: Cesium.Math.toRadians(-38),
      roll: 0,
    },
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });

  return { latitude, longitude, accuracy, finalAltitude };
}

export async function flyToBrowserLocation(viewer, options = {}) {
  const position = await requestCurrentPosition(options);
  return flyToCurrentPosition(viewer, position, options);
}
