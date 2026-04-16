import { Router } from 'express';
import { startSession, stopSession, getQr } from '../controllers/session-controller.js';
import { overrideAttendance } from '../controllers/override-controller.js';
import { requireAuth, requireRole } from '../middleware/auth-middleware.js';

const router = Router();

router.post('/:id/start', requireAuth, requireRole('instructor'), startSession);
router.post('/:id/stop', requireAuth, requireRole('instructor'), stopSession);
router.get('/:id/qr', requireAuth, getQr);
router.post('/:id/override', requireAuth, requireRole('instructor'), overrideAttendance);

export default router;
