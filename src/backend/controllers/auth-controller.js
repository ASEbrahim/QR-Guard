import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { users, students, instructors, emailVerificationTokens } from '../db/schema/index.js';
import { sendTokenEmail, sendVerificationCode } from '../services/email-service.js';
import {
  BCRYPT_ROUNDS,
  PASSWORD_MIN_LENGTH,
  MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  EMAIL_VERIFY_EXPIRY_MS,
  PASSWORD_RESET_EXPIRY_MS,
  DEVICE_REBIND_EXPIRY_MS,
  AUK_EMAIL_REGEX,
} from '../config/constants.js';

// --- Zod validation schemas ---

const registerSchema = z
  .object({
    email: z.string({ required_error: 'Email is required' }).email('Enter a valid email').refine((e) => AUK_EMAIL_REGEX.test(e), {
      message: 'Must be an @auk.edu.kw email address',
    }),
    password: z.string({ required_error: 'Password is required' }).min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
    name: z.string({ required_error: 'Name is required' }).min(1, 'Name is required').max(200),
    role: z.enum(['student', 'instructor']),
    universityId: z.string().min(1, 'University ID is required').nullish(),
    employeeId: z.string().min(1, 'Employee ID is required').nullish(),
  })
  .refine(
    (data) => {
      if (data.role === 'student') return !!data.universityId;
      if (data.role === 'instructor') return !!data.employeeId;
      return false;
    },
    { message: 'University ID is required' },
  );

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceFingerprint: z.string().nullish(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});

// --- Helpers ---

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateCode() {
  return String(crypto.randomInt(100000, 999999));
}

// --- Route handlers ---

/**
 * POST /api/auth/register
 * Creates a user account and sends a verification email.
 */
export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, name, role, universityId, employeeId } = parsed.data;

  // Check if email already taken
  const existing = await db.select({ userId: users.userId }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Insert user + role-specific row in a transaction
  const [newUser] = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, passwordHash, name, role }).returning();

    if (role === 'student') {
      await tx.insert(students).values({ userId: user.userId, universityId });
    } else {
      await tx.insert(instructors).values({ userId: user.userId, employeeId });
    }

    return [user];
  });

  // Create 6-digit verification code
  const code = generateCode();
  await db.insert(emailVerificationTokens).values({
    token: code,
    userId: newUser.userId,
    purpose: 'email_verify',
    expiresAt: new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS),
  });

  await sendVerificationCode(email, code);

  res.status(201).json({ userId: newUser.userId });
}

/**
 * POST /api/auth/login
 * Authenticates a user and creates a session.
 */
export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, password, deviceFingerprint } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Check lockout
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return res.status(429).json({ error: 'Account locked. Try again later or reset your password.' });
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const newCount = user.failedLoginCount + 1;
    const updates = { failedLoginCount: newCount };
    if (newCount >= MAX_LOGIN_ATTEMPTS) {
      updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
    }
    await db.update(users).set(updates).where(eq(users.userId, user.userId));
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Check email verification
  if (!user.emailVerifiedAt) {
    return res.status(403).json({ error: 'Email not verified. Check your inbox.', code: 'not_verified' });
  }

  // Reset failed login count on success
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.userId, user.userId));
  }

  // Device fingerprint check — students only, instructors are exempt
  if (user.role === 'student' && deviceFingerprint) {
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.userId, user.userId))
      .limit(1);

    if (student.deviceFingerprint) {
      // Device already bound — check it matches
      if (student.deviceFingerprint !== deviceFingerprint) {
        return res.status(403).json({
          error: 'Device not recognized',
          code: 'device_mismatch',
        });
      }
    } else {
      // First login after verification — bind this device
      await db
        .update(students)
        .set({ deviceFingerprint, deviceBoundAt: new Date() })
        .where(eq(students.userId, user.userId));
    }
  }

  // Create session
  const redirectUrl =
    user.role === 'student' ? '/student/dashboard.html' : '/instructor/dashboard.html';

  req.session.userId = user.userId;
  req.session.email = user.email;
  req.session.name = user.name;
  req.session.role = user.role;

  res.json({ user: { userId: user.userId, email: user.email, name: user.name, role: user.role }, redirectUrl });
}

/**
 * POST /api/auth/logout
 */
export async function logout(req, res) {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
}

/**
 * POST /api/auth/verify-code
 * Verifies email using the 6-digit code sent during registration.
 */
