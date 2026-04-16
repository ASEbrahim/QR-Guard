/** @module constants — Named constants for QR-Guard. No magic numbers. */

export const BCRYPT_ROUNDS = 12;
export const PASSWORD_MIN_LENGTH = 8;

// Account lockout
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Token expiry
export const EMAIL_VERIFY_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
export const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
export const DEVICE_REBIND_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// Enrollment code
export const ENROLLMENT_CODE_LENGTH = 6;
// Excludes 0/O, 1/I/L to avoid confusion
export const ENROLLMENT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Course config defaults
export const DEFAULT_ATTENDANCE_WINDOW_SECONDS = 300; // 5 minutes
export const DEFAULT_WARNING_THRESHOLD_PCT = 85.0;
export const DEFAULT_QR_REFRESH_INTERVAL_SECONDS = 25;

// Geofence limits
export const GEOFENCE_MIN_RADIUS_M = 10;
export const GEOFENCE_MAX_RADIUS_M = 500;
export const GEOFENCE_INDOOR_MARGIN_M = 15;

// AUK email validation — strict, no subdomains
export const AUK_EMAIL_REGEX = /^[^@\s]+@auk\.edu\.kw$/i;

// Session config
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
