import {
  markAutomatedHostForeground,
  resetHostEntrySpeechPolicy,
  shouldInterruptSpeechOnHostEntry,
} from '../hostEntrySpeechPolicy';

describe('host-entry speech interruption policy', () => {
  beforeEach(() => resetHostEntrySpeechPolicy());

  test('interrupts speech for an ordinary user foreground entry', () => {
    expect(shouldInterruptSpeechOnHostEntry(1_000)).toBe(true);
  });

  test('preserves speech for the next automated clarification foreground entry', () => {
    markAutomatedHostForeground(1_000);
    expect(shouldInterruptSpeechOnHostEntry(1_500)).toBe(false);
    expect(shouldInterruptSpeechOnHostEntry(1_600)).toBe(true);
  });

  test('does not leave a stale exemption after the grace window', () => {
    markAutomatedHostForeground(1_000);
    expect(shouldInterruptSpeechOnHostEntry(6_001)).toBe(true);
    expect(shouldInterruptSpeechOnHostEntry(6_002)).toBe(true);
  });
});
