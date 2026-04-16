import { Router } from 'express';
import {
  createCourse,
  listCourses,
  getCourse,
  updateCourse,
  enrollInCourse,
  removeStudent,
  getEnrolledStudents,
  addSession,
  updateSession,
} from '../controllers/course-controller.js';
import { requireAuth, requireRole } from '../middleware/auth-middleware.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

router.post('/', requireRole('instructor'), createCourse);
router.get('/', listCourses);
router.get('/:id', getCourse);
router.put('/:id', requireRole('instructor'), updateCourse);
router.post('/:id/enroll', requireRole('student'), enrollInCourse);
router.delete('/:id/students/:studentId', requireRole('instructor'), removeStudent);
router.get('/:id/students', requireRole('instructor'), getEnrolledStudents);
router.post('/:id/sessions', requireRole('instructor'), addSession);
router.patch('/:id/sessions/:sessionId', requireRole('instructor'), updateSession);

export default router;
