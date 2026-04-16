import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { attendance } from '../db/schema/index.js';
import { verifyScan } from '../validators/scan-verifier.js';
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
    return res.status(403).json({ error: result.message, code: result.reason });
  }

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
    // UNIQUE constraint violation = already recorded
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already recorded', code: 'already_recorded' });
    }
    throw err;
  }

  // Broadcast live counter update
  try {
    const countResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE a.status = 'present') AS present,
        COUNT(DISTINCT e.student_id) AS total
      FROM enrollments e
      LEFT JOIN attendance a ON a.session_id = ${result.sessionId} AND a.student_id = e.student_id
      INNER JOIN sessions s ON s.course_id = e.course_id AND s.session_id = ${result.sessionId}
      WHERE e.removed_at IS NULL
    `);
    const counts = countResult.rows[0];
    emitAttendanceUpdate(result.sessionId, {
      present: parseInt(counts.present) || 0,
      total: parseInt(counts.total) || 0,
    });
  } catch (err) {
    console.error('[scan-controller] Failed to broadcast attendance update:', err.message);
  }

  // Check threshold for notifications (fires after every successful scan)
  try {
    // Decode the QR payload to get courseId
    const decoded = JSON.parse(Buffer.from(qrPayload, 'base64').toString('utf-8'));
    if (decoded.courseId) {
      await checkThresholdAndNotify(decoded.courseId, req.session.userId);
    }
  } catch (err) {
    console.error('[scan-controller] Threshold check failed:', err.message);
  }

  res.json({ message: 'Attendance recorded' });
}
