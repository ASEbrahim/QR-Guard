import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { warningEmailLog, courses, users } from '../db/schema/index.js';
import { calculateAttendancePct } from './attendance-calculator.js';
import { sendEmail } from './email-service.js';

const AUK_ABSENCE_LIMIT_PCT = 15; // AUK policy: 15% absence = exceeded

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
      // New crossing — send warning email
      await db.insert(warningEmailLog).values({
        courseId,
        studentId,
        crossedBelowAt: new Date(),
      });

      const [student] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.userId, studentId))
        .limit(1);

      if (student) {
        // Count absences
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
      }

      // Check AUK 15% absence limit (100 - pct > 15 means absences exceed 15%)
      if (student && 100 - pct >= AUK_ABSENCE_LIMIT_PCT) {
        await notifyInstructorAukLimit(course, student, pct);
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
