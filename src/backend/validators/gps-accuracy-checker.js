import { GPS_MAX_ACCURACY_M } from '../config/constants.js';
import { ScanError } from './scan-error.js';

/**
 * Layer 4: Check GPS accuracy field.
 * Rejects if accuracy > 150m (too imprecise) or === 0 (likely spoofed/unavailable).
 *
 * @param {number} accuracy — GPS accuracy in meters from the browser Geolocation API
 * @throws {ScanError} code='gps_accuracy_failed' if suspicious
 */
export function checkGpsAccuracy(accuracy) {
  if (accuracy === 0 || accuracy === null || accuracy === undefined) {
    throw new ScanError('Location verification failed', 'gps_accuracy_failed');
  }

  if (accuracy > GPS_MAX_ACCURACY_M) {
    throw new ScanError('Location verification failed', 'gps_accuracy_failed');
  }
}
