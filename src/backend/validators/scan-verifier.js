import { validateQrToken } from './qr-validator.js';
import { checkDevice } from './device-checker.js';
import { checkIp } from './ip-validator.js';
import { checkGpsAccuracy } from './gps-accuracy-checker.js';
import { checkGeofence } from './geofence-checker.js';
import { logAudit } from './audit-logger.js';
import { ScanError } from './scan-error.js';

/**
 * ScanVerifier — orchestrates the 6-layer verification pipeline.
 * Runs layers 1-5 in order, short-circuits on first failure.
 * Layer 6 (audit log) always runs in the finally block.
 *
 * Pipeline order (per docs/uml/02-sequence-scan.svg — this order is law):
 *   1. QrValidator — token valid for current refresh cycle
 *   2. DeviceChecker — fingerprint matches stored binding
 *   3. IpValidator — country = Kuwait, no VPN/proxy (FAIL-OPEN)
 *   4. GpsAccuracyChecker — accuracy ≤ 150m and ≠ 0
 *   5. GeofenceChecker — PostGIS ST_DWithin with WKT cast + 15m margin
 *   6. AuditLogger — always runs
 *
 * @param {{studentId: string, qrPayload: string, gpsLat: number, gpsLng: number, gpsAccuracy: number, deviceFingerprint: string, clientIp: string}} scanData
 * @returns {Promise<{success: boolean, sessionId?: string, reason?: string, message?: string}>}
 */
export async function verifyScan(scanData) {
  let tokenData = null;
  let result = { success: false, reason: null, message: null };
  let ipResult = null;

  try {
    // Layer 1: QR token validity
    tokenData = await validateQrToken(scanData.qrPayload);

    // Layer 2: Device fingerprint
    await checkDevice(scanData.studentId, scanData.deviceFingerprint);

    // Layer 3: IP country + VPN (FAIL-OPEN)
    ipResult = await checkIp(scanData.clientIp);

    // Layer 4: GPS accuracy
    checkGpsAccuracy(scanData.gpsAccuracy);

    // Layer 5: Geofence
    await checkGeofence(tokenData.courseId, scanData.gpsLat, scanData.gpsLng);

    // All checks passed
    result = { success: true, sessionId: tokenData.sessionId, courseId: tokenData.courseId };
  } catch (err) {
    if (err instanceof ScanError) {
      result = { success: false, reason: err.code, message: err.message };
    } else {
      console.error('[scan-verifier] Unexpected error:', err);
      result = { success: false, reason: 'internal_error', message: 'An unexpected error occurred' };
    }
  } finally {
    // Layer 6: ALWAYS log the attempt
    await logAudit({
      eventType: 'scan_attempt',
      actorId: scanData.studentId,
      targetId: tokenData?.sessionId || null,
      result: result.success ? 'success' : 'rejected',
      reason: result.reason || (ipResult?.skipped ? 'ip_check_skipped' : null),
      details: {
        gpsLat: scanData.gpsLat,
        gpsLng: scanData.gpsLng,
        gpsAccuracy: scanData.gpsAccuracy,
        ipAddress: scanData.clientIp,
        deviceHash: scanData.deviceFingerprint,
        ipCheckSkipped: ipResult?.skipped || false,
      },
    });
  }

  return result;
}
