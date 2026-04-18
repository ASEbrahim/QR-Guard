import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { courses } from './course.schema.js';
import { students } from './user.schema.js';

export const enrollments = pgTable(
  'enrollments',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.courseId, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId, { onDelete: 'cascade' }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.studentId] }),
    // The composite PK above serves course_id-prefixed queries; this plain
    // index on student_id alone serves Socket.IO canAccessSession,
    // getMyAttendance, and the student branch of listCourses without a seq
    // scan of the enrollments table.
    index('enrollments_student_idx').on(table.studentId),
  ],
);
