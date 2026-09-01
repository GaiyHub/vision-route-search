/**
 * Converts the accessibility tree into an LLM-friendly, numbered element list.
 *
 * Mirrors MobileAgent-Android's UiElementDetector output: only interactive or
 * labelled elements are kept, numbered `[n]`, with real screen-space center
 * coordinates so the model can target elements precisely.
 */

export interface A11yNode {
  ref?: string;
  resourceId?: string | null;
  className?: string;
  text?: string | null;
  contentDescription?: string | null;
  bounds?: { left: number; top: number; right: number; bottom: number };
  isClickable?: boolean;
  isScrollable?: boolean;
  isEditable?: boolean;
  isFocused?: boolean;
  isChecked?: boolean;
  isCheckable?: boolean;
  isSelected?: boolean;
  isEnabled?: boolean;
  availableActions?: string[];
  actionLabels?: Array<{ id?: number; action?: string | null; label?: string | null }>;
  rangeInfo?: { type?: string; min?: number; max?: number; current?: number } | null;
  collectionInfo?: {
    rowCount?: number;
    columnCount?: number;
    hierarchical?: boolean;
    selectionMode?: string;
  } | null;
  collectionItemInfo?: {
    rowIndex?: number;
    rowSpan?: number;
    columnIndex?: number;
    columnSpan?: number;
    heading?: boolean;
    selected?: boolean;
  } | null;
  hintText?: string | null;
  stateDescription?: string | null;
  roleDescription?: string | null;
  children?: A11yNode[];
}

export class ScreenSerializer {
  /**
   * Serialize an accessibility tree into a numbered element list.
   *
   * Produces output like:
   *   [1] Button "Settings" at center(200,300) bounds(100,200,300,400) clickable
   *   [2] EditText "Search..." at center(540,240) bounds(480,200,600,280) editable
   *
   * @param tree - Raw accessibility tree from react-native-accessibility-controller
   * @returns A text representation suitable for LLM consumption
   */
  static serialize(tree: unknown): string {
    const lines: string[] = [
      '=== 屏幕元素 ===',
      '目标语义、当前界面的短期 ref 和最新截图绑定的 coordinate 是相互独立的定位模式；具体派发与内部兜底边界以 ui_tap 工具描述为准。',
    ];
    // getAccessibilityTree() resolves an ARRAY of root nodes (one per window).
    const roots = (Array.isArray(tree) ? tree : [tree]) as A11yNode[];
    const elements = ScreenSerializer.collectElements(roots);
    for (let i = 0; i < elements.length; i++) {
      lines.push(ScreenSerializer.formatElement(i + 1, elements[i]));
    }
    return lines.join('\n');
  }

