/**
 * Day name to JS getUTCDay() index.
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
 * Kuwait is UTC+3 year-round (no DST). Classes are scheduled in local time
 * but must be stored as UTC so PostgreSQL's timestamptz comparisons and
 * Socket.IO pushes behave identically regardless of server TZ (Render =
 * UTC, dev = host TZ). Offset is positive (+3) so local → UTC subtracts it.
 */
const KUWAIT_UTC_OFFSET_HOURS = 3;

/**
 * Parses 'YYYY-MM-DD' into [year, month, day] WITHOUT timezone interpretation.
 * `new Date('2026-02-01')` treats the string as UTC midnight — we need the
 * calendar date itself, independent of the parser's locale.
 */
function parseIsoDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/**
 * Generates session rows from a weekly schedule and semester date range.
 *
 * All session timestamps are constructed as UTC instants whose wall-clock
 * time in Kuwait (UTC+3) equals the scheduled start/end strings. A class
 * scheduled for 09:00 Kuwait time is stored as 06:00 UTC.
 *
 * @param {{day: string, start: string, end: string}[]} weeklySchedule
 *   e.g., [{day: 'mon', start: '09:00', end: '10:15'}, ...]
 * @param {string} semesterStart - 'YYYY-MM-DD' (calendar date, no TZ)
 * @param {string} semesterEnd   - 'YYYY-MM-DD' (calendar date, no TZ)
 * @param {string} courseId
 * @returns {{courseId: string, scheduledStart: Date, scheduledEnd: Date}[]}
 */
export function generateSessions(weeklySchedule, semesterStart, semesterEnd, courseId) {
  const startDate = parseIsoDate(semesterStart);
  const endDate = parseIsoDate(semesterEnd);
  // Anchor at Kuwait-midnight (which is startDate 00:00 +03:00 = prior UTC day 21:00).
  // We compute session instants directly with Date.UTC below, so we just need
  // the semester window bounded by UTC instants for the Kuwait-midnight edges.
  const semesterStartUtc = Date.UTC(startDate.year, startDate.month - 1, startDate.day, -KUWAIT_UTC_OFFSET_HOURS);
  const semesterEndUtc = Date.UTC(endDate.year, endDate.month - 1, endDate.day, 24 - KUWAIT_UTC_OFFSET_HOURS);
  const now = Date.now();
  const result = [];

  for (const slot of weeklySchedule) {
    const targetDay = DAY_MAP[slot.day.toLowerCase()];
    if (targetDay === undefined) continue;

    const [startHour, startMin] = slot.start.split(':').map(Number);
    const [endHour, endMin] = slot.end.split(':').map(Number);

    // Walk calendar days (Kuwait-local) starting at semesterStart and find
    // the first occurrence of targetDay. We key off the Kuwait-local weekday,
    // which equals the UTC weekday of (instant + 3h).
    let cursor = new Date(semesterStartUtc);
    while (true) {
      const cursorKuwaitDayOfWeek = new Date(cursor.getTime() + KUWAIT_UTC_OFFSET_HOURS * 3600 * 1000).getUTCDay();
      if (cursorKuwaitDayOfWeek === targetDay) break;
      cursor = new Date(cursor.getTime() + 86400000);
    }

    while (cursor.getTime() <= semesterEndUtc) {
      // Build sessionStart = UTC instant whose Kuwait wall-clock is (y,m,d,startHour,startMin).
      // cursor is the midnight-Kuwait instant for that calendar day. Add hours.
      const sessionStart = new Date(cursor.getTime() + (startHour * 60 + startMin) * 60 * 1000);
      const sessionEnd = new Date(cursor.getTime() + (endHour * 60 + endMin) * 60 * 1000);

      if (sessionStart.getTime() > now) {
        result.push({
          courseId,
          scheduledStart: sessionStart,
          scheduledEnd: sessionEnd,
        });
      }

      cursor = new Date(cursor.getTime() + 7 * 86400000);
    }
  }

  result.sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime());
  return result;
}
