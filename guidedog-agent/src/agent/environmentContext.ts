/** Small, task-stable environment facts injected below the static system prompt. */
export function buildEnvironmentContext(
  now: Date = new Date(),
  resolvedTimeZone?: string,
): Record<string, string> {
  const currentDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  return {
    当前日期: currentDate,
    本地时区: resolvedTimeZone || detectTimeZone(now),
    运行平台: 'Android',
  };
}

function detectTimeZone(now: Date): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    // Hermes builds without full Intl data fall back to a numeric UTC offset.
  }
  const minutesEastOfUtc = -now.getTimezoneOffset();
  const sign = minutesEastOfUtc >= 0 ? '+' : '-';
  const absolute = Math.abs(minutesEastOfUtc);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}
