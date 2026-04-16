import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './config/database.js';
import { SESSION_MAX_AGE_MS } from './config/constants.js';
import { initSocketIO } from './services/socket-service.js';
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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(globalLimiter);

app.use(
  session({
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
  }),
);

// --- Trust proxy for X-Forwarded-For behind reverse proxy ---
app.set('trust proxy', 1);

// --- Per-route rate limiters (applied here, not in route files, so tests stay clean) ---
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/scan', scanLimiter);

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
initSocketIO(httpServer);

const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`QR-Guard server running on http://${HOST}:${PORT}`);
});

export default app;
