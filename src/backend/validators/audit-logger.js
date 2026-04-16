import { db } from '../config/database.js';
import { auditLog } from '../db/schema/index.js';

/**
 * Layer 6: Append every scan attempt to the audit log. Always runs (in finally block).
 *
 * @param {{eventType: string, actorId: string|null, targetId: string|null, result: string, reason: string|null, details: object|null}} entry
 */
export async function logAudit(entry) {
  try {
    await db.insert(auditLog).values({
      eventType: entry.eventType,
      actorId: entry.actorId || null,
      targetId: entry.targetId || null,
      result: entry.result,
      reason: entry.reason || null,
      details: entry.details || null,
    });
  } catch (err) {
    // Audit logging should never break the scan flow
    console.error('[audit-logger] Failed to write audit log:', err.message);
  }
}
