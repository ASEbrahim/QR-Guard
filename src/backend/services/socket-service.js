import { Server } from 'socket.io';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../config/database.js';
import { sessions, courses, enrollments } from '../db/schema/index.js';

/** @type {Server|null} */
let io = null;

/** UUID v4 format check */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checks if a user (by session data) is allowed to join a session room.
 * Instructors must own the course. Students must be enrolled.
 */
async function canAccessSession(userId, role, sessionId) {
  const [session] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
  if (!session) return false;

  if (role === 'instructor') {
    const [course] = await db.select().from(courses)
      .where(and(eq(courses.courseId, session.courseId), eq(courses.instructorId, userId)))
      .limit(1);
    return !!course;
  }

  // Student — must be enrolled
  const [enrollment] = await db.select().from(enrollments)
    .where(and(
      eq(enrollments.courseId, session.courseId),
      eq(enrollments.studentId, userId),
      isNull(enrollments.removedAt),
    ))
    .limit(1);
  return !!enrollment;
}

/**
 * Attaches Socket.IO to the HTTP server.
 * Called once from server.js after the HTTP server starts.
 *
 * @param {import('http').Server} httpServer
 * @param {function} sessionMiddleware — express-session middleware for cookie parsing
 */
export function initSocketIO(httpServer, sessionMiddleware) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
      credentials: true,
    },
    // Clients only emit tiny control messages (join-session, leave-session)
    // carrying a UUID. 4kb is well above that; defaults to 1 MB which is a
    // DoS vector for anyone who connects and starts sending junk.
    maxHttpBufferSize: 4 * 1024,
  });

  // Authenticate Socket.IO connections using the express session cookie
  if (sessionMiddleware) {
    io.engine.use(sessionMiddleware);
  }

  io.on('connection', (socket) => {
    // Reject unauthenticated connections
    const session = socket.request?.session;
    if (!session?.userId) {
      socket.disconnect(true);
      return;
    }

    socket.on('join-session', async (sessionId) => {
      // The handler is async and awaits a DB query; a thrown exception
      // becomes an unhandled rejection that (with the process-level
      // handlers we installed in P0-5) would trigger a full shutdown.
      // Catch locally and log.
      try {
        if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return;
        if (socket.rooms.size > 5) return;
        const allowed = await canAccessSession(session.userId, session.role, sessionId);
        if (allowed) {
          socket.join(`session-${sessionId}`);
        }
      } catch (err) {
        console.error(`[socket-service] join-session failed for ${sessionId}:`, err.message);
      }
    });

    socket.on('leave-session', (sessionId) => {
      socket.leave(`session-${sessionId}`);
    });
  });

  return io;
}

/**
 * Emits a QR refresh event to all clients in a session room.
 * @param {string} sessionId
 * @param {string} payload — Base64-encoded QR payload
 * @param {Date} expiresAt
 */
export function emitQrRefresh(sessionId, payload, expiresAt) {
  if (!io) return;
  io.to(`session-${sessionId}`).emit('qr:refresh', { payload, expiresAt });
}

/**
 * Emits an attendance update to all clients in a session room.
 * @param {string} sessionId
 * @param {{present: number, total: number}} counts
 */
export function emitAttendanceUpdate(sessionId, counts) {
  if (!io) return;
  io.to(`session-${sessionId}`).emit('attendance:update', counts);
}

/**
 * Emits a session closed event.
 * @param {string} sessionId
 */
export function emitSessionClosed(sessionId) {
  if (!io) return;
  io.to(`session-${sessionId}`).emit('session:closed');
}

/**
 * Closes the Socket.IO server. Used by the graceful-shutdown path.
 * @returns {Promise<void>}
 */
export function closeSocketIO() {
  return new Promise((resolve) => {
    if (!io) return resolve();
    io.close(() => {
      io = null;
      resolve();
    });
  });
}
