export type ReportScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (key: string) => parts.find(part => part.type === key)?.value ?? '0';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value('year')), month: Number(value('month')), day: Number(value('day')),
    hour: Number(value('hour')), minute: Number(value('minute')), weekday: weekdays[value('weekday')] ?? 0,
  };
}

function localTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0);
    const delta = target - represented;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function nextReportScheduleAt(
  frequency: ReportScheduleFrequency,
  timeOfDay: string,
  timezone: string,
  weekday: number | null,
  after: Date = new Date(),
): Date {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(timeOfDay);
  if (!match) throw new Error('Invalid report schedule time');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const local = zonedParts(after, timezone);
  const start = Date.UTC(local.year, local.month - 1, local.day);
  for (let offset = 0; offset <= 40; offset += 1) {
    const day = new Date(start + offset * 86400000);
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const date = day.getUTCDate();
    if (frequency === 'WEEKLY' && day.getUTCDay() !== weekday) continue;
    if (frequency === 'MONTHLY' && date !== 1) continue;
    const candidate = localTimeToUtc(year, month, date, hour, minute, timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('Could not calculate next report schedule occurrence');
}
