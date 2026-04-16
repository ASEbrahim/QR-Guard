import { Router } from 'express';
import {
  register,
  login,
  logout,
  verifyEmail,
  forgotPassword,
  resendVerification,
  resetPassword,
  requestRebind,
  getMe,
} from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth-middleware.js';

const router = Router();

// Rate limiters applied in server.js, not here — keeps routes testable in isolation
router.post('/register', register);
router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.get('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/resend-verification', resendVerification);
router.post('/reset-password', resetPassword);
router.post('/request-rebind', requireAuth, requestRebind);
// verify-rebind uses the same handler as verify-email (purpose field distinguishes)
router.get('/verify-rebind', verifyEmail);
router.get('/me', requireAuth, getMe);

export default router;
