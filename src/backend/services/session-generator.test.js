import { describe, it, expect } from 'vitest';
import { generateSessions } from './session-generator.js';

describe('Session Generator', () => {
  const courseId = 'test-course-id';

  it('should generate sessions for a Mon/Wed schedule', () => {
    const schedule = [
      { day: 'mon', start: '09:00', end: '10:15' },
      { day: 'wed', start: '09:00', end: '10:15' },
    ];

    // Use a future date range to ensure sessions are generated
    const start = '2027-01-04'; // A Monday
    const end = '2027-01-18'; // Two weeks later

    const sessions = generateSessions(schedule, start, end, courseId);

    // Should have Mon + Wed for each of ~2 weeks = ~4 sessions
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    expect(sessions.length).toBeLessThanOrEqual(5);

    // All should have the correct course ID
    sessions.forEach((s) => {
      expect(s.courseId).toBe(courseId);
      expect(s.scheduledStart).toBeInstanceOf(Date);
      expect(s.scheduledEnd).toBeInstanceOf(Date);
    });
  });

  it('should return empty for past date range', () => {
    const sessions = generateSessions(
      [{ day: 'mon', start: '09:00', end: '10:15' }],
      '2020-01-01',
      '2020-01-31',
      courseId,
    );

    expect(sessions).toHaveLength(0);
  });

  it('should handle invalid day names gracefully', () => {
    const sessions = generateSessions(
      [{ day: 'invalid', start: '09:00', end: '10:15' }],
      '2027-01-01',
      '2027-01-31',
      courseId,
    );

    expect(sessions).toHaveLength(0);
  });

  it('should sort sessions by scheduled start', () => {
    const schedule = [
      { day: 'wed', start: '14:00', end: '15:15' },
      { day: 'mon', start: '09:00', end: '10:15' },
    ];

    const sessions = generateSessions(schedule, '2027-01-04', '2027-01-18', courseId);

    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i].scheduledStart.getTime()).toBeGreaterThanOrEqual(
        sessions[i - 1].scheduledStart.getTime(),
      );
    }
  });
});
