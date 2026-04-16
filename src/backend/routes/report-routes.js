import { Router } from 'express';
import {
  getPerSessionReport,
  getPerStudentReport,
  exportCsv,
  getMyAttendance,
  getAuditLog,
} from '../controllers/report-controller.js';
import { requireAuth, requireRole } from '../middleware/auth-middleware.js';

const router = Router();
router.use(requireAuth);

// Student self-view
router.get('/me/attendance', requireRole('student'), getMyAttendance);

// Course-level reports (instructor)
router.get('/courses/:id/attendance', requireRole('instructor'), getPerSessionReport);
router.get('/courses/:id/attendance.csv', requireRole('instructor'), exportCsv);
router.get('/courses/:id/attendance/student/:studentId', getPerStudentReport);
router.get('/courses/:id/audit-log', requireRole('instructor'), getAuditLog);

export default router;
