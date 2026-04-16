import rateLimit from 'express-rate-limit';

/** Login: 5 requests per 10 minutes per IP */
export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Registration: 10 requests per hour per IP */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many registration attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Scan: 60 requests per minute per IP */
export const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many scan attempts. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Global: 200 requests per minute per IP */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});
