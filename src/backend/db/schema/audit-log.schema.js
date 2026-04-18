import { pgTable, text, uuid, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './user.schema.js';

export const auditLog = pgTable(
  'audit_log',
  {
    logId: uuid('log_id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    eventType: text('event_type', { enum: ['scan_attempt', 'override', 'auth'] }).notNull(),
    actorId: uuid('actor_id').references(() => users.userId),
    targetId: uuid('target_id'),
    result: text('result', { enum: ['success', 'rejected'] }).notNull(),
    reason: text('reason'),
    details: jsonb('details'),
  },
  (table) => [
    index('audit_log_timestamp_idx').on(table.timestamp),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_target_idx').on(table.targetId),
  ],
);
