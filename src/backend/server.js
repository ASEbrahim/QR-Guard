import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './config/database.js';
import { SESSION_MAX_AGE_MS } from './config/constants.js';
import authRoutes from './routes/auth-routes.js';
import courseRoutes from './routes/course-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PgSession = connectPgSimple(session);

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for dev (inline scripts in HTML)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);

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

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`QR-Guard server running on http://localhost:${PORT}`);
});

export default app;
