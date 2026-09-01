/**
 * ScreenSerializer label-merging tests: anonymous clickable containers
 * (MIUI settings rows) carry their label on a descendant TextView, so the
 * serialized list must read "我的设备" on the clickable row — otherwise the
 * model can't match a skill's "点击 我的设备" to anything clickable and
 * detours through the search box.
 */

import { ScreenSerializer, type A11yNode } from '../agent/ScreenSerializer';

function textNode(text: string, depth: number): A11yNode {
  let node: A11yNode = {
    text,
    className: 'android.widget.TextView',
    children: [],
    bounds: { left: 0, top: 0, right: 100, bottom: 50 },
  };
  // Wrap in `depth` container layers to simulate nested MIUI rows.
  for (let i = 0; i < depth; i++) {
    node = {
      text: '',
      className: 'android.widget.LinearLayout',
      children: [node],
      bounds: { left: 0, top: 0, right: 100, bottom: 50 },
    };
  }
  return node;
}

function clickableRow(label: A11yNode): A11yNode {
  return {
    text: '',
    className: 'android.widget.LinearLayout',
    isClickable: true,
    children: [label],
    bounds: { left: 0, top: 0, right: 400, bottom: 100 },
  };
}

describe('ScreenSerializer label merging', () => {
  test('leaves dispatch and fallback policy in the ui_tap tool contract', () => {
    const out = ScreenSerializer.serialize([]);
    expect(out).toContain('相互独立的定位模式');
    expect(out).toContain('以 ui_tap 工具描述为准');
    expect(out).not.toContain('节点点击已被接受');
    expect(out).not.toContain('改用 coordinate');
  });

  test('clickable container adopts its descendant text as label', () => {
    // MIUI "我的设备" row: clickable LinearLayout → LinearLayout →
    // RelativeLayout → TextView "我的设备" (3 levels deep).
    const row = clickableRow(textNode('我的设备', 2));
    const out = ScreenSerializer.serialize([row]);
    expect(out).toContain('LinearLayout "我的设备"');
    expect(out).not.toContain('"(无文本)"');
  });

  test('container text is not merged beyond the depth cap', () => {
    const row = clickableRow(textNode('太深的文字', 6));
    const out = ScreenSerializer.serialize([row]);
    // Depth 6 > cap of 4: the clickable row itself stays anonymous (the deep
    // TextView still appears as its own list entry, which is expected).
    expect(out).toContain('LinearLayout "(无文本)" 中心(200,50)');
    expect(out).not.toContain('LinearLayout "太深的文字"');
  });

  test('clickable card aggregates several distinct descendant labels', () => {
    const card = clickableRow({
      className: 'android.widget.LinearLayout',
      bounds: { left: 0, top: 0, right: 400, bottom: 100 },
      children: [
        textNode('长钱保·五年领年金', 0),
        textNode('到期保收益', 0),
        textNode('5.21%', 0),
        textNode('5.21%', 0),
      ],
    });
    const out = ScreenSerializer.serialize([card]);
    expect(out).toContain(
      'LinearLayout "长钱保·五年领年金 | 到期保收益 | 5.21%"',
    );
  });

  test('opaque refs and resource IDs are exposed without duplicate-ID heuristics', () => {
    const first = {
      ...clickableRow(textNode('产品A', 0)),
      ref: 'u1',
      resourceId: 'com.test:id/product_card',
      bounds: { left: 0, top: 0, right: 400, bottom: 100 },
    };
    const second = {
      ...clickableRow(textNode('产品B', 0)),
      ref: 'u2',
      resourceId: 'com.test:id/product_card',
      bounds: { left: 0, top: 100, right: 400, bottom: 200 },
    };
    const out = ScreenSerializer.serialize([first, second]);
    expect(out).toContain('ref=u1 resourceId=com.test:id/product_card');
    expect(out).toContain('ref=u2 resourceId=com.test:id/product_card');
    expect(out).not.toContain('同ID序号');
  });

  test('non-clickable anonymous nodes are filtered out entirely', () => {
    const plain = {
      text: '',
      className: 'android.widget.FrameLayout',
      children: [textNode('内部文字', 0)],
      bounds: { left: 0, top: 0, right: 400, bottom: 100 },
    };
    const out = ScreenSerializer.serialize([plain]);
    // No text + not interactive → the container never becomes a list entry.
    expect(out).not.toContain('FrameLayout');
    expect(out).toContain('TextView "内部文字"');
  });

  test('a node with its own text never borrows a descendant label', () => {
    const row = clickableRow(textNode('子标签', 0));
    const labelled = {
      ...row,
      text: '自身标签',
    };
    const out = ScreenSerializer.serialize([labelled]);
    expect(out).toContain('LinearLayout "自身标签"');
    // The descendant still gets its own entry — only the container label is
    // in question here.
    expect(out).toContain('TextView "子标签"');
  });

  test('preserves picker actions, range, state and selection semantics', () => {
    const picker: A11yNode = {
      ref: 'u-picker',
      text: '一次性投入',
      className: 'android.view.View',
      bounds: { left: 0, top: 700, right: 400, bottom: 1000 },
      isScrollable: true,
      isSelected: true,
      availableActions: ['scrollForward', 'scrollBackward'],
      actionLabels: [
        { id: 1, action: null, label: '选择下一项：一次性投入' },
      ],
      rangeInfo: { type: 'int', min: 0, max: 2, current: 1 },
      stateDescription: '一次性投入',
      roleDescription: '选取器',
    };

    const out = ScreenSerializer.serialize([picker]);
    expect(out).toContain('可滚动,已选择');
    expect(out).toContain('角色=选取器');
    expect(out).toContain('状态=一次性投入');
    expect(out).toContain('范围=1/0-2');
    expect(out).toContain('动作=选择下一项：一次性投入|scrollForward|scrollBackward');
  });

  test('keeps an otherwise anonymous node when accessibility actions make it interactive', () => {
    const out = ScreenSerializer.serialize([{
      ref: 'u-action-only',
      className: 'android.view.View',
      bounds: { left: 0, top: 0, right: 200, bottom: 100 },
      availableActions: ['scrollForward'],
    }]);
    expect(out).toContain('View "(无文本)"');
    expect(out).toContain('ref=u-action-only');
    expect(out).toContain('动作=scrollForward');
  });
});
