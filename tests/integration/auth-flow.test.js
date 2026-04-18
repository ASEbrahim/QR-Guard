import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { pool, db } from '../../src/backend/config/database.js';
import { users, instructors, emailVerificationTokens } from '../../src/backend/db/schema/index.js';
import authRoutes from '../../src/backend/routes/auth-routes.js';
import { BCRYPT_ROUNDS } from '../../src/backend/config/constants.js';
import { sql } from 'drizzle-orm';

// Build a test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use('/api/auth', authRoutes);
  return app;
}

describe('Auth Flow', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  afterAll(async () => {
    await cleanAll();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanAll();
  });

  async function cleanAll() {
    // Delete in reverse FK order to avoid constraint violations
    await db.execute(sql`DELETE FROM warning_email_log`);
    await db.execute(sql`DELETE FROM attendance`);
    await db.execute(sql`DELETE FROM audit_log`);
    await db.execute(sql`DELETE FROM qr_tokens`);
    await db.execute(sql`DELETE FROM sessions`);
    await db.execute(sql`DELETE FROM enrollments`);
    await db.execute(sql`DELETE FROM courses`);
    await db.execute(sql`DELETE FROM email_verification_tokens`);
    await db.execute(sql`DELETE FROM instructors`);
    await db.execute(sql`DELETE FROM students`);
    await db.execute(sql`DELETE FROM users`);
  }

  // AC 1: Student registers with @auk.edu.kw + verification email
  it('should register a student with valid @auk.edu.kw email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@auk.edu.kw',
      password: 'password123',
      name: 'Test Student',
      role: 'student',
      universityId: '12345',
    });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBeDefined();
  });

  // AC 2: Non-AUK email rejected
  it('should reject non-AUK email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@gmail.com',
      password: 'password123',
      name: 'Test',
      role: 'student',
      universityId: '12345',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('auk.edu.kw');
  });

  // AC 3: Login fails before verification
  it('should reject login before email verification', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'unverified@auk.edu.kw',
      password: 'password123',
      name: 'Unverified',
      role: 'student',
      universityId: '99999',
    });

    const res = await request(app).post('/api/auth/login').send({
      email: 'unverified@auk.edu.kw',
      password: 'password123',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not verified');
  });

  // AC 4 + 5: After verification, login succeeds + correct redirect
  it('should login after email verification and redirect student', async () => {
    // Register
    await request(app).post('/api/auth/register').send({
      email: 'verified@auk.edu.kw',
      password: 'password123',
      name: 'Verified Student',
      role: 'student',
      universityId: '11111',
    });

    // Get token from DB
    const [token] = await db.select().from(emailVerificationTokens).limit(1);

    // Verify
    const verifyRes = await request(app).get(`/api/auth/verify-email?token=${token.token}`);
    expect(verifyRes.status).toBe(200);

    // Login
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'verified@auk.edu.kw',
      password: 'password123',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.redirectUrl).toBe('/student/dashboard.html');
  });

  // AC 5: Instructor redirect
  // Instructors are provisioned via scripts/seed.js — not via the public
  // register endpoint (student-only). This test seeds an instructor directly
  // to verify login redirect behavior.
  it('should redirect instructor to instructor dashboard', async () => {
    const passwordHash = await bcrypt.hash('password123', BCRYPT_ROUNDS);
    const [user] = await db.insert(users).values({
      email: 'prof@auk.edu.kw',
      passwordHash,
      name: 'Professor',
      role: 'instructor',
      emailVerifiedAt: new Date(),
    }).returning();
    await db.insert(instructors).values({ userId: user.userId, employeeId: 'E001' });

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'prof@auk.edu.kw',
      password: 'password123',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.redirectUrl).toBe('/instructor/dashboard.html');
  });

  // AC 9: 5 failed logins lock account
  it('should lock account after 5 failed login attempts', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'locktest@auk.edu.kw',
      password: 'password123',
      name: 'Lock Test',
      role: 'student',
      universityId: '55555',
    });

    const [token] = await db.select().from(emailVerificationTokens).limit(1);
    await request(app).get(`/api/auth/verify-email?token=${token.token}`);

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({
        email: 'locktest@auk.edu.kw',
        password: 'wrong',
      });
    }

    // 6th attempt should be locked
    const res = await request(app).post('/api/auth/login').send({
      email: 'locktest@auk.edu.kw',
      password: 'password123', // even correct password
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('locked');
  });

  // AC 11: Passwords stored as bcrypt
  it('should store passwords as bcrypt hashes', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'bcrypt@auk.edu.kw',
      password: 'password123',
      name: 'Bcrypt Test',
      role: 'student',
      universityId: '77777',
    });

    const [user] = await db.select().from(users).limit(1);
    expect(user.passwordHash).toMatch(/^\$2[ab]\$/);
  });

  // AC 12: Unauthenticated → 401
  it('should return 401 for unauthenticated request to /me', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  // AC 10: Password reset flow
  it('should reset password via token', async () => {
    // Register + verify
    await request(app).post('/api/auth/register').send({
      email: 'reset@auk.edu.kw',
      password: 'oldpassword',
      name: 'Reset Test',
      role: 'student',
      universityId: '88888',
    });

    const [verifyToken] = await db.select().from(emailVerificationTokens).limit(1);
    await request(app).get(`/api/auth/verify-email?token=${verifyToken.token}`);

    // Request password reset
    await request(app).post('/api/auth/forgot-password').send({ email: 'reset@auk.edu.kw' });

    // Get the reset token (most recent)
    const tokens = await db.select().from(emailVerificationTokens);
    const resetToken = tokens.find((t) => t.purpose === 'password_reset');

    // Reset
    const resetRes = await request(app).post('/api/auth/reset-password').send({
      token: resetToken.token,
      newPassword: 'newpassword',
    });
    expect(resetRes.status).toBe(200);

    // Login with new password
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'reset@auk.edu.kw',
      password: 'newpassword',
    });
    expect(loginRes.status).toBe(200);
  });

  // 409 on duplicate email
  it('should reject duplicate email registration', async () => {
    await request(app).post('/api/auth/register').send({
      email: 'dup@auk.edu.kw',
      password: 'password123',
      name: 'First',
      role: 'student',
      universityId: '44444',
    });

    const res = await request(app).post('/api/auth/register').send({
      email: 'dup@auk.edu.kw',
      password: 'password123',
      name: 'Second',
      role: 'student',
      universityId: '44445',
    });

    expect(res.status).toBe(409);
  });
});
