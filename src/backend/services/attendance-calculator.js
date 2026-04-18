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
  // Prior implementation used `enrollments CROSS JOIN sessions LEFT JOIN
  // attendance`, which materialized n_students × m_sessions rows. For a
  // 300-student course with a full-semester 30 closed sessions that's 9k
  // rows materialized to compute percentages. The rewrite below avoids
  // the CROSS JOIN by counting present / excused attendance rows per
  // student, then dividing by (closed_session_count - excused_count).
  //
  // Math equivalence: in the old query,
  //   pct = present / (present + absent)
  // with absent = closed_count - present - excused, so
  //   pct = present / (closed_count - excused)
  // which is what this query computes directly.
  const result = await db.execute(sql`
    WITH closed_count AS (
      SELECT COUNT(*)::int AS n
      FROM sessions
      WHERE course_id = ${courseId}
        AND status = 'closed'
    ),
    closed_session_ids AS (
      SELECT session_id
      FROM sessions
      WHERE course_id = ${courseId}
        AND status = 'closed'
    ),
    per_student AS (
      SELECT
        e.student_id,
        COUNT(*) FILTER (WHERE a.status = 'present') AS present_count,
        COUNT(*) FILTER (WHERE a.status = 'excused') AS excused_count
      FROM enrollments e
      LEFT JOIN attendance a
        ON a.student_id = e.student_id
        AND a.session_id IN (SELECT session_id FROM closed_session_ids)
      WHERE e.course_id = ${courseId}
        AND e.removed_at IS NULL
      GROUP BY e.student_id
    )
    SELECT
      ps.student_id,
      CASE
        WHEN (cc.n - ps.excused_count) > 0
          THEN ps.present_count * 100.0 / (cc.n - ps.excused_count)
        ELSE NULL
      END AS attendance_pct
    FROM per_student ps
    CROSS JOIN closed_count cc
  `);

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.student_id, row.attendance_pct ? parseFloat(row.attendance_pct) : null);
  }
  return map;
}
