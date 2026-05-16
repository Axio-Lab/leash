import type { AutomationRow } from '../storage/automations.js';

type ScheduleAutomation = Pick<AutomationRow, 'triggerType' | 'triggerConfig' | 'timezone'>;

const DEFAULT_TIME = '09:00';
const DEFAULT_INTERVAL_MINUTES = 60;

function asPositiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseTime(value: unknown): { hour: number; minute: number } {
  const raw = typeof value === 'string' ? value : DEFAULT_TIME;
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { hour: 9, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function partsFor(date: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map = new Map(formatted.map((p) => [p.type, p.value]));
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: Number(map.get('hour')),
    minute: Number(map.get('minute')),
    second: Number(map.get('second')),
    weekday: Math.max(0, weekdayNames.indexOf(map.get('weekday') ?? 'Sun')),
  };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const p = partsFor(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

function localDateTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(target);
  for (let i = 0; i < 3; i += 1) {
    candidate = new Date(target - offsetMsAt(candidate, timeZone));
  }
  return candidate;
}

function localYmdPlusDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function normaliseWeekday(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback;
}

export function computeNextRunAt(automation: ScheduleAutomation, from = new Date()): string | null {
  if (automation.triggerType !== 'schedule') return null;

  const schedule =
    typeof automation.triggerConfig.schedule === 'string'
      ? automation.triggerConfig.schedule
      : 'daily';

  if (schedule === 'interval') {
    const intervalMinutes = asPositiveNumber(
      automation.triggerConfig.interval_minutes,
      DEFAULT_INTERVAL_MINUTES,
    );
    return new Date(from.getTime() + intervalMinutes * 60_000).toISOString();
  }

  const timeZone = automation.timezone || 'UTC';
  const { hour, minute } = parseTime(automation.triggerConfig.time);
  const nowLocal = partsFor(from, timeZone);
  const targetWeekday =
    schedule === 'weekly'
      ? normaliseWeekday(automation.triggerConfig.weekday, nowLocal.weekday)
      : null;

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const local = localYmdPlusDays(nowLocal.year, nowLocal.month, nowLocal.day, dayOffset);
    if (targetWeekday != null) {
      const localWeekday = partsFor(
        localDateTimeToUtc(timeZone, local.year, local.month, local.day, 12, 0),
        timeZone,
      ).weekday;
      if (localWeekday !== targetWeekday) continue;
    }
    const candidate = localDateTimeToUtc(
      timeZone,
      local.year,
      local.month,
      local.day,
      hour,
      minute,
    );
    if (candidate.getTime() > from.getTime()) return candidate.toISOString();
  }

  return new Date(from.getTime() + 24 * 60 * 60_000).toISOString();
}
