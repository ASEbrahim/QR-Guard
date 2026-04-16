import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { attendance, sessions, courses, auditLog } from '../db/schema/index.js';
import { checkThresholdAndNotify } from '../services/notification-service.js';

const overrideSchema = z.object({
  studentId: z.string().uuid(),
  status: z.enum(['present', 'absent', 'excused']),
  reason: z.string().min(1, 'Reason is required for overrides'),
});

/**
 * POST /api/sessions/:id/override
 * Instructor overrides a student's attendance status for a session.
 * Creates or updates the attendance row + appends to audit log.
 */
export async function overrideAttendance(req, res) {
  const { id: sessionId } = req.params;
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const { studentId, status, reason } = parsed.data;

  // Verify instructor owns the session's course
  const [session] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const [course] = await db.select().from(courses)
    .where(and(eq(courses.courseId, session.courseId), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(403).json({ error: 'Not your course' });

  // Check for existing attendance row
  const [existing] = await db.select().from(attendance)
    .where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, studentId)))
    .limit(1);

  const oldStatus = existing?.status || 'absent';
  let attendanceRow;

  if (existing) {
    // Update existing row
    [attendanceRow] = await db.update(attendance)
      .set({
        status,
        excuseReason: status === 'excused' ? reason : existing.excuseReason,
      })
      .where(eq(attendance.attendanceId, existing.attendanceId))
      .returning();
  } else {
    // Insert new row (student was absent — no scan row existed)
    [attendanceRow] = await db.insert(attendance).values({
      sessionId,
      studentId,
      status,
      excuseReason: status === 'excused' ? reason : null,
    }).returning();
  }

  // Audit log entry
  const [auditEntry] = await db.insert(auditLog).values({
    eventType: 'override',
    actorId: req.session.userId,
    targetId: sessionId,
    result: 'success',
    reason: `override_${status}`,
    details: {
      studentId,
      oldStatus,
      newStatus: status,
      reason,
      instructorId: req.session.userId,
    },
  }).returning();

  // Check threshold after override (may trigger notification)
  try {
    await checkThresholdAndNotify(session.courseId, studentId);
  } catch (err) {
    console.error('[override] Threshold check failed:', err.message);
  }

  res.json({ attendance: attendanceRow, auditEntry });
}
