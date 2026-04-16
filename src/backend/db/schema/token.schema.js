import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { users } from './user.schema.js';

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  token: text('token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.userId, { onDelete: 'cascade' }),
  purpose: text('purpose', { enum: ['email_verify', 'password_reset', 'device_rebind'] }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});
