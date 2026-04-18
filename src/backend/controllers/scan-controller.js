import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { attendance } from '../db/schema/index.js';
import { verifyScan } from '../validators/scan-verifier.js';
import { logAudit } from '../validators/audit-logger.js';
import { emitAttendanceUpdate } from '../services/socket-service.js';
import { checkThresholdAndNotify } from '../services/notification-service.js';

const scanSchema = z.object({
  qrPayload: z.string().min(1),
  gpsLat: z.number().min(-90).max(90),
  gpsLng: z.number().min(-180).max(180),
  gpsAccuracy: z.number().min(0),
  deviceFingerprint: z.string().min(1),
});

/**
 * POST /api/scan
 * Student scans a QR code — runs the 6-layer verification pipeline.
 */
export async function handleScan(req, res) {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { qrPayload, gpsLat, gpsLng, gpsAccuracy, deviceFingerprint } = parsed.data;
  const clientIp = req.ip || req.connection?.remoteAddress || '0.0.0.0';

  // Run the pipeline
  const result = await verifyScan({
    studentId: req.session.userId,
    qrPayload,
    gpsLat,
    gpsLng,
    gpsAccuracy,
    deviceFingerprint,
    clientIp,
  });

  if (!result.success) {
    // verifier already logged the rejection
    return res.status(403).json({ error: result.message, code: result.reason });
  }

  // Shared details object for audit entries written below.
  const auditDetails = {
    gpsLat,
    gpsLng,
    gpsAccuracy,
    ipAddress: clientIp,
    deviceHash: deviceFingerprint,
    ipCheckSkipped: result.ipCheckSkipped || false,
  };

  // Pipeline passed — record attendance
  try {
    await db.insert(attendance).values({
      sessionId: result.sessionId,
      studentId: req.session.userId,
      status: 'present',
      gpsLat: String(gpsLat),
      gpsLng: String(gpsLng),
      gpsAccuracyM: String(gpsAccuracy),
      ipAddress: clientIp,
      deviceHash: deviceFingerprint,
    });
  } catch (err) {
    // UNIQUE constraint violation = already recorded. Audit as rejection
    // with a distinct reason so the attempt is still captured.
    if (err.code === '23505') {
      await logAudit({
        eventType: 'scan_attempt',
        actorId: req.session.userId,
        targetId: result.sessionId,
        result: 'rejected',
        reason: 'already_recorded',
        details: auditDetails,
      });
      return res.status(409).json({ error: 'Already recorded', code: 'already_recorded' });
    }
    // Any other attendance-insert error: audit the failure BEFORE re-throwing
    // so we don't end up with an unaudited scan success.
    await logAudit({
      eventType: 'scan_attempt',
      actorId: req.session.userId,
      targetId: result.sessionId,
      result: 'rejected',
      reason: 'attendance_insert_failed',
      details: { ...auditDetails, errorCode: err.code },
    });
    throw err;
  }

  // Attendance persisted — now log the success audit row.
  await logAudit({
    eventType: 'scan_attempt',
    actorId: req.session.userId,
    targetId: result.sessionId,
    result: 'success',
    reason: result.ipCheckSkipped ? 'ip_check_skipped' : null,
    details: auditDetails,
  });

  // Broadcast live counter update. Two independent subselects are cheaper
  // than the prior 3-way JOIN — each hits a PK/index directly:
  //  - attendance: PK (attendance_id) + UNIQUE (session_id, student_id) +
  //    index on session_id via the UNIQUE
  //  - enrollments: PK (course_id, student_id) — course_id-prefix seek
  try {
    const countResult = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM attendance
           WHERE session_id = ${result.sessionId} AND status = 'present') AS present,
        (SELECT COUNT(*)::int FROM enrollments
           WHERE course_id = ${result.courseId} AND removed_at IS NULL) AS total
    `);
    const counts = countResult.rows[0];
    emitAttendanceUpdate(result.sessionId, {
      present: counts.present || 0,
      total: counts.total || 0,
    });
  } catch (err) {
    console.error('[scan-controller] Failed to broadcast attendance update:', err.message);
  }

  // Check threshold for notifications (fires after every successful scan)
  try {
    if (result.courseId) {
      await checkThresholdAndNotify(result.courseId, req.session.userId);
    }
  } catch (err) {
    console.error('[scan-controller] Threshold check failed:', err.message);
  }

  res.json({ message: 'Attendance recorded' });
}
