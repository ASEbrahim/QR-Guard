import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { courses } from '../db/schema/index.js';
import { ENROLLMENT_CODE_LENGTH, ENROLLMENT_CODE_ALPHABET } from '../config/constants.js';

/**
 * Generates a unique 6-character enrollment code.
 * Uses crypto.randomBytes for cryptographic randomness.
 * Alphabet excludes confusing characters (0/O, 1/I/L).
 * Retries on DB unique constraint collision.
 * @returns {Promise<string>} A unique enrollment code
 */
export async function generateEnrollmentCode() {
  const maxRetries = 10;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const bytes = crypto.randomBytes(ENROLLMENT_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < ENROLLMENT_CODE_LENGTH; i++) {
      code += ENROLLMENT_CODE_ALPHABET[bytes[i] % ENROLLMENT_CODE_ALPHABET.length];
    }

    // Check for collision
    const existing = await db
      .select({ courseId: courses.courseId })
      .from(courses)
      .where(eq(courses.enrollmentCode, code))
      .limit(1);

    if (existing.length === 0) {
      return code;
    }
  }

  throw new Error('Failed to generate unique enrollment code after maximum retries');
}
