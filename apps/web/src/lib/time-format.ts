/**
 * Hybrid time format per PRD #11 user story #15a:
 *   today              → "14:03"
 *   yesterday          → "Yesterday 14:03"
 *   earlier this week  → "Mon 14:03"
 *   earlier this year  → "May 5"
 *   older              → "May 5, 2025"
 *
 * `now` is injectable so tests aren't time-dependent. Returns local time
 * (Intl.DateTimeFormat picks up the system TZ).
 */
export const formatHybrid = (when: Date, now: Date = new Date()): string => {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date): number => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const todayStart = startOfDay(now);
  const dayDelta = Math.round((todayStart - startOfDay(when)) / oneDayMs);

  const hhmm = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(when);

  if (dayDelta === 0) return hhmm;
  if (dayDelta === 1) return `Yesterday ${hhmm}`;
  if (dayDelta > 1 && dayDelta < 7) {
    const dayName = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(when);
    return `${dayName} ${hhmm}`;
  }

  if (when.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(when);
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(when);
};

/** Full ISO-ish datetime for the hover tooltip on each /inbox row. */
export const formatTooltip = (when: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(when);