export async function verifyCode(req, res) {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return res.status(400).json({ error: 'Invalid code' });
  if (user.emailVerifiedAt) return res.json({ message: 'Email already verified.' });

  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.token, code),
      eq(emailVerificationTokens.userId, user.userId),
      eq(emailVerificationTokens.purpose, 'email_verify'),
    ))
    .limit(1);

  if (!record || record.usedAt) return res.status(400).json({ error: 'Invalid code' });
  if (new Date(record.expiresAt) < new Date()) return res.status(400).json({ error: 'Code expired. Request a new one.' });

  await db.transaction(async (tx) => {
    await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.token, code));
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.userId, user.userId));
  });

  res.json({ message: 'Email verified! You can now log in.' });
}

/**
 * GET /api/auth/verify-email?token=...
 * Link-based verification (for password reset and device rebind).
 */
export async function verifyEmail(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.token, token))
    .limit(1);

  if (!record) return res.status(400).json({ error: 'Invalid token' });
  if (record.usedAt) return res.status(400).json({ error: 'Token already used' });
  if (new Date(record.expiresAt) < new Date()) return res.status(400).json({ error: 'Token expired' });

  // Mark token as used
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(eq(emailVerificationTokens.token, token));

  if (record.purpose === 'email_verify') {
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.userId, record.userId));
    return res.json({ message: 'Email verified successfully. You can now log in.' });
  }

  if (record.purpose === 'device_rebind') {
    // Clear the student's device fingerprint so they can bind a new one on next login
    await db
      .update(students)
      .set({ deviceFingerprint: null, deviceBoundAt: null })
      .where(eq(students.userId, record.userId));
    return res.json({ message: 'Device unbound. Log in from your new device to bind it.' });
  }

  res.status(400).json({ error: 'Invalid token purpose' });
}

/**
 * POST /api/auth/forgot-password
 * Always returns 200 (no email leak).
 */
export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    const token = generateToken();
    await db.insert(emailVerificationTokens).values({
      token,
      userId: user.userId,
      purpose: 'password_reset',
      expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
    });
    await sendTokenEmail(email, token, 'password_reset');
  }

  // Always 200 — don't reveal whether email exists
  res.json({ message: 'If that email exists, a reset link has been sent.' });
}

/**
 * POST /api/auth/resend-verification
 * Resends the verification email. Always returns 200 (no email leak).
 */
export async function resendVerification(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.emailVerifiedAt) {
    const code = generateCode();
    await db.insert(emailVerificationTokens).values({
      token: code,
      userId: user.userId,
      purpose: 'email_verify',
      expiresAt: new Date(Date.now() + EMAIL_VERIFY_EXPIRY_MS),
    });
    await sendVerificationCode(email, code);
  }

  res.json({ message: 'If that email needs verification, a new link has been sent.' });
}

/**
 * POST /api/auth/reset-password
 */
export async function resetPassword(req, res) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { token, newPassword } = parsed.data;

  const [record] = await db
    .select()
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.token, token),
        eq(emailVerificationTokens.purpose, 'password_reset'),
      ),
    )
    .limit(1);

  if (!record || record.usedAt || new Date(record.expiresAt) < new Date()) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(users.userId, record.userId));
    await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.token, token));
  });

  res.json({ message: 'Password reset successfully. You can now log in.' });
}

/**
 * POST /api/auth/request-rebind
 * Student requests device rebind — sends an email to clear their current fingerprint.
 */
export async function requestRebind(req, res) {
  if (req.session.role !== 'student') {
    return res.status(403).json({ error: 'Only students can request device rebind' });
  }

  const [user] = await db.select().from(users).where(eq(users.userId, req.session.userId)).limit(1);
  if (!user) return res.status(401).json({ error: 'User not found' });

  const token = generateToken();
  await db.insert(emailVerificationTokens).values({
    token,
    userId: user.userId,
    purpose: 'device_rebind',
    expiresAt: new Date(Date.now() + DEVICE_REBIND_EXPIRY_MS),
  });

  await sendTokenEmail(user.email, token, 'device_rebind');
  res.json({ message: 'Rebind link sent to your email.' });
}

/**
 * GET /api/auth/me
 * Returns the current user's profile.
 */
export async function getMe(req, res) {
  const [user] = await db.select({
    userId: users.userId,
    email: users.email,
    name: users.name,
    role: users.role,
  }).from(users).where(eq(users.userId, req.session.userId)).limit(1);

  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
}
