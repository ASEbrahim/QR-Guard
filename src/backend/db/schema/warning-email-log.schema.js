import { pgTable, uuid, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { courses } from './course.schema.js';
import { students } from './user.schema.js';

export const warningEmailLog = pgTable(
  'warning_email_log',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.courseId, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId, { onDelete: 'cascade' }),
    crossedBelowAt: timestamp('crossed_below_at', { withTimezone: true }).notNull(),
    recoveredAboveAt: timestamp('recovered_above_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.courseId, table.studentId, table.crossedBelowAt] })],
);
