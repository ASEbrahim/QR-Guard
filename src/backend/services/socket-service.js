import { Server } from 'socket.io';

/** @type {Server|null} */
let io = null;

/**
 * Attaches Socket.IO to the HTTP server.
 * Called once from server.js after the HTTP server starts.
 *
 * @param {import('http').Server} httpServer
 */
export function initSocketIO(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.on('connection', (socket) => {
    socket.on('join-session', (sessionId) => {
      socket.join(`session-${sessionId}`);
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