  /**
   * Create a compact summary of the screen for context windows.
   *
   * When the full tree would exceed maxLength, the summary trims leaf nodes
   * that have no interactive state, favouring clickable/editable elements.
   *
   * @param tree - Raw accessibility tree
   * @param maxLength - Maximum character length of the output (default: 3000)
   * @returns Truncated/summarised screen representation
   */
  static summarize(tree: unknown, maxLength: number = 3000): string {
    const full = ScreenSerializer.serialize(tree);
    if (full.length <= maxLength) return full;

    // Drop the header when overflowing; then hard-truncate.
    const lines = full.split('\n').filter((line) => /^\[\d+\]/.test(line));

    let result = lines.join('\n');
    if (result.length > maxLength) {
      result = result.slice(0, maxLength - 3) + '...';
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Number of interactive / labelled elements the serializer would surface
   * for the given tree (same filter as [collectElements]). Used by the loop
   * to detect near-empty trees (webview content hidden from accessibility)
   * and steer the model toward the vision channel instead of blind taps.
   */
  static countInteractive(nodes: unknown): number {
    const arr = (Array.isArray(nodes) ? nodes : [nodes]) as A11yNode[];
    return ScreenSerializer.collectElements(arr).length;
  }

  /**
   * Resolves a 1-based [N] index from the serialized list back to the element
   * it referred to (same filter as [serialize]). Used by the tap tool to turn
   * the model's numeric references into real elements instead of rejecting
   * them. Returns null when out of range or the tree is empty.
   */
  static elementAt(nodes: unknown, index: number): A11yNode | null {
    if (!Number.isInteger(index) || index < 1) return null;
    const arr = (Array.isArray(nodes) ? nodes : [nodes]) as A11yNode[];
    const elements = ScreenSerializer.collectElements(arr);
    return elements[index - 1] ?? null;
  }

  /**
   * Collect interactive / labelled elements, mirroring MobileAgent-Android:
   * keep nodes that are clickable, scrollable, editable, or have text /
   * content description, and have a real (non-degenerate) bounds rect.
   */
  private static collectElements(nodes: A11yNode[], out: A11yNode[] = []): A11yNode[] {
    for (const node of nodes) {
      ScreenSerializer.collectFromNode(node, out);
    }
    return out;
  }

  private static collectFromNode(node: A11yNode, out: A11yNode[]): void {
    if (!node || typeof node !== 'object') return;

    const text = node.text?.trim() || '';
    const desc = node.contentDescription?.trim() || '';
    const interactive =
      node.isClickable === true ||
      node.isScrollable === true ||
      node.isEditable === true ||
      node.isChecked === true ||
      node.isCheckable === true ||
      node.isSelected === true ||
      (node.availableActions?.length ?? 0) > 0 ||
      (node.actionLabels?.length ?? 0) > 0;

    if ((interactive || text || desc) && node.bounds) {
      const { left, top, right, bottom } = node.bounds;
      if (right - left > 10 && bottom - top > 10) {
        out.push(node);
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        ScreenSerializer.collectFromNode(child, out);
      }
    }
  }

  private static formatElement(index: number, node: A11yNode): string {
    const className = ScreenSerializer.shortClassName(node.className);
    const label = ScreenSerializer.labelFor(node) || '(无文本)';
    const { left, top, right, bottom } = node.bounds!;
    const cx = Math.round((left + right) / 2);
    const cy = Math.round((top + bottom) / 2);

    const flags: string[] = [];
    if (node.isClickable) flags.push('可点击');
    if (node.isEditable) flags.push('可编辑');
    if (node.isScrollable) flags.push('可滚动');
    if (node.isFocused) flags.push('已聚焦');
    if (node.isChecked) flags.push('已选中');
    if (node.isCheckable) flags.push('可勾选');
    if (node.isSelected) flags.push('已选择');
    if (node.isEnabled === false) flags.push('已禁用');

    const flagText = flags.length > 0 ? ` ${flags.join(',')}` : '';
    const hasSemanticAction =
      (node.availableActions?.length ?? 0) > 0 || (node.actionLabels?.length ?? 0) > 0;
    const refText = (flags.length > 0 || hasSemanticAction) && node.ref ? ` ref=${node.ref}` : '';
    const resourceText = node.resourceId ? ` resourceId=${node.resourceId}` : '';
    const semanticText = ScreenSerializer.semanticSummary(node);
    return `[${index}] ${className} "${label}" 中心(${cx},${cy}) 边界(${left},${top},${right},${bottom})${flagText}${refText}${resourceText}${semanticText}`;
  }

  /** Append only present, decision-relevant semantics to keep prompts compact. */
  private static semanticSummary(node: A11yNode): string {
    const parts: string[] = [];
    const role = node.roleDescription?.trim();
    if (role) parts.push(`角色=${role}`);
    const state = node.stateDescription?.trim();
    if (state) parts.push(`状态=${state}`);
    const hint = node.hintText?.trim();
    if (hint) parts.push(`提示=${hint}`);

    if (node.rangeInfo) {
      const { current, min, max } = node.rangeInfo;
      if ([current, min, max].every((value) => typeof value === 'number' && Number.isFinite(value))) {
        parts.push(`范围=${current}/${min}-${max}`);
      }
    }

    const customLabels = (node.actionLabels ?? [])
      .map((item) => item.label?.trim())
      .filter((label): label is string => Boolean(label));
    const standardActions = (node.availableActions ?? [])
      .filter((action) => !['click', 'longClick', 'setText', 'clearFocus'].includes(action));
    const actions = [...new Set([...customLabels, ...standardActions])];
    if (actions.length > 0) parts.push(`动作=${actions.join('|')}`);

    const collection = node.collectionInfo;
    if (collection && (collection.rowCount || collection.columnCount)) {
      parts.push(`集合=${collection.rowCount ?? 0}x${collection.columnCount ?? 0}`);
    }
    const item = node.collectionItemInfo;
    if (item && (typeof item.rowIndex === 'number' || typeof item.columnIndex === 'number')) {
      parts.push(`集合项=${item.rowIndex ?? 0},${item.columnIndex ?? 0}`);
    }
    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
  }

  /**
   * Label for a serialized element. For clickable containers that carry no
   * text of their own, merge several bounded descendant labels so a product
   * card exposes its title, amount and state on the actionable parent instead
   * of scattering them across later TextView rows. The cap keeps large nested
   * containers from consuming the whole observation budget.
   */
  private static labelFor(node: A11yNode): string {
    const text = node.text?.trim();
    if (text) return text;
    const desc = node.contentDescription?.trim();
    if (desc) return desc;
    if (node.isClickable === true) {
      return ScreenSerializer.descendantSummary(node, 4, 6, 160);
    }
    return '';
  }

  /**
   * Collect distinct descendant text/content descriptions within a bounded
   * depth and size. Tree order is preserved because it normally mirrors the
   * visual reading order of a card.
   */
  private static descendantSummary(
    node: A11yNode,
    maxDepth: number,
    maxLabels: number,
    maxLength: number,
  ): string {
    const labels: string[] = [];
    const seen = new Set<string>();
    let exhausted = false;

    const add = (value: string | null | undefined) => {
      const normalized = value?.trim().replace(/\s+/g, ' ');
      if (!normalized || seen.has(normalized) || labels.length >= maxLabels) return;
      const candidate = [...labels, normalized].join(' | ');
      if (candidate.length <= maxLength) {
        labels.push(normalized);
        seen.add(normalized);
        return;
      }
      const remaining = maxLength - labels.join(' | ').length - (labels.length > 0 ? 3 : 0);
      if (remaining > 1) labels.push(`${normalized.slice(0, remaining - 1)}…`);
      exhausted = true;
    };

    const visit = (current: A11yNode, depth: number) => {
      if (exhausted || depth > maxDepth || !Array.isArray(current.children)) return;
      for (const child of current.children) {
        add(child.text);
        if (child.contentDescription?.trim() !== child.text?.trim()) {
          add(child.contentDescription);
        }
        if (labels.length >= maxLabels || exhausted) return;
        visit(child, depth + 1);
        if (labels.length >= maxLabels || exhausted) return;
      }
    };

    visit(node, 0);
    return labels.join(' | ');
  }

  private static shortClassName(className?: string): string {
    if (!className) return '';
    // Strip package prefix: "android.widget.TextView" -> "TextView"
    const parts = className.split('.');
    return parts[parts.length - 1] ?? className;
  }
}
