import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { sessions } from './session.schema.js';

export const qrTokens = pgTable(
  'qr_tokens',
  {
    tokenId: uuid('token_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    payload: text('payload').notNull().unique(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('qr_tokens_session_idx').on(table.sessionId, table.generatedAt)],
);
