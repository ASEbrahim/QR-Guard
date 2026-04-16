import { eq, and } from 'drizzle-orm';
import { db } from '../config/database.js';
import { sessions, courses } from '../db/schema/index.js';
import { startRefreshLoop, stopRefreshLoop, getCurrentToken } from '../services/qr-service.js';
import { emitQrRefresh, emitSessionClosed } from '../services/socket-service.js';

/**
 * POST /api/sessions/:id/start
 * Instructor starts a session — activates QR generation loop.
 */
export async function startSession(req, res) {
  const { id } = req.params;

  const [session] = await db.select().from(sessions).where(eq(sessions.sessionId, id)).limit(1);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Verify instructor owns this course
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.courseId, session.courseId), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(403).json({ error: 'Not your course' });

  if (session.status === 'active') {
    return res.status(400).json({ error: 'Session already active' });
  }
  if (session.status === 'closed' || session.status === 'cancelled') {
    return res.status(400).json({ error: 'Session is already closed or cancelled' });
  }

  // Mark session as active
  await db
    .update(sessions)
    .set({ status: 'active', actualStart: new Date() })
    .where(eq(sessions.sessionId, id));

  // Start QR refresh loop
  const first = await startRefreshLoop(id, course, (payload, expiresAt) => {
    emitQrRefresh(id, payload, expiresAt);
  });

  res.json({ qrPayload: first.payload, expiresAt: first.expiresAt });
}

/**
 * POST /api/sessions/:id/stop
 * Instructor stops a session — closes QR generation.
 */
export async function stopSession(req, res) {
  const { id } = req.params;

  const [session] = await db.select().from(sessions).where(eq(sessions.sessionId, id)).limit(1);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.courseId, session.courseId), eq(courses.instructorId, req.session.userId)))
    .limit(1);
  if (!course) return res.status(403).json({ error: 'Not your course' });

  // Stop the refresh loop and mark closed
  stopRefreshLoop(id);
  await db
    .update(sessions)
    .set({ status: 'closed', actualEnd: new Date() })
    .where(eq(sessions.sessionId, id));

  emitSessionClosed(id);
  res.json({ message: 'Session stopped' });
}

/**
 * GET /api/sessions/:id/qr
 * HTTP polling fallback — returns the current QR token.
 */
export async function getQr(req, res) {
  const { id } = req.params;
  const token = await getCurrentToken(id);
  if (!token) return res.status(404).json({ error: 'No active QR token' });
  res.json(token);
}
