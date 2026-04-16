import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { courses } from './course.schema.js';

export const sessions = pgTable(
  'sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.courseId, { onDelete: 'cascade' }),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
    actualStart: timestamp('actual_start', { withTimezone: true }),
    actualEnd: timestamp('actual_end', { withTimezone: true }),
    status: text('status', { enum: ['scheduled', 'active', 'closed', 'cancelled'] })
      .notNull()
      .default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_course_idx').on(table.courseId, table.scheduledStart)],
);
