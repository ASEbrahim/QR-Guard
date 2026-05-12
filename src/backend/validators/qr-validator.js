import { eq, and, gte } from 'drizzle-orm';
import { db } from '../config/database.js';
import { qrTokens } from '../db/schema/index.js';
import { ScanError } from './scan-error.js';
import { verifyToken } from '../services/qr-signing.js';

/**
 * Layer 1: Validate QR token against current refresh cycle.
 *
 * Two-step check:
 *   1. Verify the HMAC-SHA256 signature using QR_SIGNING_SECRET. A token
 *      whose signature does not match cannot have been issued by this
 *      server and is rejected before any DB work.
 *   2. Decode the payload JSON and look up a matching non-expired row in
 *      qr_tokens. The lookup uses the FULL signed token (payload+sig) as
 *      the qr_tokens.payload column, so a replayed token that passes the
 *      signature check still has to match a row written within the
 *      refresh window.
 *
 * Both failure modes are surfaced through the same ScanError code so an
 * attacker cannot distinguish "wrong secret" from "stale token" from the
 * client side.
 *
 * @param {string} qrPayload - signed token from the student's scan
 * @returns {Promise<{sessionId: string, courseId: string}>} decoded token data
 * @throws {ScanError} code='qr_expired' if signature or freshness fails
 */
export async function validateQrToken(qrPayload) {
  // Step 1: signature
  let base64Payload;
  try {
    base64Payload = verifyToken(qrPayload);
  } catch {
    throw new ScanError('Invalid QR code', 'qr_expired');
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(base64Payload, 'base64').toString('utf-8'));
  } catch {
    throw new ScanError('Invalid QR code', 'qr_expired');
  }

  if (!decoded.sessionId || !decoded.ts) {
    throw new ScanError('Invalid QR code', 'qr_expired');
  }

  // Step 2: freshness via DB lookup
  const [token] = await db
    .select()
    .from(qrTokens)
    .where(and(eq(qrTokens.payload, qrPayload), gte(qrTokens.expiresAt, new Date())))
    .limit(1);

  if (!token) {
    throw new ScanError('QR expired - wait for refresh', 'qr_expired');
  }

  return {
    sessionId: decoded.sessionId,
    courseId: decoded.courseId,
    lat: decoded.lat,
    lng: decoded.lng,
    radius: decoded.r,
  };
}
