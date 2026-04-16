import { addWeeks, setHours, setMinutes, getDay, startOfDay, isAfter } from 'date-fns';

/**
 * Day name to JS getDay() index.
 * JS: 0=Sun, 1=Mon, ... 6=Sat
 */
const DAY_MAP = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Generates session rows from a weekly schedule and semester date range.
 * Timezone: Asia/Kuwait (UTC+3, no DST).
 *
 * @param {{day: string, start: string, end: string}[]} weeklySchedule
 *   e.g., [{day: 'mon', start: '09:00', end: '10:15'}, {day: 'wed', start: '09:00', end: '10:15'}]
 * @param {string} semesterStart - ISO date string (e.g., '2026-02-01')
 * @param {string} semesterEnd - ISO date string (e.g., '2026-05-31')
 * @param {string} courseId
 * @returns {{courseId: string, scheduledStart: Date, scheduledEnd: Date}[]}
 */
export function generateSessions(weeklySchedule, semesterStart, semesterEnd, courseId) {
  const start = new Date(semesterStart);
  const end = new Date(semesterEnd);
  const now = new Date();
  const result = [];

  for (const slot of weeklySchedule) {
    const targetDay = DAY_MAP[slot.day.toLowerCase()];
    if (targetDay === undefined) continue;

    const [startHour, startMin] = slot.start.split(':').map(Number);
    const [endHour, endMin] = slot.end.split(':').map(Number);

    // Find the first occurrence of targetDay on or after semesterStart
    let current = startOfDay(start);
    while (getDay(current) !== targetDay) {
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }

    // Generate sessions week by week until semester end
    while (!isAfter(current, end)) {
      const sessionStart = setMinutes(setHours(current, startHour), startMin);
      const sessionEnd = setMinutes(setHours(current, endHour), endMin);

      // Only generate future sessions
      if (isAfter(sessionStart, now)) {
        result.push({
          courseId,
          scheduledStart: sessionStart,
          scheduledEnd: sessionEnd,
        });
      }

      current = addWeeks(current, 1);
    }
  }

  // Sort by scheduled start
  result.sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
  return result;
}
