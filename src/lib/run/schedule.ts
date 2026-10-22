// The schedule: Monday and Thursday at 07:00 IST. Vercel Cron runs in UTC, and IST is UTC+5:30 all year,
// so 07:00 IST is 01:30 UTC and the cron expression is "30 1 * * 1,4" (the same weekdays in UTC and IST).

export const CRON_EXPRESSION = "30 1 * * 1,4";

/** The next scheduled run strictly after `now`. */
export function nextScheduledRun(now: Date): Date {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, 1, 30, 0));
    if ((d.getUTCDay() === 1 || d.getUTCDay() === 4) && d.getTime() > now.getTime()) return d;
  }
  throw new Error("unreachable");
}

/** Today's date in India, as 2026-10-22. Runs use this date for the season factor and "last complete week". */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Vercel sends "Authorization: Bearer <CRON_SECRET>" with every cron call. Anything else is refused. */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i); // constant-time compare
  return diff === 0;
}
