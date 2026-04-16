import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
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
  (table) => [primaryKey({ columns: [table.courseId, table.studentId] })],
);
