import { sql } from 'drizzle-orm';
import { db } from '../config/database.js';

/**
 * Calculates attendance % for one student in one course.
 * Uses the canonical SQL from SCHEMA.md.
 * Excused sessions excluded from both numerator and denominator.
 *
 * @param {string} courseId
 * @param {string} studentId
 * @returns {Promise<number|null>} percentage (0-100) or null if no closed sessions
 */
export async function calculateAttendancePct(courseId, studentId) {
  // COALESCE handles absent students who have no attendance row:
  // LEFT JOIN produces NULL for a.status → COALESCE maps to 'absent'
  const result = await db.execute(sql`
    WITH session_statuses AS (
      SELECT
        s.session_id,
        COALESCE(a.status, 'absent') AS effective_status
      FROM sessions s
      LEFT JOIN attendance a
        ON a.session_id = s.session_id
        AND a.student_id = ${studentId}
      WHERE s.course_id = ${courseId}
        AND s.status = 'closed'
    )
    SELECT
      COUNT(*) FILTER (WHERE effective_status = 'present') * 100.0
      / NULLIF(COUNT(*) FILTER (WHERE effective_status IN ('present', 'absent')), 0)
      AS attendance_pct
    FROM session_statuses
  `);

  const pct = result.rows[0]?.attendance_pct;
  return pct !== null && pct !== undefined ? parseFloat(pct) : null;
}

/**
 * Calculates attendance % for a single student across a set of courses in
 * one query. Avoids the N+1 pattern in getMyAttendance, which previously
 * called calculateAttendancePct(courseId, studentId) inside a for-loop
 * over the student's enrolled courses.
 *
 * @param {string[]} courseIds
 * @param {string} studentId
 * @returns {Promise<Map<string, number|null>>} courseId → percentage
 */
export async function calculateAttendancePctsForStudent(courseIds, studentId) {
  if (courseIds.length === 0) return new Map();
  const result = await db.execute(sql`
    WITH course_session_statuses AS (
      SELECT
        s.course_id,
        COALESCE(a.status, 'absent') AS effective_status
      FROM sessions s
      LEFT JOIN attendance a
        ON a.session_id = s.session_id
        AND a.student_id = ${studentId}
      WHERE s.course_id = ANY(${courseIds})
        AND s.status = 'closed'
    )
    SELECT
      course_id,
      COUNT(*) FILTER (WHERE effective_status = 'present') * 100.0
      / NULLIF(COUNT(*) FILTER (WHERE effective_status IN ('present', 'absent')), 0)
      AS attendance_pct
    FROM course_session_statuses
    GROUP BY course_id
  `);

  const map = new Map();
  for (const id of courseIds) map.set(id, null);
  for (const row of result.rows) {
    map.set(row.course_id, row.attendance_pct ? parseFloat(row.attendance_pct) : null);
  }
  return map;
}

/**
 * Calculates attendance % for all enrolled students in a course.
 * Used by the roster view for at-risk flags.
 *
 * @param {string} courseId
 * @returns {Promise<Map<string, number|null>>} studentId → percentage
 */
export async function calculateAllAttendancePcts(courseId) {
  const result = await db.execute(sql`
    WITH student_session_statuses AS (
      SELECT
        e.student_id,
        COALESCE(a.status, 'absent') AS effective_status
      FROM enrollments e
      CROSS JOIN sessions s
      LEFT JOIN attendance a
        ON a.session_id = s.session_id
        AND a.student_id = e.student_id
      WHERE e.course_id = ${courseId}
        AND e.removed_at IS NULL
        AND s.course_id = ${courseId}
        AND s.status = 'closed'
    )
    SELECT
      student_id,
      COUNT(*) FILTER (WHERE effective_status = 'present') * 100.0
      / NULLIF(COUNT(*) FILTER (WHERE effective_status IN ('present', 'absent')), 0)
      AS attendance_pct
    FROM student_session_statuses
    GROUP BY student_id
  `);

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.student_id, row.attendance_pct ? parseFloat(row.attendance_pct) : null);
  }
  return map;
}
