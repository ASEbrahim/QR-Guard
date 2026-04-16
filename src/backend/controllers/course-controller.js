import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { courses, enrollments, sessions, students, users } from '../db/schema/index.js';
import { generateEnrollmentCode } from '../services/enrollment-code.js';
import { generateSessions } from '../services/session-generator.js';
import {
  GEOFENCE_MIN_RADIUS_M,
  GEOFENCE_MAX_RADIUS_M,
  DEFAULT_ATTENDANCE_WINDOW_SECONDS,
  DEFAULT_WARNING_THRESHOLD_PCT,
  DEFAULT_QR_REFRESH_INTERVAL_SECONDS,
} from '../config/constants.js';

// --- Zod validation schemas ---

const createCourseSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(20),
  section: z.string().min(1).max(10),
  semester: z.string().min(1).max(50),
  semesterStart: z.string().date(),
  semesterEnd: z.string().date(),
  weeklySchedule: z.array(
    z.object({
      day: z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  ).min(1),
  geofenceLat: z.number().min(-90).max(90),
  geofenceLng: z.number().min(-180).max(180),
  geofenceRadius: z.number().int().min(GEOFENCE_MIN_RADIUS_M).max(GEOFENCE_MAX_RADIUS_M),
  attendanceWindow: z.number().int().positive().optional(),
  warningThreshold: z.number().min(0).max(100).optional(),
  qrRefreshInterval: z.number().int().min(5).max(300).optional(),
});

const enrollSchema = z.object({
  enrollmentCode: z.string().length(6),
});

const addSessionSchema = z.object({
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
});

// --- Helpers ---

/**
 * Checks if the authenticated user is the instructor for a given course.
 * @returns {object|null} The course row, or null if not found/not authorized
 */
async function getCourseForInstructor(courseId, instructorId) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.courseId, courseId), eq(courses.instructorId, instructorId)))
    .limit(1);
  return course || null;
}

// --- Route handlers ---

/**
 * POST /api/courses
 * Instructor creates a new course with geofence and weekly schedule.
 */
export async function createCourse(req, res) {
  const parsed = createCourseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const data = parsed.data;
  const enrollmentCode = await generateEnrollmentCode();

  // Store geofence as WKT string — we'll use raw SQL for PostGIS operations
  const geofenceCenter = `SRID=4326;POINT(${data.geofenceLng} ${data.geofenceLat})`;

  const [course] = await db
    .insert(courses)
    .values({
      instructorId: req.session.userId,
      name: data.name,
      code: data.code,
      section: data.section,
      semester: data.semester,
      enrollmentCode,
      geofenceCenter,
      geofenceRadiusM: data.geofenceRadius,
      attendanceWindowSeconds: data.attendanceWindow || DEFAULT_ATTENDANCE_WINDOW_SECONDS,
      warningThresholdPct: String(data.warningThreshold ?? DEFAULT_WARNING_THRESHOLD_PCT),
      qrRefreshIntervalSeconds: data.qrRefreshInterval || DEFAULT_QR_REFRESH_INTERVAL_SECONDS,
      weeklySchedule: data.weeklySchedule,
      semesterStart: data.semesterStart,
      semesterEnd: data.semesterEnd,
    })
    .returning();

  // Auto-generate sessions from weekly schedule
  const sessionRows = generateSessions(
    data.weeklySchedule,
    data.semesterStart,
    data.semesterEnd,
    course.courseId,
  );

  if (sessionRows.length > 0) {
    await db.insert(sessions).values(sessionRows);
  }

  res.status(201).json({ course, sessionsGenerated: sessionRows.length });
}

/**
 * GET /api/courses
 * Lists courses for the authenticated user (role-aware).
 */
export async function listCourses(req, res) {
  if (req.session.role === 'instructor') {
    const result = await db
      .select()
      .from(courses)
      .where(eq(courses.instructorId, req.session.userId));
    return res.json({ courses: result });
  }

  // Student — list enrolled courses
  const result = await db
    .select({
      courseId: courses.courseId,
      name: courses.name,
      code: courses.code,
      section: courses.section,
      semester: courses.semester,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.courseId))
    .where(
      and(
        eq(enrollments.studentId, req.session.userId),
        isNull(enrollments.removedAt),
      ),
    );

  res.json({ courses: result });
}

/**
 * GET /api/courses/:id
 * Returns course detail. Instructor sees full config; student sees basics.
 */
export async function getCourse(req, res) {
  const { id } = req.params;

  const [course] = await db.select().from(courses).where(eq(courses.courseId, id)).limit(1);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  // Authorization: instructor must own it, student must be enrolled
  if (req.session.role === 'instructor') {
    if (course.instructorId !== req.session.userId) {
      return res.status(403).json({ error: 'Not your course' });
    }
  } else {
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, id),
          eq(enrollments.studentId, req.session.userId),
          isNull(enrollments.removedAt),
        ),
      )
      .limit(1);
    if (!enrollment) return res.status(403).json({ error: 'Not enrolled in this course' });
  }

  // Fetch sessions for this course
  const courseSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.courseId, id))
    .orderBy(sessions.scheduledStart);

  res.json({ course, sessions: courseSessions });
}

/**
 * PUT /api/courses/:id
 * Instructor updates course config (geofence, thresholds, enrollment code regeneration).
 */
