import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { attendance, sessions, courses, auditLog, enrollments } from '../db/schema/index.js';
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

  // Verify the target student is actually enrolled in this course. Without
  // this check, body.studentId could be any UUID and we'd insert spurious
  // attendance rows (or leak FK errors as existence oracles).
  const [enrollment] = await db.select().from(enrollments)
    .where(and(
      eq(enrollments.courseId, session.courseId),
      eq(enrollments.studentId, studentId),
      isNull(enrollments.removedAt),
    ))
    .limit(1);
  if (!enrollment) return res.status(404).json({ error: 'Student not enrolled in this course' });

  // The attendance upsert + audit_log insert run together in a transaction
  // so we never end up with one without the other (previous behavior left
  // orphan writes on partial failure).
  const { attendanceRow, auditEntry, oldStatus } = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(attendance)
      .where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, studentId)))
      .limit(1);

    const prevStatus = existing?.status || 'absent';
    let row;

    if (existing) {
      [row] = await tx.update(attendance)
        .set({
          status,
          excuseReason: status === 'excused' ? reason : existing.excuseReason,
        })
        .where(eq(attendance.attendanceId, existing.attendanceId))
        .returning();
    } else {
      [row] = await tx.insert(attendance).values({
        sessionId,
        studentId,
        status,
        excuseReason: status === 'excused' ? reason : null,
      }).returning();
    }

    const [audit] = await tx.insert(auditLog).values({
      eventType: 'override',
      actorId: req.session.userId,
      targetId: sessionId,
      result: 'success',
      reason: `override_${status}`,
      details: {
        studentId,
        oldStatus: prevStatus,
        newStatus: status,
        reason,
        instructorId: req.session.userId,
      },
    }).returning();

    return { attendanceRow: row, auditEntry: audit, oldStatus: prevStatus };
  });
  // oldStatus is returned for potential future use; not consumed by response.
  void oldStatus;

  // Check threshold after override (may trigger notification)
  try {
    await checkThresholdAndNotify(session.courseId, studentId);
  } catch (err) {
    console.error('[override] Threshold check failed:', err.message);
  }

  res.json({ attendance: attendanceRow, auditEntry });
}
