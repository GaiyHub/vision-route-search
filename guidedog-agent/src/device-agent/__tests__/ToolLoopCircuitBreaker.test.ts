import {
  ToolLoopCircuitBreaker,
  createToolLoopObservation,
  normalizeToolAction,
} from '../agent/ToolLoopCircuitBreaker';
import {
  TOOL_CIRCUIT_BREAKER_CATALOG,
  canonicalToolName,
  normalizeToolCircuitBreakerOverrides,
  resolveToolCircuitBreakerPolicy,
} from '../tools/ToolCircuitBreakerPolicy';
import { PHONE_TOOLS } from '../tools/PhoneTools';

const sameBefore = createToolLoopObservation({ screenState: 'Button 12:30 50%' });
const sameAfter = createToolLoopObservation({ screenState: 'Button 12:31 51%' });
const changedAfter = createToolLoopObservation({ screenState: 'Different page' });

describe('tool circuit-breaker policy', () => {
  test('catalog covers every current phone tool without treating click as a tap alias', () => {
    expect(TOOL_CIRCUIT_BREAKER_CATALOG).toHaveLength(PHONE_TOOLS.length + 16);
    expect(TOOL_CIRCUIT_BREAKER_CATALOG.some((entry) => entry.name === 'confirm_action'))
      .toBe(false);
    expect(resolveToolCircuitBreakerPolicy('browser_navigate')).toMatchObject({
      name: 'browser_navigate',
      family: 'navigation',
      behavior: 'block',
    });
    expect(resolveToolCircuitBreakerPolicy('web_search')).toMatchObject({
      name: 'web_search',
      family: 'observation',
      behavior: 'warn-only',
      blockThreshold: null,
    });
    expect(canonicalToolName('click')).toBe('click');
    expect(resolveToolCircuitBreakerPolicy('click').name).toBe('click');
  });

  test('normalizes persisted overrides independently and keeps safety tools exempt', () => {
    const normalized = normalizeToolCircuitBreakerOverrides({
      ui_tap: { warningThreshold: 1, blockThreshold: 2 },
      scroll: { warningThreshold: 8, blockThreshold: 3 },
      task_complete: { warningThreshold: 1, blockThreshold: 2 },
      file_read: { warningThreshold: 1, blockThreshold: 2 },
    });
    expect(normalized).toEqual({
      ui_tap: { warningThreshold: 1, blockThreshold: 2 },
    });
    expect(resolveToolCircuitBreakerPolicy('task_complete', normalized).behavior).toBe('exempt');
    expect(resolveToolCircuitBreakerPolicy('new_mutating_tool').behavior).toBe('block');
  });

  test('normalizes transient refs while keeping node and coordinate modes distinct', () => {
    const firstNode = normalizeToolAction({
      name: 'ui_tap',
      arguments: {
        mode: 'ref', ref: 'u1', dispatch: 'node',
        _resolvedBounds: { left: 28, top: 536, right: 1412, bottom: 667 },
        _resolvedResourceId: 'example:id/card',
      },
    });
    const nextNode = normalizeToolAction({
      name: 'ui_tap',
      arguments: {
        mode: 'ref', ref: 'u9z', dispatch: 'node',
        _resolvedBounds: { left: 28, top: 536, right: 1412, bottom: 667 },
        _resolvedResourceId: 'example:id/card',
      },
    });
    const coordinate = normalizeToolAction({
      name: 'ui_tap',
      arguments: {
        mode: 'coordinate', x: 720, y: 600, observationId: 'shot_2',
      },
    });
    expect(firstNode.fingerprint).toBe(nextNode.fingerprint);
    expect(coordinate.fingerprint).not.toBe(firstNode.fingerprint);
    expect(firstNode.normalizedArguments).not.toHaveProperty('ref');
  });

  test('one tool override does not affect another tool', () => {
    const overrides = { ui_tap: { warningThreshold: 1, blockThreshold: 2 } };
    expect(resolveToolCircuitBreakerPolicy('ui_tap', overrides).warningThreshold).toBe(1);
    expect(resolveToolCircuitBreakerPolicy('ui_scroll', overrides).warningThreshold).toBe(3);
  });
});

