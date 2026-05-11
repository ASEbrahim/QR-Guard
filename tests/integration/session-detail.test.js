import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { pool, db } from '../../src/backend/config/database.js';
import {
  users, instructors, students, courses, sessions, enrollments, attendance, auditLog,
} from '../../src/backend/db/schema/index.js';
import sessionRoutes from '../../src/backend/routes/session-routes.js';
import { BCRYPT_ROUNDS } from '../../src/backend/config/constants.js';
import { sql } from 'drizzle-orm';

// Test app that injects a session user without going through real auth flow.
// The detail endpoint needs req.session.userId + role; we set those directly.
function createTestApp(userId, role = 'instructor') {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test-secret', resave: false, saveUninitialized: true }),
  );
  // Inject session before routes
  app.use((req, _res, next) => {
    req.session.userId = userId;
    req.session.role = role;
    next();
  });
  app.use('/api/sessions', sessionRoutes);
  return app;
}

async function cleanAll() {
  await db.execute(sql`DELETE FROM warning_email_log`);
  await db.execute(sql`DELETE FROM attendance`);
  // audit_log has triggers rejecting UPDATE/DELETE; disable them just long
  // enough to clear the test data between cases.
  await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM audit_log`);
  await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER USER`);
  await db.execute(sql`DELETE FROM qr_tokens`);
  await db.execute(sql`DELETE FROM sessions`);
  await db.execute(sql`DELETE FROM enrollments`);
  await db.execute(sql`DELETE FROM courses`);
  await db.execute(sql`DELETE FROM students`);
  await db.execute(sql`DELETE FROM instructors`);
  await db.execute(sql`DELETE FROM users`);
}

async function seedFixture() {
  const hash = await bcrypt.hash('x', BCRYPT_ROUNDS);

  const [inst] = await db.insert(users).values({
    email: 'inst@auk.edu.kw', passwordHash: hash, name: 'Dr. Inst', role: 'instructor',
    emailVerifiedAt: new Date(),
  }).returning();
  await db.insert(instructors).values({ userId: inst.userId, employeeId: 'E1' });

  const [stu1] = await db.insert(users).values({
    email: 's1@auk.edu.kw', passwordHash: hash, name: 'Alice', role: 'student',
    emailVerifiedAt: new Date(),
  }).returning();
  await db.insert(students).values({ userId: stu1.userId, universityId: 'S1' });

  const [stu2] = await db.insert(users).values({
    email: 's2@auk.edu.kw', passwordHash: hash, name: 'Bob', role: 'student',
    emailVerifiedAt: new Date(),
  }).returning();
  await db.insert(students).values({ userId: stu2.userId, universityId: 'S2' });

  const [course] = await db.insert(courses).values({
    instructorId: inst.userId,
    name: 'Software Eng', code: 'CSIS 330', section: '01', semester: 'S26',
    enrollmentCode: 'ABCD23',
    geofenceCenter: 'SRID=4326;POINT(47.98 29.31)',
    geofenceRadiusM: 100,
    weeklySchedule: [], semesterStart: '2026-01-01', semesterEnd: '2026-06-01',
  }).returning();

  await db.insert(enrollments).values([
    { courseId: course.courseId, studentId: stu1.userId },
    { courseId: course.courseId, studentId: stu2.userId },
  ]);

  const [sess] = await db.insert(sessions).values({
    courseId: course.courseId,
    scheduledStart: new Date('2026-04-17T11:00:00Z'),
    scheduledEnd: new Date('2026-04-17T13:15:00Z'),
    status: 'closed',
  }).returning();

  // Alice present, Bob has no record (so should appear as absent)
  await db.insert(attendance).values({
    sessionId: sess.sessionId, studentId: stu1.userId,
    status: 'present', gpsLat: '29.3117', gpsLng: '47.9835',
  });

  // One rejected scan attempt by Bob
  await db.insert(auditLog).values({
    eventType: 'scan_attempt', actorId: stu2.userId, targetId: sess.sessionId,
    result: 'rejected', reason: 'outside_geofence',
    details: { gpsLat: 29.40, gpsLng: 48.00 },
  });

  return { inst, stu1, stu2, course, sess };
}

describe('GET /api/sessions/:id/detail', () => {
  beforeAll(async () => { await cleanAll(); });
  afterAll(async () => { await cleanAll(); await pool.end(); });
  beforeEach(async () => { await cleanAll(); });

  it('returns session, stats, full roster, and rejected scans for the owning instructor', async () => {
    const { inst, stu1, stu2, sess } = await seedFixture();
    const app = createTestApp(inst.userId);

    const res = await request(app).get(`/api/sessions/${sess.sessionId}/detail`);

    expect(res.status).toBe(200);
    expect(res.body.session.sessionId).toBe(sess.sessionId);
    expect(res.body.session.course.code).toBe('CSIS 330');
    expect(res.body.stats).toEqual({ present: 1, absent: 1, excused: 0, total: 2 });

    expect(res.body.roster).toHaveLength(2);
    const aliceRow = res.body.roster.find((r) => r.name === 'Alice');
    const bobRow = res.body.roster.find((r) => r.name === 'Bob');
    expect(aliceRow.status).toBe('present');
    expect(aliceRow.recordedAt).toBeTruthy();
    expect(bobRow.status).toBe('absent');
    expect(bobRow.recordedAt).toBeNull();

    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].reason).toBe('outside_geofence');
    expect(res.body.rejected[0].studentName).toBe('Bob');
  });

  it('returns 403 when called by a different instructor', async () => {
    const { sess } = await seedFixture();
    // Create a second instructor who does NOT own the course
    const hash = await bcrypt.hash('x', BCRYPT_ROUNDS);
    const [otherInst] = await db.insert(users).values({
      email: 'other@auk.edu.kw', passwordHash: hash, name: 'Other', role: 'instructor',
      emailVerifiedAt: new Date(),
    }).returning();
    await db.insert(instructors).values({ userId: otherInst.userId, employeeId: 'E2' });

    const app = createTestApp(otherInst.userId);
    const res = await request(app).get(`/api/sessions/${sess.sessionId}/detail`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent session id', async () => {
    const { inst } = await seedFixture();
    const app = createTestApp(inst.userId);
    const res = await request(app).get('/api/sessions/00000000-0000-0000-0000-000000000000/detail');
    expect(res.status).toBe(404);
  });
});
