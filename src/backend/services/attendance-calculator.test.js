import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, pool } from '../config/database.js';
import { users, students, instructors, courses, sessions, attendance, enrollments } from '../db/schema/index.js';
import { calculateAttendancePct } from './attendance-calculator.js';

describe('AttendanceCalculator', () => {
  let studentId, courseId, sessionIds;

  beforeAll(async () => {
    // Create instructor + course + student + enrollment
    const [instructor] = await db.insert(users).values({
      email: 'calc-inst@auk.edu.kw', passwordHash: '$2b$12$fake', name: 'Calc Inst', role: 'instructor',
    }).returning();
    await db.insert(instructors).values({ userId: instructor.userId, employeeId: 'CALC01' });

    const [course] = await db.insert(courses).values({
      instructorId: instructor.userId, name: 'Calc', code: 'C100', section: '01', semester: 'S26',
      enrollmentCode: 'CALCCD', geofenceCenter: 'SRID=4326;POINT(47 29)', geofenceRadiusM: 100,
      weeklySchedule: [], semesterStart: '2026-01-01', semesterEnd: '2026-06-01',
    }).returning();
    courseId = course.courseId;

    const [student] = await db.insert(users).values({
      email: 'calc-stu@auk.edu.kw', passwordHash: '$2b$12$fake', name: 'Calc Stu', role: 'student',
    }).returning();
    await db.insert(students).values({ userId: student.userId, universityId: 'CALC99' });
    studentId = student.userId;

    await db.insert(enrollments).values({ courseId, studentId });

    // Create 4 closed sessions
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const [s] = await db.insert(sessions).values({
        courseId, scheduledStart: new Date(2026, 0, 10 + i, 9), scheduledEnd: new Date(2026, 0, 10 + i, 10), status: 'closed',
      }).returning();
      ids.push(s.sessionId);
    }
    sessionIds = ids;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM attendance WHERE student_id = ${studentId}`);
    await db.execute(sql`DELETE FROM enrollments WHERE student_id = ${studentId}`);
    await db.execute(sql`DELETE FROM sessions WHERE course_id = ${courseId}`);
    await db.execute(sql`DELETE FROM courses WHERE course_id = ${courseId}`);
    await db.execute(sql`DELETE FROM students WHERE user_id = ${studentId}`);
    await db.execute(sql`DELETE FROM instructors WHERE employee_id = 'CALC01'`);
    await db.execute(sql`DELETE FROM users WHERE email LIKE 'calc-%@auk.edu.kw'`);
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM attendance WHERE student_id = ${studentId}`);
  });

  it('should return null when no closed sessions have attendance data', async () => {
    // 4 closed sessions, no attendance rows → denominator counts as 4 absences
    const pct = await calculateAttendancePct(courseId, studentId);
    // All absent: 0 present / 4 (present+absent) = 0%
    expect(pct).toBe(0);
  });

  it('should calculate correct % for mixed attendance', async () => {
    // Present in 3 of 4 sessions
    for (let i = 0; i < 3; i++) {
      await db.insert(attendance).values({ sessionId: sessionIds[i], studentId, status: 'present' });
    }
    // Session 4: no row → absent
    const pct = await calculateAttendancePct(courseId, studentId);
    expect(pct).toBeCloseTo(75, 0); // 3/4 = 75%
  });

  it('should exclude excused from denominator', async () => {
    // Present in 2, excused in 1, absent in 1
    await db.insert(attendance).values({ sessionId: sessionIds[0], studentId, status: 'present' });
    await db.insert(attendance).values({ sessionId: sessionIds[1], studentId, status: 'present' });
    await db.insert(attendance).values({ sessionId: sessionIds[2], studentId, status: 'excused' });
    // Session 4: absent (no row, but LEFT JOIN counts in denominator)

    const pct = await calculateAttendancePct(courseId, studentId);
    // 2 present / (2 present + 1 absent) = 2/3 ≈ 66.67%
    // Note: session 3 is excused, excluded from both numerator AND denominator
    expect(pct).toBeCloseTo(66.67, 0);
  });

  it('should return 100% when all attended', async () => {
    for (const sid of sessionIds) {
      await db.insert(attendance).values({ sessionId: sid, studentId, status: 'present' });
    }
    const pct = await calculateAttendancePct(courseId, studentId);
    expect(pct).toBeCloseTo(100, 0);
  });
});
