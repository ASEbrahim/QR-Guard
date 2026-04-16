import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../config/database.js';
import { users, students } from '../db/schema/index.js';
import { sql } from 'drizzle-orm';
import { checkDevice } from './device-checker.js';

describe('DeviceChecker', () => {
  let studentId;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({
      email: 'dctest@auk.edu.kw', passwordHash: '$2b$12$fakehash', name: 'DC Test', role: 'student',
    }).returning();
    await db.insert(students).values({ userId: user.userId, universityId: 'DC001', deviceFingerprint: 'fp_abc123' });
    studentId = user.userId;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM students WHERE university_id = 'DC001'`);
    await db.execute(sql`DELETE FROM users WHERE email = 'dctest@auk.edu.kw'`);
    await pool.end();
  });

  it('should pass when fingerprint matches', async () => {
    await expect(checkDevice(studentId, 'fp_abc123')).resolves.toBeUndefined();
  });

  it('should reject when fingerprint mismatches', async () => {
    await expect(checkDevice(studentId, 'fp_different')).rejects.toThrow('Device not recognized');
  });

  it('should reject when student not found', async () => {
    await expect(checkDevice('00000000-0000-0000-0000-000000000000', 'any')).rejects.toThrow('Student not found');
  });
});
