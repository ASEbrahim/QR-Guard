import { Router } from 'express';
import {
  register,
  login,
  logout,
  verifyEmail,
  forgotPassword,
  resetPassword,
  requestRebind,
  getMe,
} from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth-middleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.get('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/request-rebind', requireAuth, requestRebind);
// verify-rebind uses the same handler as verify-email (purpose field distinguishes)
router.get('/verify-rebind', verifyEmail);
router.get('/me', requireAuth, getMe);

export default router;
