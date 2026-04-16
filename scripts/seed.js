/**
 * Seeds the database with test accounts.
 * Run: node scripts/seed.js
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { db, pool } from '../src/backend/config/database.js';
import { users, students, instructors } from '../src/backend/db/schema/index.js';
import { BCRYPT_ROUNDS } from '../src/backend/config/constants.js';

const hash = await bcrypt.hash('password123', BCRYPT_ROUNDS);

// Instructor
const [inst] = await db.insert(users).values({
  email: 'test@auk.edu.kw', passwordHash: hash, name: 'Dr. Test', role: 'instructor',
  emailVerifiedAt: new Date(),
}).returning();
await db.insert(instructors).values({ userId: inst.userId, employeeId: 'E999' });

// Student
const [stu] = await db.insert(users).values({
  email: 'student@auk.edu.kw', passwordHash: hash, name: 'Test Student', role: 'student',
  emailVerifiedAt: new Date(),
}).returning();
await db.insert(students).values({ userId: stu.userId, universityId: '99001' });

console.log('Seeded:');
console.log('  test@auk.edu.kw / password123 (instructor)');
console.log('  student@auk.edu.kw / password123 (student)');

await pool.end();
