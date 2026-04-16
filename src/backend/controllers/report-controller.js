import { eq, and, isNull, gte, lte, sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import { db } from '../config/database.js';
import {
  courses, sessions, attendance, enrollments, students, users,
} from '../db/schema/index.js';
import { calculateAttendancePct, calculateAllAttendancePcts } from '../services/attendance-calculator.js';

/**
 * GET /api/courses/:id/attendance
 * Per-session report: each closed session with student list + statuses.
 */
export async function getPerSessionReport(req, res) {
  const { id } = req.params;

  // Verify instructor owns this course
  const [course] = await db.select().from(courses)
    .where(and(eq(courses.courseId, id), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  // Get all closed sessions
  const closedSessions = await db.select().from(sessions)
    .where(and(eq(sessions.courseId, id), eq(sessions.status, 'closed')))
    .orderBy(sessions.scheduledStart);

  // Get all enrolled students
  const enrolled = await db.select({ studentId: enrollments.studentId, name: users.name })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.userId))
    .where(and(eq(enrollments.courseId, id), isNull(enrollments.removedAt)));

  // Build report: for each session, LEFT JOIN enrolled students to attendance
  const report = [];
  for (const sess of closedSessions) {
    const attendanceRows = await db.select().from(attendance)
      .where(eq(attendance.sessionId, sess.sessionId));
    const attendanceMap = new Map(attendanceRows.map((a) => [a.studentId, a]));

    const studentStatuses = enrolled.map((s) => {
      const a = attendanceMap.get(s.studentId);
      return {
        studentId: s.studentId,
        name: s.name,
        status: a ? a.status : 'absent',
        recordedAt: a?.recordedAt || null,
        gpsLat: a?.gpsLat || null,
        gpsLng: a?.gpsLng || null,
      };
    });

    report.push({
      session: sess,
      students: studentStatuses,
      presentCount: studentStatuses.filter((s) => s.status === 'present').length,
      totalEnrolled: enrolled.length,
    });
  }

  res.json({ sessions: report });
}

/**
 * GET /api/courses/:id/attendance/student/:studentId
 * Per-student report: all sessions with statuses and running %.
 * Accessible by the instructor OR the student themselves.
 */
export async function getPerStudentReport(req, res) {
  const { id, studentId } = req.params;

  // Auth check: instructor of the course OR the student themselves
  if (req.session.role === 'instructor') {
    const [course] = await db.select().from(courses)
      .where(and(eq(courses.courseId, id), eq(courses.instructorId, req.session.userId)))
      .limit(1);
    if (!course) return res.status(403).json({ error: 'Not your course' });
  } else if (req.session.userId !== studentId) {
    return res.status(403).json({ error: 'Cannot view another student\'s attendance' });
  }

  const closedSessions = await db.select().from(sessions)
    .where(and(eq(sessions.courseId, id), eq(sessions.status, 'closed')))
    .orderBy(sessions.scheduledStart);

  const attendanceRows = await db.select().from(attendance)
    .where(eq(attendance.studentId, studentId));
  const attendanceMap = new Map(attendanceRows.map((a) => [a.sessionId, a]));

  const sessionStatuses = closedSessions.map((s) => {
    const a = attendanceMap.get(s.sessionId);
    return {
      sessionId: s.sessionId,
      date: s.scheduledStart,
      status: a ? a.status : 'absent',
      recordedAt: a?.recordedAt || null,
    };
  });

  const [student] = await db.select({ name: users.name, universityId: students.universityId })
    .from(users)
    .innerJoin(students, eq(users.userId, students.userId))
    .where(eq(users.userId, studentId))
    .limit(1);

  const pct = await calculateAttendancePct(id, studentId);

  res.json({ student, sessions: sessionStatuses, attendancePct: pct });
}

/**
 * GET /api/courses/:id/attendance.csv
 * CSV export with optional filters: from, to, studentId, status.
 */
export async function exportCsv(req, res) {
  const { id } = req.params;

  const [course] = await db.select().from(courses)
    .where(and(eq(courses.courseId, id), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  // Build query with filters
  const conditions = [eq(sessions.courseId, id), eq(sessions.status, 'closed')];
  if (req.query.from) conditions.push(gte(sessions.scheduledStart, new Date(req.query.from)));
  if (req.query.to) conditions.push(lte(sessions.scheduledStart, new Date(req.query.to)));

  const closedSessions = await db.select().from(sessions).where(and(...conditions)).orderBy(sessions.scheduledStart);
  const enrolled = await db.select({ studentId: enrollments.studentId, name: users.name, universityId: students.universityId })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.userId))
    .innerJoin(students, eq(enrollments.studentId, students.userId))
    .where(and(eq(enrollments.courseId, id), isNull(enrollments.removedAt)));

  const rows = [];
  for (const sess of closedSessions) {
    const attendanceRows = await db.select().from(attendance).where(eq(attendance.sessionId, sess.sessionId));
    const attendanceMap = new Map(attendanceRows.map((a) => [a.studentId, a]));

    for (const s of enrolled) {
      const a = attendanceMap.get(s.studentId);
      const status = a ? a.status : 'absent';

      // Apply filters
      if (req.query.studentId && s.studentId !== req.query.studentId) continue;
      if (req.query.status && status !== req.query.status) continue;

      rows.push({
        Date: new Date(sess.scheduledStart).toISOString().split('T')[0],
        Time: new Date(sess.scheduledStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        StudentName: s.name,
        UniversityId: s.universityId,
        Status: status,
        RecordedAt: a?.recordedAt ? new Date(a.recordedAt).toISOString() : '',
      });
    }
  }

  const csv = stringify(rows, { header: true });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${course.code}-attendance.csv"`);
  res.send(csv);
}

/**
 * GET /api/me/attendance
 * Student self-view: attendance % per enrolled course.
 */
export async function getMyAttendance(req, res) {
  const studentId = req.session.userId;

  const enrolled = await db
    .select({ courseId: courses.courseId, name: courses.name, code: courses.code, section: courses.section, semester: courses.semester })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.courseId))
    .where(and(eq(enrollments.studentId, studentId), isNull(enrollments.removedAt)));

  const result = [];
  for (const c of enrolled) {
    const pct = await calculateAttendancePct(c.courseId, studentId);
    result.push({ ...c, attendancePct: pct });
  }

  res.json({ courses: result });
}

