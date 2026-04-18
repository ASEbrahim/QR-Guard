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
 *
 * Audit logging policy:
 *   - On REJECTION: logAudit runs here in the finally block. Guarantees we
 *     always record the attempt, even for rejected scans.
 *   - On SUCCESS: logAudit is NOT called here. The caller (scan-controller)
 *     is responsible for logging success AFTER the attendance row has been
 *     persisted. This prevents the divergence where an audit_log success
 *     row could exist without a matching attendance row.
 *
 * Pipeline order (per docs/uml/02-sequence-scan.svg — this order is law):
 *   1. QrValidator — token valid for current refresh cycle
 *   2. DeviceChecker — fingerprint matches stored binding
 *   3. IpValidator — country = Kuwait, no VPN/proxy (FAIL-OPEN)
 *   4. GpsAccuracyChecker — accuracy ≤ 150m and ≠ 0
 *   5. GeofenceChecker — PostGIS ST_DWithin with WKT cast + 15m margin
 *
 * @param {{studentId: string, qrPayload: string, gpsLat: number, gpsLng: number, gpsAccuracy: number, deviceFingerprint: string, clientIp: string}} scanData
 * @returns {Promise<{success: boolean, sessionId?: string, courseId?: string, reason?: string, message?: string, ipCheckSkipped?: boolean}>}
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

    // All checks passed — caller will persist attendance and then audit.
    result = {
      success: true,
      sessionId: tokenData.sessionId,
      courseId: tokenData.courseId,
      ipCheckSkipped: ipResult?.skipped || false,
    };
  } catch (err) {
    if (err instanceof ScanError) {
      result = { success: false, reason: err.code, message: err.message };
    } else {
      console.error('[scan-verifier] Unexpected error:', err);
      result = { success: false, reason: 'internal_error', message: 'An unexpected error occurred' };
    }
    // Log rejection here — we guarantee every rejected attempt is audited.
    await logAudit({
      eventType: 'scan_attempt',
      actorId: scanData.studentId,
      targetId: tokenData?.sessionId || null,
      result: 'rejected',
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
