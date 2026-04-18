import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, db } from './config/database.js';
import { SESSION_MAX_AGE_MS } from './config/constants.js';
import { initSocketIO, closeSocketIO } from './services/socket-service.js';
import { cleanupExpiredTokens, stopAllRefreshLoops } from './services/qr-service.js';
import { sessions } from './db/schema/index.js';
import { eq } from 'drizzle-orm';
import authRoutes from './routes/auth-routes.js';
import courseRoutes from './routes/course-routes.js';
import sessionRoutes from './routes/session-routes.js';
import scanRoutes from './routes/scan-routes.js';
import reportRoutes from './routes/report-routes.js';
import { globalLimiter, loginLimiter, registerLimiter, scanLimiter } from './middleware/rate-limiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PgSession = connectPgSimple(session);

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for dev (inline scripts in HTML)
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  noSniff: true,
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(globalLimiter);

const DEFAULT_SESSION_SECRETS = new Set([
  'change-me',
  'change-me-in-production',
]);
if (!process.env.SESSION_SECRET || DEFAULT_SESSION_SECRETS.has(process.env.SESSION_SECRET)) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET is not set or uses a default template value. Refusing to start.');
    process.exit(1);
  }
}

const sessionMiddleware = session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
});
app.use(sessionMiddleware);

// --- Trust proxy for X-Forwarded-For behind reverse proxy ---
app.set('trust proxy', 1);

// --- Per-route rate limiters (applied here, not in route files, so tests stay clean) ---
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/scan', scanLimiter);
app.use('/api/auth/verify-code', loginLimiter);
app.use('/api/auth/forgot-password', loginLimiter);
app.use('/api/auth/resend-verification', loginLimiter);

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api', reportRoutes);

// --- Static frontend ---
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Catch-all: unknown API routes return 404 ---
app.all('/api/{*path}', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start with HTTP server (needed for Socket.IO) ---
const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);
initSocketIO(httpServer, sessionMiddleware);

const HOST = process.env.HOST || '0.0.0.0';

// Track resources that need teardown on shutdown.
let tokenCleanupInterval = null;
let isShuttingDown = false;

httpServer.listen(PORT, HOST, () => {
  console.log(`QR-Guard server running on http://${HOST}:${PORT}`);

  // Clean up expired QR tokens every 10 minutes (handle retained for shutdown)
  tokenCleanupInterval = setInterval(cleanupExpiredTokens, 10 * 60 * 1000);
  cleanupExpiredTokens(); // run once on startup

  // Close any sessions left in 'active' state from a previous server instance
  db.update(sessions).set({ status: 'closed', actualEnd: new Date() }).where(eq(sessions.status, 'active')).then(() => {}).catch(err => console.error('[startup] Failed to close orphaned sessions:', err.message));
});

/**
 * Graceful shutdown: stop accepting new connections, close in-flight
 * resources (intervals, QR refresh loops, Socket.IO, HTTP server, PG pool),
 * then exit. Idempotent — subsequent signals during shutdown are ignored.
 *
 * On Render, SIGTERM is sent on deploy and on scale-down. Honoring it means
 * in-flight scans can complete (within the platform's grace window) rather
 * than being cut off mid-request.
 */
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[server] Received ${signal}. Shutting down gracefully...`);

  // Hard-exit timer: if graceful shutdown hangs, bail after 15s.
  const forceExitTimer = setTimeout(() => {
    console.error('[server] Graceful shutdown timed out after 15s. Forcing exit.');
    process.exit(1);
  }, 15000);
  forceExitTimer.unref();

  try {
    if (tokenCleanupInterval) clearInterval(tokenCleanupInterval);
    stopAllRefreshLoops();
    await closeSocketIO();
    await new Promise((resolve) => httpServer.close(() => resolve()));
    await pool.end();
    console.log('[server] Shutdown complete.');
    process.exit(exitCode);
  } catch (err) {
    console.error('[server] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Node 20 terminates the process on unhandled rejection by default. Log the
// reason with context before shutting down so we can diagnose later.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] UNHANDLED REJECTION', { reason, promise });
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  console.error('[server] UNCAUGHT EXCEPTION', err);
  // uncaughtException means state is unreliable — shutdown with failure code.
  shutdown('uncaughtException', 1);
});

export default app;
