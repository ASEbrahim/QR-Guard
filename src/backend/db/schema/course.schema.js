import { pgTable, text, uuid, timestamp, integer, numeric, jsonb, date, index } from 'drizzle-orm/pg-core';
import { instructors } from './user.schema.js';

export const courses = pgTable(
  'courses',
  {
    courseId: uuid('course_id').primaryKey().defaultRandom(),
    instructorId: uuid('instructor_id')
      .notNull()
      .references(() => instructors.userId),
    name: text('name').notNull(),
    code: text('code').notNull(),
    section: text('section').notNull(),
    semester: text('semester').notNull(),
    enrollmentCode: text('enrollment_code').unique().notNull(),
    // PostGIS geography point — stored as raw SQL type since Drizzle doesn't have native geography
    geofenceCenter: text('geofence_center').notNull(),
    geofenceRadiusM: integer('geofence_radius_m').notNull(),
    attendanceWindowSeconds: integer('attendance_window_seconds').notNull().default(300),
    warningThresholdPct: numeric('warning_threshold_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('85.00'),
    qrRefreshIntervalSeconds: integer('qr_refresh_interval_seconds').notNull().default(25),
    weeklySchedule: jsonb('weekly_schedule').notNull(),
    semesterStart: date('semester_start').notNull(),
    semesterEnd: date('semester_end').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('courses_instructor_idx').on(table.instructorId)],
);