describe('equivalent action normalization', () => {
  test('ignores display fields, object key order and nearby coordinate drift', () => {
    const first = normalizeToolAction({
      name: 'ui_tap',
      arguments: { x: 101, y: 203, tool_title: 'first' },
    });
    const second = normalizeToolAction({
      name: 'click',
      arguments: { tool_title: 'second', y: 207, x: 106 },
    });
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  test('keeps distinct node targets separate', () => {
    const first = normalizeToolAction({ name: 'ui_tap', arguments: { nodeId: '1:a' } });
    const second = normalizeToolAction({ name: 'ui_tap', arguments: { nodeId: '1:b' } });
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  test('normalizes swipe semantics and ignores wait duration changes', () => {
    const swipeA = normalizeToolAction({
      name: 'ui_swipe',
      arguments: { startX: 100, startY: 700, endX: 100, endY: 200, durationMs: 300 },
    });
    const swipeB = normalizeToolAction({
      name: 'ui_swipe',
      arguments: { endY: 205, endX: 105, startY: 705, startX: 104, durationMs: 800 },
    });
    expect(swipeB.fingerprint).toBe(swipeA.fingerprint);

    const shortWait = normalizeToolAction({ name: 'wait', arguments: { ms: 1000 } });
    const longWait = normalizeToolAction({ name: 'wait', arguments: { ms: 6000 } });
    expect(longWait.fingerprint).toBe(shortWait.fingerprint);
  });

  test('does not treat changing wait result text as progress', () => {
    const detector = new ToolLoopCircuitBreaker({ toolNames: ['wait'] });
    const first = { name: 'wait', arguments: { ms: 3000 } };
    const second = { name: 'wait', arguments: { ms: 10000 } };
    detector.recordAfter(first, '等待 3001ms 完成，屏幕未变化', sameBefore, sameAfter);
    const result = detector.recordAfter(
      second,
      '等待 10004ms 完成，屏幕未变化',
      sameBefore,
      sameAfter,
    );
    expect(result.progress).toBe(false);
    expect(result.noProgressCount).toBe(2);
  });
});

describe('ToolLoopCircuitBreaker behavior', () => {
  test('warns once, then blocks before the configured next execution', () => {
    const detector = new ToolLoopCircuitBreaker({
      toolNames: ['ui_tap', 'ui_scroll'],
      overrides: { tap: { warningThreshold: 1, blockThreshold: 2 } },
    });
    const call = { name: 'ui_tap', arguments: { x: 100, y: 200 } };

    expect(detector.checkBefore(call).blocked).toBeNull();
    const first = detector.recordAfter(call, { ok: true }, sameBefore, sameAfter);
    expect(first.warning?.count).toBe(1);
    expect(detector.consumeWarning()?.count).toBe(1);
    expect(detector.consumeWarning()).toBeNull();

    expect(detector.checkBefore(call).blocked).toBeNull();
    const second = detector.recordAfter(call, { ok: true }, sameBefore, sameAfter);
    expect(second.warning).toBeNull();

    const blocked = detector.checkBefore(call);
    expect(blocked.blocked).toMatchObject({
      ok: false,
      code: 'LOOP_BLOCKED',
      details: { count: 2 },
    });
    expect(blocked.blocked).not.toHaveProperty('retryable');
    expect(blocked.blocked).not.toHaveProperty('hint');
  });

  test('changing UI records progress and clears the sequence', () => {
    const detector = new ToolLoopCircuitBreaker({ toolNames: ['ui_scroll'] });
    const call = { name: 'ui_scroll', arguments: { direction: 'down' } };
    detector.recordAfter(call, { ok: true }, sameBefore, sameAfter);
    detector.recordAfter(call, { ok: true }, sameBefore, sameAfter);
    const progress = detector.recordAfter(call, { ok: true }, sameBefore, changedAfter);
    expect(progress.progress).toBe(true);
    expect(detector.checkBefore(call).count).toBe(0);
  });

  test('trusts a tool-owned verified page change without implicit loop observation', () => {
    const detector = new ToolLoopCircuitBreaker({ toolNames: ['ui_tap', 'ui_scroll_page'] });
    const page = { name: 'ui_scroll_page', arguments: { direction: 'down' } };
    const tap = { name: 'ui_tap', arguments: { x: 100, y: 200 } };
    const pageProgress = detector.recordAfter(page, {
      ok: true,
      data: { changed: true, verificationStatus: 'verified_changed' },
    }, sameBefore, sameAfter);
    const tapProgress = detector.recordAfter(tap, {
      ok: true,
      data: { screenChanged: true, verificationStatus: 'verified_changed' },
    }, sameBefore, sameAfter);
    expect(pageProgress.progress).toBe(true);
    expect(tapProgress.progress).toBe(true);
    expect(detector.checkBefore(page).count).toBe(0);
    expect(detector.checkBefore(tap).count).toBe(0);
  });

  test('read-only and safety tools never hard block', () => {
    const detector = new ToolLoopCircuitBreaker({ toolNames: ['ui_find_node', 'task_complete'] });
    const read = { name: 'ui_find_node', arguments: { text: 'missing' } };
    for (let index = 0; index < 8; index++) {
      detector.recordAfter(read, { ok: true, data: null }, sameBefore, sameAfter);
    }
    expect(detector.checkBefore(read).blocked).toBeNull();
    expect(detector.checkBefore({ name: 'task_complete', arguments: {} }).blocked).toBeNull();
  });

  test('a progressing alternative action breaks the earlier no-progress sequence', () => {
    const detector = new ToolLoopCircuitBreaker({
      toolNames: ['ui_tap', 'open_app'],
      overrides: { tap: { warningThreshold: 1, blockThreshold: 2 } },
    });
    const tap = { name: 'ui_tap', arguments: { x: 100, y: 200 } };
    detector.recordAfter(tap, { ok: true }, sameBefore, sameAfter);
    detector.recordAfter(
      { name: 'open_app', arguments: { packageName: 'example' } },
      { ok: true },
      sameBefore,
      changedAfter,
    );
    expect(detector.checkBefore(tap).count).toBe(0);
  });

  test('input and wait keep independent default thresholds', () => {
    const detector = new ToolLoopCircuitBreaker({ toolNames: ['ui_fill', 'wait'] });
    const input = { name: 'ui_fill', arguments: { mode: 'focused', value: 'value' } };
    const wait = { name: 'wait', arguments: { ms: 1000 } };
    for (let index = 0; index < 3; index++) {
      detector.recordAfter(input, { ok: false, error: 'no focus' }, sameBefore, sameAfter);
      detector.recordAfter(wait, { ok: true }, sameBefore, sameAfter);
    }
    expect(detector.checkBefore(input).blocked?.code).toBe('LOOP_BLOCKED');
    expect(detector.checkBefore(wait).blocked).toBeNull();
  });

  test('keeps invalid-argument evidence and counts attempts after blocking', () => {
    const detector = new ToolLoopCircuitBreaker({
      toolNames: ['ui_fill'],
      overrides: { ui_fill: { warningThreshold: 1, blockThreshold: 2 } },
    });
    const call = {
      name: 'ui_fill',
      arguments: { mode: 'ref', ref: 'u1', value: 'value', submit: 'not-a-boolean' },
    };
    const invalid = {
      ok: false,
      error: '工具参数无效',
      code: 'INVALID_ARGUMENT',
      details: { errors: ['Argument "submit" must be a boolean, got string'] },
    };

    const first = detector.recordAfter(call, invalid, sameBefore, sameAfter);
    expect(first.warning).toMatchObject({ reason: 'INVALID_ARGUMENT', count: 1 });
    detector.recordAfter(call, invalid, sameBefore, sameAfter);

    const blockedOnce = detector.checkBefore(call);
    expect(blockedOnce.blocked).toMatchObject({
      code: 'LOOP_BLOCKED',
      details: {
        count: 2,
        blockedAttempts: 1,
        lastFailure: { code: 'INVALID_ARGUMENT' },
      },
    });
    expect(JSON.stringify(blockedOnce.blocked)).toContain(
      'Argument \\"submit\\" must be a boolean, got string',
    );

    expect(detector.checkBefore(call).blocked).toMatchObject({
      details: { blockedAttempts: 2 },
    });
  });

  test('reset clears task history and constructor snapshots overrides', () => {
    const overrides = { tap: { warningThreshold: 1, blockThreshold: 2 } };
    const detector = new ToolLoopCircuitBreaker({ toolNames: ['ui_tap'], overrides });
    overrides.tap = { warningThreshold: 5, blockThreshold: 6 };
    const call = { name: 'ui_tap', arguments: { x: 100, y: 200 } };
    detector.recordAfter(call, { ok: true }, sameBefore, sameAfter);
    detector.recordAfter(call, { ok: true }, sameBefore, sameAfter);
    expect(detector.checkBefore(call).blocked).not.toBeNull();
    detector.reset();
    expect(detector.checkBefore(call)).toMatchObject({ count: 0, blocked: null });
  });

  test('read-only observations may be interleaved without hiding a repeated mutation', () => {
    const detector = new ToolLoopCircuitBreaker({
      toolNames: ['ui_tap', 'ui_find_node'],
      overrides: { tap: { warningThreshold: 1, blockThreshold: 2 } },
    });
    const tap = { name: 'ui_tap', arguments: { x: 100, y: 200 } };
    detector.recordAfter(tap, { ok: true }, sameBefore, sameAfter);
    detector.recordAfter(
      { name: 'ui_find_node', arguments: { text: 'x' } },
      { ok: true, data: null },
      sameBefore,
      sameAfter,
    );
    detector.recordAfter(tap, { ok: true }, sameBefore, sameAfter);
    expect(detector.checkBefore(tap).blocked).not.toBeNull();
  });
});
