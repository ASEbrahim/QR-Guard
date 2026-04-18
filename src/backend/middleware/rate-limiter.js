import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV !== 'production';

// In dev, skip all rate limiting so testing isn't blocked
const skipInDev = { skip: () => isDev };

/** Login: 5 requests per 10 minutes per IP */
export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...skipInDev,
});

/** Registration: 10 requests per hour per IP */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...skipInDev,
});

/**
 * Scan: 30 per minute per student (falling back to IP if unauthenticated,
 * though the /api/scan route also requires auth). Previously the key was
 * always `req.ip`, which meant a classroom behind a single NAT shared the
 * counter and a few legitimate users could trip the limit for the rest.
 */
export const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many scan attempts. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.session && req.session.userId) || req.ip,
  ...skipInDev,
});

/** Global: 200 requests per minute per IP */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...skipInDev,
});

/**
 * Sensitive-auth flows: password-reset, email verify link, rebind verify,
 * rebind request. Each carries a token or triggers a token-issuing email —
 * more aggressive than login limit to throttle brute-force + email spam.
 * 10 requests per 10 minutes per IP.
 */
export const sensitiveAuthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...skipInDev,
});

/**
 * Enrollment: 20 requests per 10 minutes per IP. Prevents enumeration of
 * 6-char enrollment codes (brute-force vector). Student UX: unlikely to
 * trigger during legitimate use.
 */
export const enrollLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many enrollment attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...skipInDev,
});
