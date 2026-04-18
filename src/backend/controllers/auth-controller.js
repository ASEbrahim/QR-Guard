import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { users, students, emailVerificationTokens } from '../db/schema/index.js';
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

// Public registration is STUDENT-ONLY. Instructor accounts are provisioned
// via scripts/seed.js by an administrator. Accepting `role` from the body
// would allow anyone with an @auk.edu.kw email to self-promote to instructor.
const registerSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Enter a valid email')
    .refine((e) => AUK_EMAIL_REGEX.test(e), { message: 'Must be an @auk.edu.kw email address' }),
  password: z
    .string({ required_error: 'Password is required' })
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
  name: z
    .string({ required_error: 'Name is required' })
    .min(1, 'Name is required')
    .max(200),
  universityId: z
    .string({ required_error: 'University ID is required' })
    .min(1, 'University ID is required'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceFingerprint: z.string().nullish(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH),
});

// Schemas for the three ad-hoc-validated endpoints (previously used
// inline `if (!email || !code)` checks which produced differently-
// shaped error bodies from the Zod-validated paths).
const verifyCodeSchema = z.object({
  email: z.string().email('Enter a valid email'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

const emailOnlySchema = z.object({
  email: z.string().email('Enter a valid email'),
});

// --- Helpers ---

/** Generates a 64-char hex token for password reset and device rebind links. */
function generateHexToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Generates a 6-digit numeric verification code for email verification. */
function generateSixDigitCode() {
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
  const { email, password, name, universityId } = parsed.data;

  // Check if email already taken
  const existing = await db.select({ userId: users.userId }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Public registration is student-only; role is fixed server-side.
  const [newUser] = await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, passwordHash, name, role: 'student' }).returning();
    await tx.insert(students).values({ userId: user.userId, universityId });
    return [user];
  });

  // Create 6-digit verification code
  const code = generateSixDigitCode();
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

  // Device binding: capture fingerprint on first login, but don't block login
  // from other devices. Device verification happens in the scan pipeline
  // (DeviceChecker, Layer 2) — students can log in from any device to view
  // their dashboard, but can only SCAN from their bound device.
  if (user.role === 'student' && deviceFingerprint) {
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.userId, user.userId))
      .limit(1);

    // Bind device on first login (no device stored yet)
    if (student && !student.deviceFingerprint) {
      await db
        .update(students)
        .set({ deviceFingerprint, deviceBoundAt: new Date() })
        .where(eq(students.userId, user.userId));
    }
  }

  // Create session
  const redirectUrl =
    user.role === 'student' ? '/student/dashboard.html' : '/instructor/dashboard.html';
  const userData = { userId: user.userId, email: user.email, name: user.name, role: user.role };

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.userId = userData.userId;
    req.session.email = userData.email;
    req.session.name = userData.name;
    req.session.role = userData.role;
    res.json({ user: userData, redirectUrl });
  });
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
  const parsed = verifyCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, code } = parsed.data;

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

  // Mark token as used + apply purpose-specific update in a single transaction
  const purpose = record.purpose;
  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationTokens.token, token));

    if (purpose === 'email_verify') {
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.userId, record.userId));
    } else if (purpose === 'device_rebind') {
      await tx
        .update(students)
        .set({ deviceFingerprint: null, deviceBoundAt: null })
        .where(eq(students.userId, record.userId));
    }
  });

  // On device rebind, also destroy any existing sessions for the user. The
  // rebind flow implies the student's original device may be lost/stolen;
  // any session cookie issued on it must stop working.
  if (purpose === 'device_rebind') {
    try {
      await db.execute(sql`DELETE FROM "session" WHERE sess->>'userId' = ${record.userId}`);
    } catch (err) {
      console.error('[auth] Failed to destroy sessions on device rebind:', err.message);
    }
  }

  if (purpose === 'email_verify') {
    return res.json({ message: 'Email verified successfully. You can now log in.' });
  }

  if (purpose === 'device_rebind') {
    return res.json({ message: 'Device unbound. Log in from your new device to bind it.' });
  }

  res.status(400).json({ error: 'Invalid token purpose' });
}

/**
 * POST /api/auth/forgot-password
 * Always returns 200 (no email leak).
 */
export async function forgotPassword(req, res) {
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    // Invalidate any prior unused password-reset tokens
    await db.update(emailVerificationTokens).set({ usedAt: new Date() }).where(and(eq(emailVerificationTokens.userId, user.userId), eq(emailVerificationTokens.purpose, 'password_reset'), isNull(emailVerificationTokens.usedAt)));

    const token = generateHexToken();
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
  const parsed = emailOnlySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.emailVerifiedAt) {
    // Invalidate any prior unused email-verify tokens
    await db.update(emailVerificationTokens).set({ usedAt: new Date() }).where(and(eq(emailVerificationTokens.userId, user.userId), eq(emailVerificationTokens.purpose, 'email_verify'), isNull(emailVerificationTokens.usedAt)));

    const code = generateSixDigitCode();
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

  // Do NOT clear failedLoginCount or lockedUntil here. Doing so would let an
  // attacker use the reset flow as a lockout bypass. Lockout auto-expires
  // after LOCKOUT_DURATION_MS; a legitimately locked-out user can reset the
  // password AND wait out the lockout.
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.userId, record.userId));
    await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.token, token));
  });

  // Destroy any existing server-side sessions for this user so stolen cookies
  // don't outlive the password change. connect-pg-simple stores sessions in
  // the "session" table with a json `sess` column; match on sess->>'userId'.
  // Done outside the transaction: a missing session table (fresh DB, tests
  // that use an in-memory store) must not block the password reset itself.
  try {
    await db.execute(sql`DELETE FROM "session" WHERE sess->>'userId' = ${record.userId}`);
  } catch (err) {
    console.error('[auth] Failed to destroy sessions on password reset:', err.message);
  }

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

  const token = generateHexToken();
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
