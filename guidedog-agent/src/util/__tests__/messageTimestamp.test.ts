import { formatMessageTimestamp } from '../messageTimestamp';

describe('formatMessageTimestamp', () => {
  test('shows only the time for messages from today', () => {
    const now = new Date(2026, 7, 25, 18, 30).getTime();
    const message = new Date(2026, 7, 25, 9, 5).getTime();
    expect(formatMessageTimestamp(message, now)).toBe('09:05');
  });

  test('labels messages from yesterday', () => {
    const now = new Date(2026, 0, 1, 8, 0).getTime();
    const message = new Date(2025, 11, 31, 23, 59).getTime();
    expect(formatMessageTimestamp(message, now)).toBe('昨天 23:59');
  });

  test('adds the date for older messages in the same year', () => {
    const now = new Date(2026, 7, 25, 18, 30).getTime();
    const message = new Date(2026, 6, 2, 9, 5).getTime();
    expect(formatMessageTimestamp(message, now)).toBe('7月2日 09:05');
  });

  test('adds the year when needed', () => {
    const now = new Date(2026, 7, 25, 18, 30).getTime();
    const message = new Date(2025, 6, 2, 9, 5).getTime();
    expect(formatMessageTimestamp(message, now)).toBe('2025年7月2日 09:05');
  });
});
