import * as Cesium from 'cesium';
import { flyToBrowserLocation } from './currentLocation.js';

/**
 * Camera presets for notable locations.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

function loaderMessage(message) {
  const element = document.querySelector('#loading-screen .loader-status');
  if (element) element.textContent = message;
}

function flyToAustinFallback(viewer) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 25000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 600),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}

/**
 * Startup camera behavior for unshared sessions.
 *
 * Prefer the device/browser's current position. The browser owns the permission
 * prompt and the coordinates remain client-side. If permission is denied,
 * geolocation is unavailable, or the request times out, preserve the original
 * Austin cinematic view as a safe fallback.
 *
 * The legacy function name is retained so existing callers do not change.
 */
export async function flyToAustin(viewer) {
  loaderMessage('Finding your current location...');
  try {
    const location = await flyToBrowserLocation(viewer, {
      timeout: 8_000,
      maximumAge: 5 * 60_000,
      enableHighAccuracy: true,
      duration: 3.5,
    });
    const accuracy = Number(location?.accuracy);
    loaderMessage(Number.isFinite(accuracy)
      ? `Current location found · accuracy ±${Math.round(accuracy)} m`
      : 'Current location found');
    window.dispatchEvent(new CustomEvent('gev:current-location', { detail: location }));
    return location;
  } catch (error) {
    console.warn('[Camera] Current location unavailable; using Austin fallback:', error);
    loaderMessage('Location unavailable — using Austin fallback...');
    flyToAustinFallback(viewer);
    return null;
  }
}
