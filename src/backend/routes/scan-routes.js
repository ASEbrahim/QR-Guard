import { Router } from 'express';
import { handleScan } from '../controllers/scan-controller.js';
import { requireAuth, requireRole } from '../middleware/auth-middleware.js';

const router = Router();

// Rate limiter applied in server.js
router.post('/', requireAuth, requireRole('student'), handleScan);

export default router;
