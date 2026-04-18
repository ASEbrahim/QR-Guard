import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { qrTokens } from '../db/schema/index.js';

/** @type {Map<string, NodeJS.Timeout>} Active refresh loops keyed by sessionId */
const activeLoops = new Map();

/**
 * Generates a new QR token for a session.
 * Payload = Base64({sessionId, courseId, ts, lat, lng, r})
 *
 * @param {string} sessionId
 * @param {object} course — the course row (for geofence + refresh interval)
 * @returns {Promise<{payload: string, expiresAt: Date}>}
 */
export async function generateQrToken(sessionId, course) {
  // Parse geofence from WKT: "SRID=4326;POINT(lng lat)"
  const match = course.geofenceCenter.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
  const lng = match ? parseFloat(match[1]) : 0;
  const lat = match ? parseFloat(match[2]) : 0;

  const payload = Buffer.from(
    JSON.stringify({
      sessionId,
      courseId: course.courseId,
      ts: Date.now(),
      lat,
      lng,
      r: course.geofenceRadiusM,
    }),
  ).toString('base64');

  const expiresAt = new Date(Date.now() + course.qrRefreshIntervalSeconds * 1000);

  await db.insert(qrTokens).values({
    sessionId,
    payload,
    expiresAt,
  });

  return { payload, expiresAt };
}

/**
 * Starts the QR refresh loop for a session.
 * Generates a new token every `refreshInterval` seconds and emits via Socket.IO.
 *
 * @param {string} sessionId
 * @param {object} course
 * @param {function} onRefresh — callback(payload, expiresAt) called on each refresh
 * @returns {Promise<{payload: string, expiresAt: Date}>} the first token
 */
export async function startRefreshLoop(sessionId, course, onRefresh) {
  // Stop any existing loop for this session
  stopRefreshLoop(sessionId);

  // Generate the first token immediately
  const first = await generateQrToken(sessionId, course);
  onRefresh(first.payload, first.expiresAt);

  // Set up the recurring refresh
  const interval = setInterval(async () => {
    try {
      const token = await generateQrToken(sessionId, course);
      onRefresh(token.payload, token.expiresAt);
    } catch (err) {
      console.error(`[qr-service] Refresh failed for session ${sessionId}:`, err.message);
    }
  }, course.qrRefreshIntervalSeconds * 1000);

  activeLoops.set(sessionId, interval);
  return first;
}

/**
 * Stops the QR refresh loop for a session.
 * @param {string} sessionId
 */
export function stopRefreshLoop(sessionId) {
  const interval = activeLoops.get(sessionId);
  if (interval) {
    clearInterval(interval);
    activeLoops.delete(sessionId);
  }
}

/**
 * Stops all active QR refresh loops. Used by the graceful-shutdown path.
 */
export function stopAllRefreshLoops() {
  for (const interval of activeLoops.values()) {
    clearInterval(interval);
  }
  activeLoops.clear();
}

/**
 * Gets the current (latest, non-expired) QR token for a session.
 * Used by the HTTP polling fallback.
 *
 * @param {string} sessionId
 * @returns {Promise<{payload: string, expiresAt: Date}|null>}
 */
export async function getCurrentToken(sessionId) {
  const [token] = await db
    .select({ payload: qrTokens.payload, expiresAt: qrTokens.expiresAt })
    .from(qrTokens)
    .where(eq(qrTokens.sessionId, sessionId))
    .orderBy(desc(qrTokens.generatedAt))
    .limit(1);

  if (!token || new Date(token.expiresAt) < new Date()) return null;
  return token;
}

/** Cleans up expired QR tokens. Runs periodically to prevent table growth. */
export async function cleanupExpiredTokens() {
  try {
    await db.execute(sql`DELETE FROM qr_tokens WHERE expires_at < now() - INTERVAL '1 hour'`);
  } catch (err) {
    console.error('[qr-service] Token cleanup failed:', err.message);
  }
}
