import { pgTable, text, uuid, timestamp, numeric, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sessions } from './session.schema.js';
import { students } from './user.schema.js';

export const attendance = pgTable(
  'attendance',
  {
    attendanceId: uuid('attendance_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.userId),
    status: text('status', { enum: ['present', 'absent', 'excused'] }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    gpsLat: numeric('gps_lat', { precision: 10, scale: 7 }),
    gpsLng: numeric('gps_lng', { precision: 10, scale: 7 }),
    gpsAccuracyM: numeric('gps_accuracy_m', { precision: 8, scale: 2 }),
    // Stored as text, not inet — deviation from SCHEMA.md noted in STATE.md
    ipAddress: text('ip_address'),
    deviceHash: text('device_hash'),
    excuseReason: text('excuse_reason'),
  },
  (table) => [
    uniqueIndex('attendance_session_student_idx').on(table.sessionId, table.studentId),
    index('attendance_student_idx').on(table.studentId),
  ],
);
