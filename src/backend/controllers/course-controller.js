import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/database.js';
import { courses, enrollments, sessions } from '../db/schema/index.js';
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
  ).min(1).max(14), // cap at 14 slots; real courses rarely exceed 5

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

// updateCourse is a partial update — every field is optional, but values
// that ARE provided must still be valid (previously only
// geofenceRadius was range-checked; lat/lng/window/threshold were not).
const updateCourseSchema = z
  .object({
    geofenceLat: z.number().min(-90).max(90).optional(),
    geofenceLng: z.number().min(-180).max(180).optional(),
    geofenceRadius: z.number().int().min(GEOFENCE_MIN_RADIUS_M).max(GEOFENCE_MAX_RADIUS_M).optional(),
    attendanceWindow: z.number().int().positive().optional(),
    warningThreshold: z.number().min(0).max(100).optional(),
    qrRefreshInterval: z.number().int().min(5).max(300).optional(),
    regenerateCode: z.boolean().optional(),
  })
  .refine(
    (d) => (d.geofenceLat === undefined) === (d.geofenceLng === undefined),
    { message: 'geofenceLat and geofenceLng must be provided together' },
  );

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

/**
 * Shared enrollment logic: checks for existing enrollment, re-enrolls if soft-deleted,
 * or creates a new enrollment row.
 * @returns {{ status: number, body: object }}
 */
async function executeEnrollment(courseId, studentId, courseName) {
  const [existing] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)))
    .limit(1);

  if (existing && !existing.removedAt) {
    return { status: 409, body: { error: 'Already enrolled in this course' } };
  }

  if (existing && existing.removedAt) {
    await db
      .update(enrollments)
      .set({ removedAt: null, enrolledAt: new Date() })
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentId, studentId)));
    const body = { message: 'Re-enrolled successfully' };
    if (courseName) body.courseName = courseName;
    return { status: 200, body };
  }

  await db.insert(enrollments).values({ courseId, studentId });
  const body = { message: 'Enrolled successfully' };
  if (courseName) body.courseName = courseName;
  return { status: 200, body };
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

  // Course + auto-generated sessions are written in one transaction. Without
  // this, a failed session insert would leave a course with no scheduled
  // sessions (and no clean rollback path for the caller).
  const { course, sessionsGenerated } = await db.transaction(async (tx) => {
    const [newCourse] = await tx
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

    const sessionRows = generateSessions(
      data.weeklySchedule,
      data.semesterStart,
      data.semesterEnd,
      newCourse.courseId,
    );

    if (sessionRows.length > 0) {
      await tx.insert(sessions).values(sessionRows);
    }

    return { course: newCourse, sessionsGenerated: sessionRows.length };
  });

  res.status(201).json({ course, sessionsGenerated });
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

  const parsed = updateCourseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const data = parsed.data;
  const updates = {};

  if (data.geofenceLat !== undefined) {
    // Both lat and lng validated + required-together by the schema.
    updates.geofenceCenter = `SRID=4326;POINT(${data.geofenceLng} ${data.geofenceLat})`;
  }
  if (data.geofenceRadius !== undefined) updates.geofenceRadiusM = data.geofenceRadius;
  if (data.attendanceWindow !== undefined) updates.attendanceWindowSeconds = data.attendanceWindow;
  if (data.warningThreshold !== undefined) updates.warningThresholdPct = String(data.warningThreshold);
  if (data.qrRefreshInterval !== undefined) updates.qrRefreshIntervalSeconds = data.qrRefreshInterval;
  if (data.regenerateCode) {
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

  const result = await executeEnrollment(id, req.session.userId, null);
  res.status(result.status).json(result.body);
}

/**
 * POST /api/enroll
 * Student enrolls using just the 6-char enrollment code (no course UUID needed).
 */
export async function enrollByCode(req, res) {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.enrollmentCode, parsed.data.enrollmentCode))
    .limit(1);

  if (!course) return res.status(404).json({ error: 'Invalid enrollment code' });

  const result = await executeEnrollment(course.courseId, req.session.userId, `${course.code} — ${course.name}`);
  res.status(result.status).json(result.body);
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
