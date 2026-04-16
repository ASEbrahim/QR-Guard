import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { students } from '../db/schema/index.js';
import { ScanError } from './scan-error.js';

/**
 * Layer 2: Check device fingerprint matches stored binding.
 * Instructors are exempt (no device binding).
 *
 * @param {string} studentId — the authenticated student's user ID
 * @param {string} providedFingerprint — FingerprintJS visitor ID from the scan request
 * @throws {ScanError} code='device_mismatch' if fingerprints don't match
 */
export async function checkDevice(studentId, providedFingerprint) {
  const [student] = await db
    .select({ deviceFingerprint: students.deviceFingerprint })
    .from(students)
    .where(eq(students.userId, studentId))
    .limit(1);

  if (!student) {
    throw new ScanError('Student not found', 'device_mismatch');
  }

  // If no device bound yet, allow (edge case: binding happens on login, not scan)
  if (!student.deviceFingerprint) {
    return;
  }

  if (student.deviceFingerprint !== providedFingerprint) {
    throw new ScanError('Device not recognized', 'device_mismatch');
  }
}