/**
 * GET /api/courses/:id/audit-log
 * Paginated audit log for a course. Instructor only.
 */
export async function getAuditLog(req, res) {
  const { id } = req.params;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const [course] = await db.select().from(courses)
    .where(and(eq(courses.courseId, id), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  // Get session IDs for this course to filter audit log
  const courseSessions = await db.select({ sessionId: sessions.sessionId }).from(sessions)
    .where(eq(sessions.courseId, id));
  const sessionIds = courseSessions.map((s) => s.sessionId);

  if (sessionIds.length === 0) return res.json({ entries: [], total: 0, page });

  const result = await db.execute(sql`
    SELECT * FROM audit_log
    WHERE target_id = ANY(${sessionIds})
    ORDER BY timestamp DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total FROM audit_log
    WHERE target_id = ANY(${sessionIds})
  `);

  res.json({
    entries: result.rows,
    total: parseInt(countResult.rows[0].total),
    page,
  });
}

/**
 * GET /api/courses/:id/students (updated from Sprint A)
 * Now includes real attendance % and at-risk flag.
 */
export async function getEnrolledStudentsWithPct(req, res) {
  const { id } = req.params;

  const [course] = await db.select().from(courses)
    .where(and(eq(courses.courseId, id), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  const enrolled = await db
    .select({ userId: students.userId, name: users.name, email: users.email, universityId: students.universityId, enrolledAt: enrollments.enrolledAt })
    .from(enrollments)
    .innerJoin(students, eq(enrollments.studentId, students.userId))
    .innerJoin(users, eq(students.userId, users.userId))
    .where(and(eq(enrollments.courseId, id), isNull(enrollments.removedAt)));

  const pctMap = await calculateAllAttendancePcts(id);
  const threshold = parseFloat(course.warningThresholdPct);

  const result = enrolled.map((s) => {
    const pct = pctMap.get(s.userId) ?? null;
    return {
      ...s,
      attendancePct: pct,
      atRisk: pct !== null && pct <= threshold,
    };
  });

  res.json({ students: result });
}