export async function updateCourse(req, res) {
  const { id } = req.params;
  const course = await getCourseForInstructor(id, req.session.userId);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  const updates = {};

  if (req.body.geofenceLat !== undefined && req.body.geofenceLng !== undefined) {
    updates.geofenceCenter = `SRID=4326;POINT(${req.body.geofenceLng} ${req.body.geofenceLat})`;
  }
  if (req.body.geofenceRadius !== undefined) {
    const r = Number(req.body.geofenceRadius);
    if (r < GEOFENCE_MIN_RADIUS_M || r > GEOFENCE_MAX_RADIUS_M) {
      return res.status(400).json({ error: `Radius must be ${GEOFENCE_MIN_RADIUS_M}-${GEOFENCE_MAX_RADIUS_M}m` });
    }
    updates.geofenceRadiusM = r;
  }
  if (req.body.attendanceWindow !== undefined) updates.attendanceWindowSeconds = req.body.attendanceWindow;
  if (req.body.warningThreshold !== undefined) updates.warningThresholdPct = String(req.body.warningThreshold);
  if (req.body.qrRefreshInterval !== undefined) updates.qrRefreshIntervalSeconds = req.body.qrRefreshInterval;
  if (req.body.regenerateCode) {
    updates.enrollmentCode = await generateEnrollmentCode();
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const [updated] = await db.update(courses).set(updates).where(eq(courses.courseId, id)).returning();
  res.json({ course: updated });
}

/**
 * POST /api/courses/:id/enroll
 * Student enrolls in a course using the enrollment code.
 */
export async function enrollInCourse(req, res) {
  const { id } = req.params;
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.courseId, id), eq(courses.enrollmentCode, parsed.data.enrollmentCode)))
    .limit(1);

  if (!course) return res.status(404).json({ error: 'Invalid course or enrollment code' });

  // Check for existing enrollment (including soft-deleted)
  const [existing] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, id), eq(enrollments.studentId, req.session.userId)))
    .limit(1);

  if (existing && !existing.removedAt) {
    return res.status(409).json({ error: 'Already enrolled in this course' });
  }

  if (existing && existing.removedAt) {
    // Re-enroll: clear the removed_at
    await db
      .update(enrollments)
      .set({ removedAt: null, enrolledAt: new Date() })
      .where(and(eq(enrollments.courseId, id), eq(enrollments.studentId, req.session.userId)));
    return res.json({ message: 'Re-enrolled successfully' });
  }

  await db.insert(enrollments).values({
    courseId: id,
    studentId: req.session.userId,
  });

  res.json({ message: 'Enrolled successfully' });
}

/**
 * DELETE /api/courses/:id/students/:studentId
 * Instructor soft-removes a student (sets removed_at, history retained).
 */
export async function removeStudent(req, res) {
  const { id, studentId } = req.params;
  const course = await getCourseForInstructor(id, req.session.userId);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, id),
        eq(enrollments.studentId, studentId),
        isNull(enrollments.removedAt),
      ),
    )
    .limit(1);

  if (!enrollment) return res.status(404).json({ error: 'Student not enrolled' });

  await db
    .update(enrollments)
    .set({ removedAt: new Date() })
    .where(and(eq(enrollments.courseId, id), eq(enrollments.studentId, studentId)));

  res.json({ message: 'Student removed. Historical records retained.' });
}

/**
 * GET /api/courses/:id/students
 * Instructor gets enrolled roster. Attendance % placeholder (Sprint C).
 */
export async function getEnrolledStudents(req, res) {
  const { id } = req.params;
  const course = await getCourseForInstructor(id, req.session.userId);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  const result = await db
    .select({
      userId: students.userId,
      name: users.name,
      email: users.email,
      universityId: students.universityId,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(students, eq(enrollments.studentId, students.userId))
    .innerJoin(users, eq(students.userId, users.userId))
    .where(and(eq(enrollments.courseId, id), isNull(enrollments.removedAt)));

  // Attendance % will be computed in Sprint C (reports)
  const studentsWithPct = result.map((s) => ({ ...s, attendancePct: null }));

  res.json({ students: studentsWithPct });
}

/**
 * POST /api/courses/:id/sessions
 * Instructor adds an ad-hoc session.
 */
export async function addSession(req, res) {
  const { id } = req.params;
  const course = await getCourseForInstructor(id, req.session.userId);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  const parsed = addSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const [session] = await db
    .insert(sessions)
    .values({
      courseId: id,
      scheduledStart: new Date(parsed.data.scheduledStart),
      scheduledEnd: new Date(parsed.data.scheduledEnd),
    })
    .returning();

  res.status(201).json({ session });
}

/**
 * PATCH /api/courses/:id/sessions/:sessionId
 * Cancel a session (set status to 'cancelled').
 */
export async function updateSession(req, res) {
  const { id, sessionId } = req.params;
  const course = await getCourseForInstructor(id, req.session.userId);
  if (!course) return res.status(404).json({ error: 'Course not found or not authorized' });

  const { status } = req.body;
  if (status !== 'cancelled') {
    return res.status(400).json({ error: 'Can only cancel sessions via this endpoint' });
  }

  const [updated] = await db
    .update(sessions)
    .set({ status: 'cancelled' })
    .where(and(eq(sessions.sessionId, sessionId), eq(sessions.courseId, id)))
    .returning();

  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json({ session: updated });
}
