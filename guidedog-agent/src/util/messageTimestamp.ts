function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Format a compact IM-style timestamp using the device's local timezone. */
export function formatMessageTimestamp(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return '';

  const date = new Date(timestamp);
  const current = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(current.getTime())) return '';

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameLocalDay(date, current)) return time;

  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return `昨天 ${time}`;

  const shortDate = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() === current.getFullYear()) return `${shortDate} ${time}`;
  return `${date.getFullYear()}年${shortDate} ${time}`;
}
