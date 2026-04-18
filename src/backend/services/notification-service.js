import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { warningEmailLog, courses, users } from '../db/schema/index.js';
import { calculateAttendancePct } from './attendance-calculator.js';
import { sendEmail } from './email-service.js';
import { AUK_ABSENCE_LIMIT_PCT } from '../config/constants.js';

/**
 * Checks if a student's attendance % crossed below the course warning threshold
 * after a scan or override, and sends a warning email if it's a new crossing.
 *
 * One-per-crossing semantics via warning_email_log:
 * - Only fires when no open crossing exists (recovered_above_at IS NULL)
 * - Recovering above threshold sets recovered_above_at
 * - Dropping below again inserts a new row
 *
 * @param {string} courseId
 * @param {string} studentId
 */
export async function checkThresholdAndNotify(courseId, studentId) {
  const pct = await calculateAttendancePct(courseId, studentId);
  if (pct === null) return; // No closed sessions yet

  const [course] = await db.select().from(courses).where(eq(courses.courseId, courseId)).limit(1);
  if (!course) return;

  const threshold = parseFloat(course.warningThresholdPct);

  // Check for an open (unrecovered) crossing
  const [openCrossing] = await db
    .select()
    .from(warningEmailLog)
    .where(
      and(
        eq(warningEmailLog.courseId, courseId),
        eq(warningEmailLog.studentId, studentId),
        isNull(warningEmailLog.recoveredAboveAt),
      ),
    )
    .limit(1);

  if (pct < threshold) {
    // Below threshold
    if (!openCrossing) {
      // New crossing — atomically claim it via ON CONFLICT DO NOTHING against
      // the partial unique index on (course_id, student_id) WHERE
      // recovered_above_at IS NULL (migration 0004). If our INSERT returned
      // zero rows, a concurrent call already claimed it and will email;
      // we skip to avoid duplicate emails.
      const crossedBelowAt = new Date();
      const claim = await db
        .insert(warningEmailLog)
        .values({ courseId, studentId, crossedBelowAt })
        .onConflictDoNothing({
          target: [warningEmailLog.courseId, warningEmailLog.studentId],
          where: sql`recovered_above_at IS NULL`,
        })
        .returning();

      if (claim.length === 0) {
        // Lost the race — peer will handle it.
        return;
      }

      const [student] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.userId, studentId))
        .limit(1);

      let emailSent = false;
      if (student) {
        try {
          const absenceCount = Math.round((100 - pct) / 100 * await getClosedSessionCount(courseId));
          await sendEmail({
            to: student.email,
            subject: `QR-Guard: Attendance warning for ${course.code}`,
            text: [
              `Dear ${student.name},`,
              '',
              `Your attendance in ${course.code} — ${course.name} has dropped below the warning threshold.`,
              '',
              `  Current attendance: ${pct.toFixed(1)}%`,
              `  Warning threshold: ${threshold}%`,
              `  Absences: ~${absenceCount}`,
              '',
              'Please contact your instructor if you need assistance.',
            ].join('\n'),
          });
          emailSent = true;
        } catch (err) {
          console.error('[notification] Student warning email failed:', err.message);
        }
      }

      // If the email failed, release the crossing claim so the next call can
      // retry. Historical (recovered) rows are not affected because this row
      // still has recovered_above_at IS NULL.
      if (!emailSent) {
        await db
          .delete(warningEmailLog)
          .where(and(
            eq(warningEmailLog.courseId, courseId),
            eq(warningEmailLog.studentId, studentId),
            eq(warningEmailLog.crossedBelowAt, crossedBelowAt),
          ));
        return;
      }

      // Check AUK 15% absence limit
      if (student && 100 - pct >= AUK_ABSENCE_LIMIT_PCT) {
        try {
          await notifyInstructorAukLimit(course, student, pct);
        } catch (err) {
          // Instructor notification failure must not unwind the student-warning
          // claim (the student was already emailed). Log and continue.
          console.error('[notification] Instructor AUK-limit email failed:', err.message);
        }
      }
    }
    // If openCrossing already exists, don't send another email
  } else {
    // Above threshold — close the open crossing if one exists
    if (openCrossing) {
      await db
        .update(warningEmailLog)
        .set({ recoveredAboveAt: new Date() })
        .where(
          and(
            eq(warningEmailLog.courseId, courseId),
            eq(warningEmailLog.studentId, studentId),
            eq(warningEmailLog.crossedBelowAt, openCrossing.crossedBelowAt),
          ),
        );
    }
  }
}

/**
 * Notifies the instructor when a student exceeds the AUK 15% absence limit.
 */
async function notifyInstructorAukLimit(course, student, pct) {
  const [instructor] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.userId, course.instructorId))
    .limit(1);

  if (!instructor) return;

  await sendEmail({
    to: instructor.email,
    subject: `QR-Guard: Student exceeded AUK absence limit in ${course.code}`,
    text: [
      `Dear ${instructor.name},`,
      '',
      `${student.name} has exceeded the AUK 15% absence limit in ${course.code} — ${course.name}.`,
      `Current attendance: ${pct.toFixed(1)}%`,
      '',
      'This notification is sent once per threshold crossing.',
    ].join('\n'),
  });
}

/**
 * Gets the count of closed sessions for a course.
 */
async function getClosedSessionCount(courseId) {
  const result = await db.execute(
    sql`SELECT COUNT(*) AS cnt FROM sessions WHERE course_id = ${courseId} AND status = 'closed'`,
  );
  return parseInt(result.rows[0]?.cnt) || 0;
}
