import { eq, and, gte } from 'drizzle-orm';
import { db } from '../config/database.js';
import { qrTokens } from '../db/schema/index.js';
import { ScanError } from './scan-error.js';

/**
 * Layer 1: Validate QR token against current refresh cycle.
 * Decodes the Base64 payload and checks if a matching, non-expired token exists.
 *
 * @param {string} qrPayload — Base64-encoded payload from the student's scan
 * @returns {Promise<{sessionId: string, courseId: string}>} decoded token data
 * @throws {ScanError} code='qr_expired' if token not found or expired
 */
export async function validateQrToken(qrPayload) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(qrPayload, 'base64').toString('utf-8'));
  } catch {
    throw new ScanError('Invalid QR code', 'qr_expired');
  }

  if (!decoded.sessionId || !decoded.ts) {
    throw new ScanError('Invalid QR code', 'qr_expired');
  }

  // Find a non-expired token matching this payload
  const [token] = await db
    .select()
    .from(qrTokens)
    .where(and(eq(qrTokens.payload, qrPayload), gte(qrTokens.expiresAt, new Date())))
    .limit(1);

  if (!token) {
    throw new ScanError('QR expired — wait for refresh', 'qr_expired');
  }

  return {
    sessionId: decoded.sessionId,
    courseId: decoded.courseId,
    lat: decoded.lat,
    lng: decoded.lng,
    radius: decoded.r,
  };
}
