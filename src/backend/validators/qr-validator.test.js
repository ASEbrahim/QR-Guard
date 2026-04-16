import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db, pool } from '../config/database.js';
import { qrTokens, sessions, courses, users, instructors } from '../db/schema/index.js';
import { sql } from 'drizzle-orm';
import { validateQrToken } from './qr-validator.js';

describe('QrValidator', () => {
  let sessionId;

  beforeAll(async () => {
    // Create an instructor + course + session for test tokens
    const [user] = await db.insert(users).values({
      email: 'qrvtest@auk.edu.kw', passwordHash: '$2b$12$fakehashfakehashfakehashfakehashfakehashfakehashfa', name: 'QRV Test', role: 'instructor',
    }).returning();
    await db.insert(instructors).values({ userId: user.userId, employeeId: 'QRV001' });
    const [course] = await db.insert(courses).values({
      instructorId: user.userId, name: 'Test', code: 'T100', section: '01', semester: 'S26',
      enrollmentCode: 'QRVTST', geofenceCenter: 'SRID=4326;POINT(47.98 29.31)',
      geofenceRadiusM: 100, weeklySchedule: [], semesterStart: '2026-01-01', semesterEnd: '2026-06-01',
    }).returning();
    const [session] = await db.insert(sessions).values({
      courseId: course.courseId, scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 3600000),
    }).returning();
    sessionId = session.sessionId;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM qr_tokens`);
    await db.execute(sql`DELETE FROM sessions`);
    await db.execute(sql`DELETE FROM courses`);
    await db.execute(sql`DELETE FROM instructors`);
    await db.execute(sql`DELETE FROM users WHERE email = 'qrvtest@auk.edu.kw'`);
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM qr_tokens`);
  });

  it('should validate a current token', async () => {
    const payload = Buffer.from(JSON.stringify({ sessionId, courseId: 'test', ts: Date.now(), lat: 29, lng: 47, r: 100 })).toString('base64');
    await db.insert(qrTokens).values({ sessionId, payload, expiresAt: new Date(Date.now() + 30000) });

    const result = await validateQrToken(payload);
    expect(result.sessionId).toBe(sessionId);
  });

  it('should reject an expired token', async () => {
    const payload = Buffer.from(JSON.stringify({ sessionId, courseId: 'test', ts: Date.now() - 60000, lat: 29, lng: 47, r: 100 })).toString('base64');
    await db.insert(qrTokens).values({ sessionId, payload, expiresAt: new Date(Date.now() - 1000) });

    await expect(validateQrToken(payload)).rejects.toThrow('QR expired');
  });

  it('should reject a malformed payload', async () => {
    await expect(validateQrToken('not-valid-base64!!!')).rejects.toThrow();
  });
});
