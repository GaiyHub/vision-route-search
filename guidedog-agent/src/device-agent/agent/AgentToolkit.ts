import type { ScreenshotImage, Tool, ToolCall } from '../types';
import { PHONE_TOOLS } from '../tools/PhoneTools';
import { ToolRegistry } from '../tools/ToolRegistry';
import { toolFailure } from '../tools/ToolResult';
import { normalizeArgsBySchema } from '../tools/ToolSchema';
import {
  ToolRiskInterceptor,
  addToolRiskAssessment,
} from '../tools/ToolRiskInterceptor';
import { canonicalToolName } from '../tools/ToolCircuitBreakerPolicy';
import {
  applyToolConfiguration,
  FORCE_VISUAL_BLOCKED_TOOLS,
  FORCE_VISUAL_REQUIRED_TOOL,
  isToolEnabled,
  normalizeToolConfigurationOverrides,
  type ToolConfigurationOverrides,
} from '../tools/ToolConfiguration';
import { ScreenSerializer, type A11yNode } from './ScreenSerializer';
import { BROWSER_TOOL_NAMES, isBrowserToolName } from '../../browser/BrowserTypes';

type LiveNodeRefInfo = {
  found: boolean;
  ref?: string;
  text?: string | null;
  contentDescription?: string | null;
  resourceId?: string | null;
  className?: string | null;
  bounds?: { left: number; top: number; right: number; bottom: number };
  center?: { x: number; y: number };
  isClickable?: boolean;
  isScrollable?: boolean;
  isEditable?: boolean;
  isFocused?: boolean;
  isCheckable?: boolean;
  isChecked?: boolean;
  isEnabled?: boolean;
};

// react-native-accessibility-controller is a peer dep; import lazily so the
// package can compile in environments where the native module is absent.
let AccessibilityController: {
  getAccessibilityTree: () => Promise<unknown>;
  getAccessibilitySnapshot?: () => Promise<{
    nodes: unknown[];
    truncated: boolean;
    reason: string | null;
    visitedNodes: number;
    returnedNodes: number;
    durationMs: number;
  }>;
  getRawAccessibilitySnapshot?: () => Promise<{
    nodes: unknown[];
    truncated: boolean;
    reason: string | null;
    visitedNodes: number;
    returnedNodes: number;
    durationMs: number;
  }>;
  findAccessibilityNodes?: (query: NodeQuery, maxResults: number) => Promise<{
    nodes: unknown[];
    truncated: boolean;
    reason: string | null;
    visitedNodes: number;
    returnedNodes: number;
    durationMs: number;
  }>;
  cancelAccessibilityCapture?: () => Promise<boolean>;
  getNodeInfoByRef?: (ref: string) => Promise<LiveNodeRefInfo>;
  performAction: (ref: string, action: string) => Promise<boolean>;
  tapNode: (ref: string) => Promise<boolean>;
  tapNodeAt: (ref: string, x: number, y: number) => Promise<boolean>;
  tapByQuery?: (
    text: string,
    contentDescription: string,
    resourceId: string,
    matchIndex: number,
  ) => Promise<{
    found: boolean;
    accepted: boolean;
    method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
    matchCount: number;
    selectedIndex: number;
    text: string | null;
    contentDescription: string | null;
    resourceId: string | null;
    bounds: { left: number; top: number; right: number; bottom: number } | null;
    center?: { x: number; y: number };
    reason: string | null;
  }>;
  tapByQueryGesture?: (
    text: string,
    contentDescription: string,
    resourceId: string,
    matchIndex: number,
  ) => ReturnType<
    NonNullable<NonNullable<typeof AccessibilityController>['tapByQuery']>
  >;
  tapByRef?: (ref: string) => Promise<{
    found: boolean;
    accepted: boolean;
    method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
    text: string | null;
    contentDescription: string | null;
    resourceId: string | null;
    bounds: { left: number; top: number; right: number; bottom: number } | null;
    center?: { x: number; y: number };
    reason: string | null;
  }>;
  tapByRefNode?: (ref: string) => Promise<{
    found: boolean;
    accepted: boolean;
    method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
    text: string | null;
    contentDescription: string | null;
    resourceId: string | null;
    bounds: { left: number; top: number; right: number; bottom: number } | null;
    center?: { x: number; y: number };
    reason: string | null;
  }>;
  tapByRefGesture?: (ref: string) => Promise<{
    found: boolean;
    accepted: boolean;
    method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
    text: string | null;
    contentDescription: string | null;
    resourceId: string | null;
    bounds: { left: number; top: number; right: number; bottom: number } | null;
    center?: { x: number; y: number };
    reason: string | null;
  }>;
  tap: (x: number, y: number) => Promise<boolean>;
  longPressNode: (ref: string) => Promise<boolean>;
  longPress: (x: number, y: number, durationMs?: number) => Promise<boolean>;
  setNodeText: (ref: string, text: string) => Promise<boolean>;
  swipe: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs?: number,
  ) => Promise<boolean>;
  scrollNode: (ref: string, direction: string) => Promise<boolean>;
  openApp: (packageName: string) => Promise<boolean>;
  getInstalledApps: () => Promise<Array<{ packageName: string; label: string }>>;
  getScreenText: () => Promise<string>;
  globalAction: (action: string) => Promise<boolean>;
  takeScreenshot: () => Promise<ScreenshotImage>;
  captureWithMediaProjection: () => Promise<ScreenshotImage>;
  isMediaProjectionReady: () => Promise<boolean>;
  probeProjectionReady?: () => Promise<boolean>;
  compareScreenshotFiles?: (beforePath: string, afterPath: string) => Promise<{
    changed: boolean;
    changedPixelRatio: number;
    changedTileRatio: number;
    meanDelta: number;
  }>;
  annotateScreenshot?: (
    screenshotPath: string,
    markers: Array<{
      ref: string;
      bounds: { left: number; top: number; right: number; bottom: number };
      kind?: 'accessibility' | 'ocr';
    }>,
    displayWidth: number,
    displayHeight: number,
  ) => Promise<ScreenshotImage>;
  resizeScreenshotForModel?: (
    screenshotPath: string,
    maxEdge: number,
    jpegQuality: number,
  ) => Promise<ScreenshotImage>;
  recognizeScreenshotText?: (screenshotPath: string) => Promise<{
    elements: Array<{
      text: string;
      bounds: { left: number; top: number; right: number; bottom: number };
    }>;
    imageWidth: number;
    imageHeight: number;
  }>;
  requestMediaProjection?: () => Promise<boolean>;
  getCurrentForegroundApp?: () => Promise<{ packageName?: string; className?: string }>;
  getLastForegroundApp?: () => Promise<{ packageName?: string; className?: string }>;
  bringHostAppToForeground?: () => Promise<boolean>;
  returnToPreviousApp?: (packageName: string) => Promise<boolean>;
  suspendOverlayForAutomation?: () => Promise<boolean>;
  resumeOverlayAfterAutomation?: () => Promise<void>;
} | null = null;

export function getController() {
  if (!AccessibilityController) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      AccessibilityController = require('react-native-accessibility-controller');
    } catch {
      throw new Error(
        'react-native-accessibility-controller is not available. ' +
          'Ensure the native module is linked and running on a real device.',
      );
    }
  }
  return AccessibilityController!;
}

/**
 * Capture an observation while the agent overlay is absent from both the
 * visible screen and Android's accessibility-window snapshot. Restoration is
 * always attempted, including timeouts and native capture failures.
 */
const SCREENSHOT_OVERLAY_SETTLE_MS = 48;
const OVERLAY_AUTOMATION_TRANSITION_TIMEOUT_MS = 750;

// UI tools may call observation helpers that also request overlay isolation.
// Keep one native suspend/resume lease for the whole nested operation instead
// of posting duplicate WindowManager work to the backgrounded host app.
let overlayAutomationDepth = 0;

/**
 * Phone tools that must never observe or interact through Doubao's own
 * floating overlay. The ui_* convention also covers host-injected atomic UI
 * tools without requiring another per-tool allowlist.
 */
export function suspendsOverlayDuringToolExecution(name: string): boolean {
  const canonical = canonicalToolName(name);
  return canonical.startsWith('ui_') || canonical === 'open_app' || canonical === 'wait';
}

export async function withOverlaySuspendedForObservation<T>(
  read: (ctrl: ReturnType<typeof getController> | null) => Promise<T>,
  settleAfterSuspendMs = 0,
  delay: (ms: number) => Promise<void> =
    (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let ctrl: ReturnType<typeof getController> | null = null;
  try {
    ctrl = getController();
  } catch {
    // Tests and injected observation adapters may provide screenshot capture
    // without linking the native controller. The observation should still run.
  }
  const ownsNativeLease = overlayAutomationDepth === 0;
  overlayAutomationDepth += 1;
  let suspended = false;
  try {
    if (ownsNativeLease && typeof ctrl?.suspendOverlayForAutomation === 'function') {
      const suspendPromise = ctrl.suspendOverlayForAutomation();
      const suspendOutcome = await Promise.race([
        suspendPromise.then(
          (value) => ({ timedOut: false as const, value }),
          () => ({ timedOut: false as const, value: false }),
        ),
        // Defer starting the timeout by one microtask so an already-settled
        // native promise wins deterministically (also keeps zero-delay test
        // adapters representative of the real timer-backed implementation).
        Promise.resolve()
          .then(() => delay(OVERLAY_AUTOMATION_TRANSITION_TIMEOUT_MS))
          .then(() => ({ timedOut: true as const, value: false })),
      ]);
      suspended = suspendOutcome.value;
      if (suspendOutcome.timedOut) {
        // The native call is already queued and cannot be cancelled. Queue a
        // matching resume behind it so a late suspend cannot leave the overlay
        // invisible, then fail open: overlay isolation must not block the tool.
        void ctrl.resumeOverlayAfterAutomation?.().catch(() => {});
        // eslint-disable-next-line no-console
        console.warn('[OVERLAY] suspend timed out; continuing UI tool');
      }
    }
    // WindowManager updates are asynchronous relative to SurfaceFlinger. A
    // short compositor grace period prevents MediaProjection from returning
    // the last cached frame that still contains the floating overlay.
    if (suspended && settleAfterSuspendMs > 0) {
      await delay(settleAfterSuspendMs);
    }
    return await read(ctrl);
  } finally {
    overlayAutomationDepth = Math.max(0, overlayAutomationDepth - 1);
    if (ownsNativeLease && suspended && typeof ctrl?.resumeOverlayAfterAutomation === 'function') {
      const resumeOutcome = await Promise.race([
        ctrl.resumeOverlayAfterAutomation()
          .then(() => 'completed' as const)
          .catch(() => 'failed' as const),
        Promise.resolve()
          .then(() => delay(OVERLAY_AUTOMATION_TRANSITION_TIMEOUT_MS))
          .then(() => 'timeout' as const),
      ]);
      if (resumeOutcome === 'timeout') {
        // eslint-disable-next-line no-console
        console.warn('[OVERLAY] resume timed out; UI tool already completed');
      }
    }
  }
}

export function readAccessibilityTreeWithoutOverlay(): Promise<unknown> {
  return withOverlaySuspendedForObservation((ctrl) => {
    if (!ctrl) return Promise.reject(new Error('Accessibility controller is unavailable'));
    return ctrl.getAccessibilityTree();
  });
}

export function readAccessibilitySnapshotWithoutOverlay(): Promise<{
  nodes: unknown[];
  truncated: boolean;
  reason: string | null;
  visitedNodes: number;
  returnedNodes: number;
  durationMs: number;
}> {
  return withOverlaySuspendedForObservation((ctrl) => {
    if (!ctrl?.getAccessibilitySnapshot) {
      return Promise.reject(new Error('Accessibility snapshot is unavailable'));
    }
    return ctrl.getAccessibilitySnapshot();
  });
}

function readRawAccessibilitySnapshotWithoutOverlay(): Promise<{
  nodes: unknown[];
  truncated: boolean;
  reason: string | null;
  visitedNodes: number;
  returnedNodes: number;
  durationMs: number;
}> {
  return withOverlaySuspendedForObservation((ctrl) => {
    if (!ctrl?.getRawAccessibilitySnapshot) {
      return Promise.reject(new Error('Raw accessibility snapshot is unavailable'));
    }
    return ctrl.getRawAccessibilitySnapshot();
  });
}

function findAccessibilityNodesWithoutOverlay(
  query: NodeQuery,
  maxResults: number,
): Promise<{ nodes: unknown[]; truncated: boolean; reason: string | null }> {
  return withOverlaySuspendedForObservation((ctrl) => {
    if (!ctrl?.findAccessibilityNodes) {
      return Promise.reject(new Error('Direct accessibility search is unavailable'));
    }
    return ctrl.findAccessibilityNodes(query, maxResults);
  });
}

/** Tools whose execution is expected to change the screen (transitions etc.). */
export const SCREEN_CHANGING_TOOLS = new Set([
  'ui_tap',
  'ui_fill',
  'ui_long_press',
  'ui_clear_text',
  'ui_press_enter',
  'ui_swipe',
  'ui_scroll',
  'ui_scroll_page',
  'ui_set_checked',
  'open_app',
  'ui_global_action',
]);

const SET_CHECKED_VERIFY_ATTEMPTS = 4;
const SET_CHECKED_VERIFY_POLL_MS = 150;

export type ToolUiEffect = 'none' | 'change' | 'wait' | 'user_gate';

interface AppLaunchState {
  requestedPackage: string;
  foregroundPackage: string;
  activity: string;
  launchAccepted: boolean;
  launchConfirmed: boolean;
  confirmationAvailable: boolean;
  alreadyForeground: boolean;
  elapsedMs: number;
}

const OPEN_APP_CONFIRM_ATTEMPTS = 16;
const OPEN_APP_CONFIRM_TIMEOUT_MS = 4000;
const OPEN_APP_CONFIRM_POLL_MS = 250;
const FOREGROUND_QUERY_TIMEOUT_MS = 500;
const TAP_VERIFY_ATTEMPTS = 5;
const TAP_VERIFY_POLL_MS = 200;
const TAP_VISUAL_CAPTURE_TIMEOUT_MS = 1200;
const TAP_VISUAL_COMPARE_TIMEOUT_MS = 800;
const SCREENSHOT_TREE_WAIT_MS = 1_500;

const SCROLL_DISTANCE_RATIOS = {
  short: 0.3,
  medium: 0.55,
  long: 0.8,
} as const;
type ScrollDistance = keyof typeof SCROLL_DISTANCE_RATIOS;

const WAIT_TOOLS = new Set(['wait', 'ui_wait_for_node', 'ui_wait_for_change']);
const USER_GATE_TOOLS = new Set(['confirm_action', 'ask_user', 'request_user_action']);
const BROWSER_MANAGE_CHANGING_OPERATIONS = new Set([
  'execute_js', 'hover', 'new_tab', 'close_tab', 'set_user_agent', 'set_viewport', 'set_cookies',
]);

/**
 * Resolve the UI effect of one concrete invocation. Most tools are read-only
 * by default; browser management calls are classified by operation.
 * This deliberately lives beside tool execution rather than in the system
 * prompt: observation scheduling is a runtime concern, not model policy.
 */
export function resolveToolUiEffect(call: ToolCall, result?: unknown): ToolUiEffect {
  const name = canonicalToolName(call.name);
  // Waiting advances time, so every observation captured before it is stale
  // regardless of whether the screen eventually changed or the wait timed out.
  if (WAIT_TOOLS.has(name)) return 'wait';
  if (result !== undefined && actionFailedOrNoOp(result)) return 'none';
  if (USER_GATE_TOOLS.has(name)) return 'user_gate';
  if (name === BROWSER_TOOL_NAMES.wait) return 'wait';
  if (
    name === BROWSER_TOOL_NAMES.navigate ||
    name === BROWSER_TOOL_NAMES.click ||
    name === BROWSER_TOOL_NAMES.type ||
    name === BROWSER_TOOL_NAMES.scroll
  ) return 'change';
  if (name === BROWSER_TOOL_NAMES.manage) {
    const operation = call.arguments.operation;
    return typeof operation === 'string' && BROWSER_MANAGE_CHANGING_OPERATIONS.has(operation)
      ? 'change'
      : 'none';
  }
  if (isBrowserToolName(name)) return 'none';
  if (SCREEN_CHANGING_TOOLS.has(name)) return 'change';
  if (PHONE_TOOLS.some((tool) => canonicalToolName(tool.name) === name)) return 'none';
  // Unconfigured extensions are handled conservatively: correctness wins
  // over preserving a potentially stale observation.
  return 'change';
}

/**
 * True when a tool result means the screen could not have changed: explicit
 * failure, a rejected action, an error, or a timed-out call. Used to skip the
 * post-action transition poll entirely.
 */
export function actionFailedOrNoOp(result: unknown): boolean {
  if (result === false || result instanceof Error) return true;
  if (result && typeof result === 'object') {
    const r = result as {
      ok?: unknown;
      error?: unknown;
      changed?: unknown;
      launchAccepted?: unknown;
      data?: { launchAccepted?: unknown; changed?: unknown };
      details?: { launchAccepted?: unknown; alreadyForeground?: unknown };
    };
    const alreadyForeground = (
      (r as { alreadyForeground?: unknown }).alreadyForeground === true ||
      (r.data as { alreadyForeground?: unknown } | undefined)?.alreadyForeground === true ||
      r.details?.alreadyForeground === true
    );
    if (alreadyForeground) return true;
    if (r.changed === false || r.data?.changed === false) return true;
    if (
      r.launchAccepted === true ||
      r.data?.launchAccepted === true ||
      r.details?.launchAccepted === true
    ) return false;
    return r.ok === false || r.error !== undefined;
  }
  return false;
}

/**
 * Loop-owned capabilities the tool handlers need at execution time. They are
 * injected as callbacks so this class keeps no dependency on AgentLoop itself.
 */
export interface AgentToolkitDeps {
  /** Freeze-safe delay used by wait/scroll/retry tools. */
  delay: (ms: number) => Promise<void>;
  /** Note store backing write_note / read_note (owned by the loop). */
  notes: Map<string, string>;
  /** Explicit UI inspection owned by the phone-observation adapter. */
  inspectUi?: () => Promise<string>;
  cancelInspectUi?: () => Promise<boolean>;
  /** Explicit screenshot capture owned by the phone-observation adapter. */
  captureScreenshot?: () => Promise<ScreenshotImage | undefined>;
  /** Privacy-safe visual preprocessing timings owned by AgentLoop. */
  onTimingDiagnostic?: (event: Record<string, unknown>) => void;
}

export interface AgentToolkitOptions {
  /** Restrict which phone tools are exposed to the LLM (see AgentOptions). */
  toolFilter?: string[];
  /** Host-injected tools always available regardless of toolFilter. */
  extraTools?: Array<{
    tool: Tool;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
    enabledByDefault?: boolean;
    /** Controls where the tool appears in the model-visible tool catalog. */
    placement?: 'front' | 'back';
  }>;
  /** Per-tool availability and description overrides frozen by AgentLoop creation. */
  toolConfigurationOverrides?: ToolConfigurationOverrides;
  /** Make screenshot the only model-visible Android UI observation entry point. */
  forceVisualMode?: boolean;
  /** Draw actionable accessibility refs on screenshot copies sent to the model. */
  screenshotNodeMarkersEnabled?: boolean;
  /** Downscale the model-only screenshot copy. Default: true. */
  screenshotDownscalingEnabled?: boolean;
  /** Allow ui_screenshot to run bundled OCR and expose OCR-derived refs. */
  ocrEnhancementEnabled?: boolean;
  /** Emergency rollback: bypass node actions and tap the live center directly. */
  nodeTargetGestureTapEnabled?: boolean;
  /** Host-owned blocking confirmation surface for high-risk calls. */
  toolRiskGate?: import('../types').AgentOptions['toolRiskGate'];
}

const FORCE_VISUAL_SCREENSHOT_DESCRIPTION =
  '获取当前手机截图，同时返回采集时的 Android 无障碍结构，用于理解用户实际看到的完整页面。当前为强制视觉模式：需要观察界面、验证操作结果或判断任务状态时统一调用本工具。普通问答、已有新鲜截图或不依赖手机界面时不要调用。';

const SCREENSHOT_MARKER_DESCRIPTION =
  '截图会标记可操作节点。ref 只标识目标，不代表点击一定产生页面效果。使用没有 ref 的视觉坐标执行操作时，须携带该截图的 observationId；界面变化后应重新观察。';

const SCREENSHOT_OCR_MARKER_DESCRIPTION =
  'OCR 增强开启时也会标记 OCR 文字 ref。';

const SCREENSHOT_OCR_CAPABILITY_SENTENCE =
  '全局 OCR 增强开启时会自动补充截图中文字及其视觉坐标。';

/** Hide OCR from the model-facing screenshot contract when the user disables it. */
function withoutScreenshotOcrCapability(tool: Tool): Tool {
  const outputProperties = tool.outputSchema?.properties;
  const cleanedOutputProperties = outputProperties
    ? Object.fromEntries(
        Object.entries(outputProperties).filter(([name]) =>
          name !== 'ocr_elements' && name !== 'ocr_status'),
      )
    : undefined;
  return {
    ...tool,
    description: tool.description
      .replace(SCREENSHOT_OCR_CAPABILITY_SENTENCE, '')
      .replace(
        '无障碍节点和 OCR 文字都使用短期 ref，可直接交给 ui_tap 的 ref 模式；工具内部处理不同来源。',
        '无障碍节点使用短期 ref，可直接交给 ui_tap 的 ref 模式。',
      ),
    ...(tool.outputSchema
      ? {
          outputSchema: {
            ...tool.outputSchema,
            ...(cleanedOutputProperties ? { properties: cleanedOutputProperties } : {}),
          },
        }
      : {}),
  };
}

/**
 * Owns everything tool-related for the agent loop: the tool list exposed to
 * the LLM, registration (default phone tools plus host-injected extras), and
 * execution through a [ToolRegistry].
 *
 * Split out of AgentLoop so the loop itself stays focused on the
 * decide -> tool -> result cycle, while all device-action knowledge
 * (handlers, tree queries, screen-changing classification) lives here.
 */
export class AgentToolkit {
  private readonly deps: AgentToolkitDeps;
  private readonly registry = new ToolRegistry();
  private readonly enabledToolNames = new Set<string>();
  private readonly toolConfigurationOverrides: ToolConfigurationOverrides;
  private readonly configuredUiEffects = new Map<string, ToolUiEffect>();
  private readonly adaptiveUiEffectTools = new Set<string>();
  private readonly forceVisualMode: boolean;
  private readonly screenshotNodeMarkersEnabled: boolean;
  private readonly screenshotDownscalingEnabled: boolean;
  private readonly ocrEnhancementEnabled: boolean;
  private readonly nodeTargetGestureTapEnabled: boolean;
  private readonly riskInterceptor: ToolRiskInterceptor;
  private readonly observedRefTargets = new Map<string, CachedObservedRefTarget>();
  private readonly activeUiObservations = new Map<string, {
    kind: 'tree' | 'shot';
    width?: number;
    height?: number;
  }>();
  private treeObservationSequence = 0;
  private visualObservationSequence = 0;
  /** Note store backing write_note / read_note (owned by the loop, shared here). */
  readonly notes: Map<string, string>;
  /** Tool definitions exposed to the LLM (filtered by toolFilter). */
  readonly tools: Tool[];

  constructor(deps: AgentToolkitDeps, options: AgentToolkitOptions = {}) {
    this.deps = deps;
    this.notes = deps.notes;
    this.forceVisualMode = options.forceVisualMode === true;
    this.screenshotNodeMarkersEnabled = options.screenshotNodeMarkersEnabled === true;
    this.screenshotDownscalingEnabled = options.screenshotDownscalingEnabled !== false;
    this.ocrEnhancementEnabled = options.ocrEnhancementEnabled !== false;
    this.nodeTargetGestureTapEnabled = options.nodeTargetGestureTapEnabled !== false;
    this.riskInterceptor = new ToolRiskInterceptor({
      gate: options.toolRiskGate,
      describeTarget: (call) => this.describeRiskTarget(call),
    });
    const { toolFilter, extraTools } = options;
    this.toolConfigurationOverrides = normalizeToolConfigurationOverrides(
      options.toolConfigurationOverrides,
    );
    for (const [name, override] of Object.entries(this.toolConfigurationOverrides)) {
      if (override.uiEffect === 'adaptive') this.adaptiveUiEffectTools.add(name);
      else if (override.uiEffect === 'change' || override.uiEffect === 'none') {
        this.configuredUiEffects.set(name, override.uiEffect);
      }
    }
    const allowed = toolFilter
      ? new Set([...toolFilter, 'task_complete', 'task_failed'])
      : null;
    this.tools = PHONE_TOOLS
      .filter((tool) => {
        if (this.forceVisualMode && FORCE_VISUAL_BLOCKED_TOOLS.has(tool.name)) {
          return false;
        }
        const enabled = this.forceVisualMode && tool.name === FORCE_VISUAL_REQUIRED_TOOL
          ? true
          : isToolEnabled(
            tool.name,
            allowed === null || allowed.has(tool.name),
            this.toolConfigurationOverrides,
          );
        if (enabled) this.enabledToolNames.add(canonicalToolName(tool.name));
        return enabled;
      })
      .map((tool) => {
        const configured = applyToolConfiguration(tool, this.toolConfigurationOverrides);
        let modeAdjusted = this.forceVisualMode && tool.name === FORCE_VISUAL_REQUIRED_TOOL
          ? { ...configured, description: FORCE_VISUAL_SCREENSHOT_DESCRIPTION }
          : configured;
        if (!this.ocrEnhancementEnabled && tool.name === 'ui_screenshot') {
          modeAdjusted = withoutScreenshotOcrCapability(modeAdjusted);
        }
        if (this.screenshotNodeMarkersEnabled && tool.name === 'ui_screenshot') {
          modeAdjusted = {
            ...modeAdjusted,
            description: `${modeAdjusted.description} ${SCREENSHOT_MARKER_DESCRIPTION}${
              this.ocrEnhancementEnabled ? ` ${SCREENSHOT_OCR_MARKER_DESCRIPTION}` : ''
            }`,
          };
        }
        return addToolRiskAssessment(modeAdjusted);
      });
    this.registerDefaultTools();
    // Host-injected tools (e.g. todo_update) are always available, regardless
    // of toolFilter — they are bookkeeping tools, not device actions.
    if (extraTools) {
      for (const { tool, handler, enabledByDefault, placement } of extraTools) {
        this.registerTool(tool, handler, enabledByDefault ?? true, placement ?? 'back');
      }
    }
  }

  /**
   * Register a custom tool and its execution handler.
   *
   * The tool will be included in every subsequent `generateWithTools` call so
   * the LLM knows it is available. Call this before the loop starts — tools
   * registered after a run has started won't be seen by the current iteration.
   */
  registerTool(
    tool: Tool,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
    enabledByDefault = true,
    placement: 'front' | 'back' = 'back',
  ): void {
    const canonical = canonicalToolName(tool.name);
    if (tool.uiEffect && !this.toolConfigurationOverrides[canonical]?.uiEffect) {
      this.configuredUiEffects.set(canonical, tool.uiEffect);
    }
    const modelTool = addToolRiskAssessment(tool);
    this.registry.register(tool, handler);
    const enabled = isToolEnabled(
      tool.name,
      enabledByDefault,
      this.toolConfigurationOverrides,
    );
    if (enabled) {
      this.enabledToolNames.add(canonical);
      const configured = applyToolConfiguration(modelTool, this.toolConfigurationOverrides);
      const existingIndex = this.tools.findIndex((candidate) => candidate.name === tool.name);
      if (existingIndex >= 0) this.tools[existingIndex] = configured;
      else if (placement === 'front') this.tools.unshift(configured);
      else this.tools.push(configured);
    } else {
      this.enabledToolNames.delete(canonical);
    }
  }

  /** Resolve configured/intrinsic UI effect. Unconfigured custom tools are
   * treated conservatively as screen-changing by the runtime. */
  resolveUiEffect(call: ToolCall, result?: unknown): ToolUiEffect {
    const canonical = canonicalToolName(call.name);
    // Wait semantics are runtime-owned and always invalidate stale state.
    if (WAIT_TOOLS.has(canonical)) return 'wait';
    if (result !== undefined && actionFailedOrNoOp(result)) return 'none';
    if (this.adaptiveUiEffectTools.has(canonical)) {
      return 'change';
    }
    return this.configuredUiEffects.get(canonical)
      ?? resolveToolUiEffect(call, result);
  }

  /** Execute a tool call through the registered handler. */
  async execute(call: ToolCall): Promise<unknown> {
    const canonicalCallName = canonicalToolName(call.name);
    if (
      (canonicalCallName === 'ui_tap' || canonicalCallName === 'ui_long_press') &&
      call.arguments.coordinateSpace !== undefined
    ) {
      return toolFailure('坐标空间不再由调用方选择；coordinate 固定使用最新截图的 0～1000 归一化坐标', 'INVALID_ARGUMENT', {
        retryable: true,
        hint: '移除 coordinateSpace；无障碍树目标请使用 ref、text、content_description 或 resource_id。',
      });
    }
    if (
      this.registry.has(call.name) &&
      !this.enabledToolNames.has(canonicalCallName)
    ) {
      return toolFailure('工具已在设置中禁用', 'TOOL_DISABLED', {
        retryable: false,
        hint: `工具 ${canonicalToolName(call.name)} 已在设置中禁用，请改用当前可用工具。`,
      });
    }
    const modelTool = this.tools.find(
      (tool) => canonicalToolName(tool.name) === canonicalCallName,
    );
    const normalizedCall = modelTool
      ? { ...call, arguments: normalizeArgsBySchema(call.arguments, modelTool.parameters) }
      : call;
    // Validate the actual handler arguments before opening a user-facing
    // risk gate. Model-only metadata is deliberately absent from the runtime
    // schema and is validated by the interceptor itself.
    if (this.riskInterceptor.requiresConfirmation(normalizedCall)) {
      const { _risk: _ignoredRisk, _changesScreen: _ignoredEffect, ...runtimeArguments } =
        normalizedCall.arguments;
      const preflightFailure = this.registry.validate({
        ...normalizedCall,
        arguments: runtimeArguments,
      });
      if (preflightFailure) return preflightFailure;
    }
    const interception = await this.riskInterceptor.intercept(normalizedCall);
    if (!interception.ok) return interception.failure;
    const executableCall = interception.call;
    const dispatch = async (): Promise<unknown> => {
      if ('_changesScreen' in executableCall.arguments) {
        const { _changesScreen: _ignored, ...argumentsWithoutUiMetadata } = executableCall.arguments;
        return this.registry.execute({
          ...executableCall,
          arguments: argumentsWithoutUiMetadata,
        });
      }
      return this.registry.execute(executableCall);
    };
    const result = suspendsOverlayDuringToolExecution(canonicalCallName)
      ? await withOverlaySuspendedForObservation(
        dispatch,
        canonicalCallName === 'ui_screenshot' ? SCREENSHOT_OVERLAY_SETTLE_MS : 0,
        this.deps.delay,
      )
      : await dispatch();
    const uiEffect = this.resolveUiEffect(executableCall, result);
    if (uiEffect === 'change' || uiEffect === 'wait') {
      this.invalidateUiObservations();
    }
    return result;
  }

  /** True when this concrete call will block on the host risk gate. */
  requiresRiskConfirmation(call: ToolCall): boolean {
    return this.riskInterceptor.requiresConfirmation(call);
  }

  private describeRiskTarget(call: ToolCall): string {
    const args = call.arguments;
    const semantic = [
      args.text,
      args.targetText,
      args.contentDescription,
      args.resourceId,
      args.command,
      args.operation,
    ].filter((value): value is string => typeof value === 'string');
    if (typeof args.ref === 'string') {
      const target = this.observedRefTargets.get(args.ref);
      if (target?.label) semantic.push(target.label);
      if (target?.resourceId) semantic.push(target.resourceId);
    }
    return semantic.join(' ');
  }

  /** Check whether a tool is registered. */
  has(name: string): boolean {
    return this.enabledToolNames.has(canonicalToolName(name)) && this.registry.has(name);
  }

  /**
   * Replace an observation-scoped ref with stable target geometry for loop
   * detection only. The executable call remains untouched, so these private
   * fields can never leak into native tool arguments.
   */
  enrichToolCallForCircuitBreaker(call: ToolCall): ToolCall {
    if (canonicalToolName(call.name) !== 'ui_tap') return call;
    if (typeof call.arguments.ref !== 'string') return call;
    const target = this.observedRefTargets.get(call.arguments.ref);
    if (!target) return call;
    return {
      ...call,
      arguments: {
        ...call.arguments,
        _resolvedBounds: target.bounds,
        ...(target.resourceId ? { _resolvedResourceId: target.resourceId } : {}),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Default tool handlers (wired to react-native-accessibility-controller)
  // ---------------------------------------------------------------------------

  private registerDefaultTools(): void {
    const phoneTool = (name: string) =>
      PHONE_TOOLS.find((t) => t.name === name)!;
    // The registry accepts fields emitted by older prompt versions. `dispatch`
    // remains runtime-only so stored calls can be replayed without exposing an
    // implementation switch in the current model-facing contract.
    const runtimeTapTool = {
      ...phoneTool('ui_tap'),
      parameters: {
        ...phoneTool('ui_tap').parameters,
        required: undefined,
        properties: {
          ...phoneTool('ui_tap').parameters.properties,
          mode: {
            type: 'string' as const,
            description: '点击目标模式（兼容旧版 semantic）',
            enum: ['semantic', 'ref', 'text', 'content_description', 'resource_id', 'coordinate'],
          },
          dispatch: {
            type: 'string' as const,
            description: '旧版兼容字段',
            enum: ['node', 'gesture'],
          },
        },
      },
    };

    const resolveScreenshotCoordinate = (
      x: number,
      y: number,
      observationId: string,
    ) => {
      const observation = this.activeUiObservations.get(observationId);
      if (!observation) {
        return {
          error: toolFailure('坐标所属的 UI 观察已失效', 'STALE_UI_OBSERVATION', {
            retryable: true,
          }),
        };
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return {
          error: toolFailure('坐标必须是有限数值', 'INVALID_ARGUMENT', { retryable: true }),
        };
      }
      if (observation.kind !== 'shot' || observation.width === undefined || observation.height === undefined) {
        return {
          error: toolFailure('coordinate 模式只能使用 ui_screenshot 返回的视觉观察', 'COORDINATE_SPACE_UNAVAILABLE', {
            retryable: true,
            hint: '请使用最新 ui_screenshot 的 observationId；无障碍节点请改用 ref 或语义模式。',
          }),
        };
      }
      if (x < 0 || x > 1000 || y < 0 || y > 1000) {
        return {
          error: toolFailure('截图归一化坐标必须在 0～1000 范围内', 'COORDINATE_OUT_OF_RANGE', {
            retryable: true,
            details: { x, y, observationId },
          }),
        };
      }
      return {
        coordinateSpace: 'normalized_1000' as const,
        physicalX: Math.round((x / 1000) * Math.max(0, observation.width - 1)),
        physicalY: Math.round((y / 1000) * Math.max(0, observation.height - 1)),
      };
    };

    this.registry.register(phoneTool('ui_inspect'), async () => {
      if (!this.deps.inspectUi) {
        return toolFailure('UI 结构读取能力当前不可用', 'TOOL_UNAVAILABLE', {
          retryable: false,
        });
      }
      const tree = await this.deps.inspectUi();
      this.rememberObservedRefs(tree);
      const observationId = this.rememberUiObservation('tree');
      return `observationId=${observationId}\n${tree}`;
    });

    this.registry.register(phoneTool('ui_screenshot'), async (args) => {
      if (!this.deps.captureScreenshot) {
        return toolFailure('屏幕截图能力当前不可用', 'TOOL_UNAVAILABLE', {
          retryable: false,
        });
      }
      return withOverlaySuspendedForObservation(async () => {
        // Capture both channels concurrently while the overlay remains hidden,
        // so the image and structure describe approximately the same clean UI
        // state without adding a second observation round trip. A tree failure
        // is non-fatal: screenshot remains useful for visual-only surfaces.
        const captureStartedAt = Date.now();
        const imageResultPromise = this.deps.captureScreenshot!()
          .then((value) => {
            this.emitTimingDiagnostic({
              stage: 'vision_screenshot_capture',
              durationMs: Date.now() - captureStartedAt,
              status: value ? 'ok' : 'unavailable',
              ...(value?.width ? { sourceWidth: value.width } : {}),
              ...(value?.height ? { sourceHeight: value.height } : {}),
              ...(value?.base64 ? { sourceBase64Chars: value.base64.length } : {}),
            });
            return { status: 'fulfilled' as const, value };
          })
          .catch((reason: unknown) => {
            this.emitTimingDiagnostic({
              stage: 'vision_screenshot_capture',
              durationMs: Date.now() - captureStartedAt,
              status: 'error',
            });
            return { status: 'rejected' as const, reason };
          });
        const treeStartedAt = Date.now();
        const treeResultPromise = (this.deps.inspectUi?.() ??
          Promise.resolve('=== 屏幕元素 === (不可用)'))
          .then((value) => ({ status: 'fulfilled' as const, value }))
          .catch((reason: unknown) => ({ status: 'rejected' as const, reason }));
        const [imageResult, treeResult] = await Promise.all([
          imageResultPromise,
          Promise.race([
            treeResultPromise,
            Promise.resolve()
              .then(() => this.deps.delay(SCREENSHOT_TREE_WAIT_MS))
              .then(() => ({ status: 'timeout' as const })),
          ]),
        ]);
        if (treeResult.status === 'timeout') {
          // Promise.race only stops waiting. Explicitly cancel the native
          // traversal so it does not silently keep consuming Binder reads.
          void this.deps.cancelInspectUi?.().catch(() => false);
        }
        this.emitTimingDiagnostic({
          stage: 'vision_accessibility_tree',
          durationMs: Date.now() - treeStartedAt,
          status: treeResult.status === 'fulfilled' ? 'ok' : treeResult.status,
          ...(treeResult.status === 'fulfilled'
            ? { accessibilityTreeChars: treeResult.value.length }
            : {}),
        });
        const observationImage = imageResult.status === 'fulfilled'
          ? imageResult.value
          : undefined;
        if (!observationImage) {
          const imageError = imageResult.status === 'rejected' ? imageResult.reason : undefined;
          const imageErrorCode = imageError && typeof imageError === 'object' && 'code' in imageError
            ? String((imageError as { code?: unknown }).code ?? '')
            : '';
          if (imageErrorCode === 'SCREEN_CAPTURE_PERMISSION_REQUIRED') {
            // The host must own permission UI and task pause/resume. Preserve
            // the typed signal instead of flattening it into an ordinary tool
            // failure that would make the model retry blindly.
            throw imageError;
          }
          if (imageErrorCode === 'HOST_APP_FOREGROUND') {
            return toolFailure('豆泡主 App 当前在前台，已跳过宿主界面截图', 'HOST_APP_FOREGROUND', {
              retryable: false,
              hint: '不要重试 ui_screenshot 或 ui_inspect。请先使用 open_app 打开任务的目标 App；包名不确定时先调用 list_apps。',
            });
          }
          return toolFailure('无法获取当前屏幕截图', 'SCREENSHOT_UNAVAILABLE', {
            retryable: true,
            details: imageError instanceof Error ? { reason: imageError.message } : undefined,
          });
        }
        const accessibilityTree = treeResult.status === 'fulfilled'
          ? treeResult.value
          : treeResult.status === 'timeout'
            ? '=== 屏幕元素 === (结构树等待超时，截图仍可用)'
            : `=== 屏幕元素 === (读取失败：${
              treeResult.reason instanceof Error ? treeResult.reason.message : String(treeResult.reason)
            })`;
        if (treeResult.status === 'fulfilled') this.rememberObservedRefs(accessibilityTree);
        const observationId = `shot_${(++this.visualObservationSequence).toString(36)}`;
        const ocrStartedAt = Date.now();
        const ocrResult = this.ocrEnhancementEnabled
          ? await this.recognizeScreenshotTextForModel(observationImage)
          : undefined;
        this.emitTimingDiagnostic({
          stage: 'vision_ocr',
          durationMs: Date.now() - ocrStartedAt,
          status: !this.ocrEnhancementEnabled ? 'disabled' : ocrResult?.status ?? 'ok',
          ocrElementCount: ocrResult?.elements?.length ?? 0,
        });
        const annotationStartedAt = Date.now();
        const annotatedObservationImage = await this.annotateScreenshotForModel(
          observationImage,
          accessibilityTree,
          ocrResult?.elements,
        );
        this.emitTimingDiagnostic({
          stage: 'vision_annotation',
          durationMs: Date.now() - annotationStartedAt,
          status: 'ok',
          enabled: this.screenshotNodeMarkersEnabled,
          changed: annotatedObservationImage.path !== observationImage.path,
        });
        const resizeStartedAt = Date.now();
        const modelObservationImage = await this.resizeScreenshotForModel(
          annotatedObservationImage,
        );
        this.emitTimingDiagnostic({
          stage: 'vision_resize',
          durationMs: Date.now() - resizeStartedAt,
          status: 'ok',
          enabled: this.screenshotDownscalingEnabled,
          sourceWidth: annotatedObservationImage.width,
          sourceHeight: annotatedObservationImage.height,
          modelWidth: modelObservationImage.width,
          modelHeight: modelObservationImage.height,
          ...(modelObservationImage.base64
            ? { modelBase64Chars: modelObservationImage.base64.length }
            : {}),
        });
        const physicalWidth = positiveImageDimension(observationImage.width)
          ?? positiveImageDimension(annotatedObservationImage.width);
        const physicalHeight = positiveImageDimension(observationImage.height)
          ?? positiveImageDimension(annotatedObservationImage.height);
        this.rememberUiObservation('shot', observationId, physicalWidth, physicalHeight);
        this.rememberOcrRefs(
          observationId,
          ocrResult?.elements ?? [],
          physicalWidth,
          physicalHeight,
        );
        return {
          ok: true,
          data: {
            captured: true,
            observationId,
            coordinateSpace: 'normalized_1000',
            accessibility_tree: accessibilityTree,
            ...(treeResult.status === 'fulfilled'
              ? {}
              : { accessibility_tree_status: treeResult.status }),
            ...(ocrResult?.elements ? { ocr_elements: ocrResult.elements } : {}),
            ...(ocrResult?.status ? { ocr_status: ocrResult.status } : {}),
          },
          observationImage: modelObservationImage,
        };
      }, SCREENSHOT_OVERLAY_SETTLE_MS, this.deps.delay);
    });

    const tapHandler = async (args: Record<string, unknown>) => {
      {
        const ctrl = getController();
        const dispatchWithLiveBoundsFallback = async <T extends {
          found: boolean;
          accepted: boolean;
          method: 'node_action' | 'ancestor_action' | 'coordinate_center' | null;
          bounds: { left: number; top: number; right: number; bottom: number } | null;
          reason: string | null;
        }>(dispatchNodeTarget: () => Promise<T>): Promise<T> =>
          withOverlaySuspendedForObservation(async () => {
            const result = await dispatchNodeTarget();
            // accepted=true only means Android accepted the node action. Never
            // add another touch in that case: doing so could double-toggle,
            // double-add or submit twice. A physical fallback is safe only
            // when the target was resolved but Android explicitly rejected the
            // action and the same live result carries usable screen bounds.
            if (!result.found || result.accepted) return result;
            const bounds = validBounds(result.bounds);
            if (!bounds) return result;
            const center = centerOf(bounds);
            if (!center) return result;
            const accepted = await ctrl.tap(center.x, center.y);
            return accepted
              ? {
                ...result,
                accepted: true,
                method: 'coordinate_center',
                reason: null,
              }
              : result;
          });
        const requestedMode = typeof args.mode === 'string' ? args.mode : '';
        const hasRef = typeof args.ref === 'string' && args.ref.trim().length > 0;
        const semanticKeys = ['text', 'contentDescription', 'resourceId'] as const;
        const populatedSemanticKeys = semanticKeys.filter(
          (key) => typeof args[key] === 'string' && String(args[key]).trim().length > 0,
        );
        const hasSemantic = populatedSemanticKeys.length > 0;
        const hasCoordinate = args.x !== undefined || args.y !== undefined ||
          args.observationId !== undefined;
        const targetCount = Number(hasRef) + Number(hasSemantic) + Number(hasCoordinate);
        if (targetCount !== 1) {
          return toolFailure('ui_tap 必须且只能提供一种目标：ref、语义条件或截图坐标', 'INVALID_ARGUMENT', {
            retryable: true,
          });
        }
        const inferredMode = hasRef
          ? 'ref'
          : hasCoordinate
            ? 'coordinate'
            : populatedSemanticKeys[0] === 'contentDescription'
              ? 'content_description'
              : populatedSemanticKeys[0] === 'resourceId'
                ? 'resource_id'
                : 'text';
        // Calls stored under the previous contract used mode=semantic and may
        // combine semantic fields. Keep those executable during migration.
        const legacySemantic = requestedMode === 'semantic';
        const mode = requestedMode || inferredMode;
        if (!legacySemantic && requestedMode && requestedMode !== inferredMode) {
          return toolFailure('ui_tap.mode 与实际目标参数不一致', 'INVALID_ARGUMENT', { retryable: true });
        }
        if (!legacySemantic && hasSemantic && populatedSemanticKeys.length !== 1) {
          return toolFailure('text、contentDescription 和 resourceId 只能提供一个', 'INVALID_ARGUMENT', {
            retryable: true,
          });
        }
        const allowedByMode: Record<string, Set<string>> = {
          semantic: new Set(['mode', 'dispatch', 'text', 'contentDescription', 'resourceId', 'matchIndex']),
          ref: new Set(['mode', 'dispatch', 'ref']),
          text: new Set(['mode', 'dispatch', 'text', 'matchIndex']),
          content_description: new Set(['mode', 'dispatch', 'contentDescription', 'matchIndex']),
          resource_id: new Set(['mode', 'dispatch', 'resourceId', 'matchIndex']),
          coordinate: new Set(['mode', 'dispatch', 'x', 'y', 'observationId']),
        };
        if (!allowedByMode[mode]) {
          return toolFailure('ui_tap.mode 无效', 'INVALID_ARGUMENT', { retryable: true });
        }
        const unexpected = Object.keys(args).filter((key) => !allowedByMode[mode].has(key));
        if (unexpected.length > 0) {
          return toolFailure(`ui_tap ${mode} 模式包含不允许的参数：${unexpected.join(', ')}`, 'INVALID_ARGUMENT', {
            retryable: true,
            hint: '不同目标模式的参数不得混用。',
          });
        }

        if (mode === 'semantic' || mode === 'text' || mode === 'content_description' || mode === 'resource_id') {
          const tapByQuery = this.nodeTargetGestureTapEnabled
            ? ctrl.tapByQueryGesture
            : ctrl.tapByQuery;
          if (typeof tapByQuery !== 'function') {
            return toolFailure('原生语义点击能力不可用', 'TOOL_UNAVAILABLE', { retryable: false });
          }
          const text = typeof args.text === 'string' ? args.text.trim() : '';
          const description = typeof args.contentDescription === 'string'
            ? args.contentDescription.trim()
            : '';
          const resourceId = typeof args.resourceId === 'string' ? args.resourceId.trim() : '';
          if (!text && !description && !resourceId) {
            return toolFailure('semantic 模式至少需要 text、contentDescription 或 resourceId', 'INVALID_ARGUMENT', {
              retryable: true,
            });
          }
          const matchIndex = args.matchIndex === undefined ? 0 : Number(args.matchIndex);
          if (!Number.isInteger(matchIndex) || matchIndex < 0) {
            return toolFailure('matchIndex 必须是从 0 开始的整数', 'INVALID_ARGUMENT', { retryable: true });
          }
          const dispatchQuery = () => tapByQuery.call(ctrl, text, description, resourceId, matchIndex);
          // Gesture-first native dispatch already performs its node-action
          // fallback against the same live target. Do not synthesize another
          // touch when both routes reject the operation.
          const result = this.nodeTargetGestureTapEnabled
            ? await withOverlaySuspendedForObservation(dispatchQuery)
            : await dispatchWithLiveBoundsFallback(dispatchQuery);
          if (!result.found) {
            const observationId = this.rememberUiObservation('tree');
            return toolFailure('当前无障碍结构未暴露该语义目标', result.reason === 'index_out_of_range'
              ? 'MATCH_INDEX_OUT_OF_RANGE'
              : 'ACCESSIBILITY_TARGET_NOT_FOUND', {
              retryable: true,
              details: {
                ...result,
                observationId,
                scope: 'current_accessibility_tree',
                retryableOnSameObservation: false,
              },
            });
          }
          if (!result.accepted) {
            return toolFailure('找到目标，但 Android 拒绝了点击派发', 'OPERATION_REJECTED', {
              retryable: true,
              details: result,
            });
          }
          return {
            ok: true,
            data: { dispatched: true, effect: 'unknown', mode: legacySemantic ? inferredMode : mode, ...result },
          };
        }

        if (mode === 'ref') {
          const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
          const cachedTarget = this.observedRefTargets.get(ref);
          if (cachedTarget?.source === 'ocr') {
            const observation = this.activeUiObservations.get(cachedTarget.observationId);
            if (!observation || observation.kind !== 'shot') {
              return toolFailure('目标 ref 已失效', 'STALE_TARGET_REF', {
                retryable: true,
                hint: '界面已变化或 ref 过期；请重新观察。',
              });
            }
            const accepted = await withOverlaySuspendedForObservation(
              () => ctrl.tap(cachedTarget.center.x, cachedTarget.center.y),
            );
            if (!accepted) {
              return toolFailure('Android 拒绝了 OCR 目标点击派发', 'OPERATION_REJECTED', {
                retryable: true,
              });
            }
            return {
              ok: true,
              data: {
                dispatched: true,
                effect: 'unknown',
                mode,
                source: 'ocr',
                ref,
                text: cachedTarget.label,
                bounds: cachedTarget.bounds,
                physicalX: cachedTarget.center.x,
                physicalY: cachedTarget.center.y,
                observationId: cachedTarget.observationId,
              },
            };
          }
          if (/^ocr_\d+$/.test(ref)) {
            return toolFailure('目标 ref 已失效', 'STALE_TARGET_REF', {
              retryable: true,
              hint: '界面已变化或 OCR ref 过期；请重新截图。',
            });
          }
          const tapByRef = this.nodeTargetGestureTapEnabled
            ? ctrl.tapByRefGesture
            : ctrl.tapByRef;
          if (typeof tapByRef !== 'function') {
            return toolFailure('原生 ref 点击能力不可用', 'TOOL_UNAVAILABLE', { retryable: false });
          }
          if (!/^u[0-9a-z]+$/.test(ref)) {
            return toolFailure('ref 格式无效', 'INVALID_ARGUMENT', {
              retryable: true,
              hint: '只能使用最新 ui_inspect 或 ui_screenshot 返回的 ref。',
            });
          }
          const dispatchRef = () => tapByRef.call(ctrl, ref);
          const result = this.nodeTargetGestureTapEnabled
            ? await withOverlaySuspendedForObservation(dispatchRef)
            : await dispatchWithLiveBoundsFallback(dispatchRef);
          if (!result.found) {
            return toolFailure('目标 ref 已失效', 'STALE_TARGET_REF', {
              retryable: true,
              hint: '界面已变化或 ref 过期；请重新观察，或直接改用语义点击。',
              details: result,
            });
          }
          if (!result.accepted) {
            return toolFailure('目标存在，但 Android 拒绝了点击派发', 'OPERATION_REJECTED', {
              retryable: true,
              details: result,
            });
          }
          return {
            ok: true,
            data: { dispatched: true, effect: 'unknown', mode, ...result },
          };
        }

        const x = Number(args.x);
        const y = Number(args.y);
        const observationId = typeof args.observationId === 'string' ? args.observationId : '';
        if (!Number.isFinite(x) || !Number.isFinite(y) || !observationId) {
          return toolFailure('coordinate 模式需要 x、y 和 observationId', 'INVALID_ARGUMENT', { retryable: true });
        }
        const resolved = resolveScreenshotCoordinate(x, y, observationId);
        if ('error' in resolved) return resolved.error;
        const accepted = await withOverlaySuspendedForObservation(
          () => ctrl.tap(resolved.physicalX, resolved.physicalY),
        );
        if (!accepted) {
          return toolFailure('Android 拒绝了坐标点击派发', 'OPERATION_REJECTED', { retryable: true });
        }
        return {
          ok: true,
          data: {
            dispatched: true,
            effect: 'unknown',
            mode,
            x,
            y,
            coordinateSpace: resolved.coordinateSpace,
            physicalX: resolved.physicalX,
            physicalY: resolved.physicalY,
            observationId,
          },
        };
      }

    };

    // Runtime inference keeps mode-less and legacy semantic/dispatch history
    // compatible; current model requests use explicit atomic target modes.
    this.registry.register(runtimeTapTool, tapHandler);

    this.registry.register(phoneTool('ui_fill'), async (args) => {
      const ctrl = getController();
      const mode = typeof args.mode === 'string' ? args.mode : '';
      const value = typeof args.value === 'string' ? args.value : null;
      const submit = args.submit === undefined ? false : args.submit;
      const allowedByMode: Record<string, Set<string>> = {
        focused: new Set(['mode', 'value', 'submit']),
        ref: new Set(['mode', 'value', 'submit', 'ref']),
        text: new Set(['mode', 'value', 'submit', 'targetText', 'matchIndex']),
        content_description: new Set(['mode', 'value', 'submit', 'contentDescription', 'matchIndex']),
        resource_id: new Set(['mode', 'value', 'submit', 'resourceId', 'matchIndex']),
      };
      if (!allowedByMode[mode]) {
        return toolFailure('ui_fill.mode 无效', 'INVALID_ARGUMENT', { retryable: true });
      }
      if (value === null) {
        return toolFailure('ui_fill.value 必须是字符串', 'INVALID_ARGUMENT', { retryable: true });
      }
      if (typeof submit !== 'boolean') {
        return toolFailure('ui_fill.submit 必须是布尔值', 'INVALID_ARGUMENT', { retryable: true });
      }
      const unexpected = Object.keys(args).filter((key) => !allowedByMode[mode].has(key));
      if (unexpected.length > 0) {
        return toolFailure(`ui_fill ${mode} 模式包含不允许的参数：${unexpected.join(', ')}`, 'INVALID_ARGUMENT', {
          retryable: true,
        });
      }

      const findFocusedRef = async (attempts: number): Promise<string | null> => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const tree = await readAccessibilityTreeWithoutOverlay();
          const focused = findFocusedEditableNode(tree);
          if (focused) return focused;
          if (attempt + 1 < attempts) await this.deps.delay(80);
        }
        return null;
      };

      const fillSucceeded = (editableRef: string) => ({
        ok: true,
        data: {
          filled: true,
          submitted: submit,
          mode,
          ref: editableRef,
          valueLength: value.length,
        },
      });

      const tryFillAndSubmit = async (editableRef: string): Promise<'filled' | 'submitted' | 'failed'> => {
        const filled = await ctrl.setNodeText(editableRef, value);
        if (!filled) return 'failed';
        if (!submit) return 'filled';
        return await ctrl.performAction(editableRef, 'imeEnter') ? 'submitted' : 'filled';
      };

      let editableRef: string | null = null;
      let focusResult: unknown = null;
      let focusArgs: Record<string, unknown> | null = null;
      if (mode === 'focused') {
        editableRef = await findFocusedRef(1);
      } else {
        const matchIndex = args.matchIndex === undefined ? 0 : Number(args.matchIndex);
        if (!Number.isInteger(matchIndex) || matchIndex < 0) {
          return toolFailure('matchIndex 必须是从 0 开始的整数', 'INVALID_ARGUMENT', { retryable: true });
        }
        focusArgs = { mode };
        if (mode === 'ref') {
          if (!isValidRef(args.ref)) {
            return toolFailure('ref 格式无效', 'INVALID_ARGUMENT', { retryable: true });
          }
          focusArgs.ref = String(args.ref);
        } else if (mode === 'text') {
          const targetText = typeof args.targetText === 'string' ? args.targetText.trim() : '';
          if (!targetText) {
            return toolFailure('text 模式需要 targetText', 'INVALID_ARGUMENT', { retryable: true });
          }
          focusArgs.text = targetText;
          focusArgs.matchIndex = matchIndex;
        } else if (mode === 'content_description') {
          const description = typeof args.contentDescription === 'string'
            ? args.contentDescription.trim()
            : '';
          if (!description) {
            return toolFailure('content_description 模式需要 contentDescription', 'INVALID_ARGUMENT', {
              retryable: true,
            });
          }
          focusArgs.contentDescription = description;
          focusArgs.matchIndex = matchIndex;
        } else {
          const resourceId = typeof args.resourceId === 'string' ? args.resourceId.trim() : '';
          if (!resourceId) {
            return toolFailure('resource_id 模式需要 resourceId', 'INVALID_ARGUMENT', { retryable: true });
          }
          focusArgs.resourceId = resourceId;
          focusArgs.matchIndex = matchIndex;
        }

        if (mode === 'ref' && typeof ctrl.getNodeInfoByRef === 'function') {
          const info = await ctrl.getNodeInfoByRef(String(args.ref)).catch(() => null);
          if (info?.found && info.isEditable) editableRef = String(args.ref);
        } else {
          const directQuery: NodeQuery = mode === 'text'
            ? { text: String(args.targetText) }
            : mode === 'content_description'
              ? { contentDescription: String(args.contentDescription) }
              : { resourceId: String(args.resourceId) };
          const snapshot = typeof ctrl.findAccessibilityNodes === 'function'
            ? await findAccessibilityNodesWithoutOverlay(directQuery, 50).catch(() => null)
            : null;
          const matches = snapshot ? collectAllNodeDetails(snapshot.nodes, directQuery) : [];
          const selected = matches[matchIndex];
          if (selected?.isEditable && typeof selected.ref === 'string') {
            editableRef = selected.ref;
          }
        }

        // ACTION_SET_TEXT often works without focusing the view. Keep this as
        // the primary path so automation does not unnecessarily open the IME.
        if (editableRef) {
          const directResult = await tryFillAndSubmit(editableRef);
          if (directResult === 'submitted' || (directResult === 'filled' && !submit)) {
            return fillSucceeded(editableRef);
          }
        }

        // Some custom input controls only accept text or IME actions after a
        // real focus gesture. Preserve the previous behavior as a fallback.
        focusResult = await tapHandler(focusArgs);
        if (focusResult && typeof focusResult === 'object' &&
          (focusResult as { ok?: unknown }).ok === false) {
          return toolFailure('无法定位或聚焦输入框', 'FOCUS_FAILED', {
            retryable: true,
            details: focusResult,
          });
        }

        if (mode === 'ref' && typeof ctrl.getNodeInfoByRef === 'function') {
          const info = await ctrl.getNodeInfoByRef(String(args.ref)).catch(() => null);
          editableRef = info?.found && info.isEditable ? String(args.ref) : null;
        } else {
          editableRef = null;
        }
        editableRef ??= await findFocusedRef(3);
      }

      if (!editableRef) {
        return toolFailure('点击目标后未找到已聚焦的可编辑输入框', 'FOCUS_FAILED', {
          retryable: true,
          hint: '请重新观察输入框语义；存在多个相似目标时先消歧，或在输入框已聚焦后使用 focused 模式。',
          details: focusResult,
        });
      }

      const finalResult = await tryFillAndSubmit(editableRef);
      if (finalResult === 'failed') {
        return toolFailure('输入框拒绝设置文本', 'INPUT_FAILED', {
          retryable: true,
          details: { stage: 'input', ref: editableRef },
        });
      }

      if (submit && finalResult !== 'submitted') {
        let submitted = false;
        if (!submitted) {
          const refreshedRef = await findFocusedRef(1);
          if (refreshedRef && refreshedRef !== editableRef) {
            editableRef = refreshedRef;
            submitted = await ctrl.performAction(editableRef, 'imeEnter');
          }
        }
        if (!submitted) {
          return toolFailure('文本已写入，但输入框拒绝 IME 提交', 'SUBMIT_FAILED', {
            retryable: true,
            details: { stage: 'submit', ref: editableRef, filled: true },
          });
        }
      }

      return fillSucceeded(editableRef);
    });

    this.registry.register(phoneTool('ui_long_press'), async (args) => {
      const ctrl = getController();
      const allowed = args.mode === 'ref'
        ? new Set(['mode', 'ref', 'durationMs'])
        : new Set(['mode', 'x', 'y', 'observationId', 'durationMs']);
      const unexpected = Object.keys(args).filter((key) => !allowed.has(key));
      if (unexpected.length > 0) {
        return toolFailure(`ui_long_press 模式参数混用：${unexpected.join(', ')}`, 'INVALID_ARGUMENT', {
          retryable: true,
        });
      }
      const durationMs = args.durationMs === undefined ? 1_000 : Number(args.durationMs);
      if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > 5_000) {
        return toolFailure('durationMs 必须是 500–5000 之间的整数', 'INVALID_ARGUMENT', {
          retryable: true,
        });
      }
      if (args.mode === 'ref') {
        const ref = isValidRef(args.ref) ? String(args.ref) : null;
        if (!ref) return toolFailure('ref 格式无效', 'INVALID_ARGUMENT', { retryable: true });
        // Preserve the semantic node action when no explicit duration was
        // requested. Android's ACTION_LONG_CLICK cannot express a duration;
        // an explicit duration therefore uses the live node center as a
        // physical gesture target while keeping ref as the locator.
        if (args.durationMs === undefined) {
          if (await ctrl.longPressNode(ref)) return true;
          return toolFailure('节点长按被 Android 拒绝', 'OPERATION_REJECTED', { retryable: true });
        }
        if (typeof ctrl.getNodeInfoByRef !== 'function') {
          return toolFailure('当前设备无法解析 ref 的实时位置', 'TOOL_UNAVAILABLE', { retryable: false });
        }
        const info = await ctrl.getNodeInfoByRef(ref).catch(() => null);
        if (!info?.found) {
          return toolFailure('目标 ref 已失效', 'STALE_TARGET_REF', {
            retryable: true,
            hint: '界面已变化或 ref 过期；请重新观察。',
          });
        }
        const bounds = validBounds(info.bounds);
        const center = info.center ?? centerOf(bounds ?? undefined);
        if (!center) {
          return toolFailure('目标 ref 没有可用的屏幕位置', 'TARGET_BOUNDS_UNAVAILABLE', {
            retryable: true,
          });
        }
        const accepted = await withOverlaySuspendedForObservation(
          () => ctrl.longPress(center.x, center.y, durationMs),
        );
        if (accepted) {
          return {
            ok: true,
            data: {
              dispatched: true,
              effect: 'unknown',
              mode: 'ref',
              ref,
              physicalX: center.x,
              physicalY: center.y,
              durationMs,
            },
          };
        }
        return toolFailure('节点长按被 Android 拒绝', 'OPERATION_REJECTED', { retryable: true });
      }
      if (args.mode !== 'coordinate') {
        return toolFailure('ui_long_press.mode 必须是 ref 或 coordinate', 'INVALID_ARGUMENT', { retryable: true });
      }
      const x = Number(args.x);
      const y = Number(args.y);
      const observationId = typeof args.observationId === 'string' ? args.observationId : '';
      if (!Number.isFinite(x) || !Number.isFinite(y) || !observationId) {
        return toolFailure('长按坐标缺少当前有效的 UI observationId', 'STALE_UI_OBSERVATION', {
          retryable: true,
        });
      }
      const resolved = resolveScreenshotCoordinate(x, y, observationId);
      if ('error' in resolved) return resolved.error;
      const accepted = await withOverlaySuspendedForObservation(
        () => ctrl.longPress(resolved.physicalX, resolved.physicalY, durationMs),
      );
      return accepted
        ? {
          ok: true,
          data: {
            dispatched: true,
            effect: 'unknown',
            mode: 'coordinate',
            x,
            y,
            coordinateSpace: resolved.coordinateSpace,
            physicalX: resolved.physicalX,
            physicalY: resolved.physicalY,
            durationMs,
            observationId,
          },
        }
        : toolFailure('坐标长按被 Android 拒绝', 'OPERATION_REJECTED', { retryable: true });
    });

    this.registry.register(phoneTool('clipboard_set'), async (args) => {
      const text = typeof args.text === 'string' ? args.text : '';
      if (text.length === 0) {
        return toolFailure('剪贴板文本不能为空', 'INVALID_ARGUMENT', { retryable: true });
      }
      try {
        // Import lazily so the reusable agent package remains loadable when
        // the Expo native module is unavailable (for example in Node tests).
        const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
        await Clipboard.setStringAsync(text);
        // Do not echo clipboard contents into tool history or telemetry.
        return { written: true, length: text.length };
      } catch (error) {
        return toolFailure('无法写入系统剪贴板', 'CLIPBOARD_WRITE_FAILED', {
          retryable: true,
          details: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    });

    this.registry.register(phoneTool('ui_clear_text'), async (args) => {
      const ctrl = getController();
      let ref = isValidRef(args.ref) ? String(args.ref) : null;
      if (!ref) {
        const tree = await ctrl.getAccessibilityTree();
        ref = findFocusedEditableNode(tree);
        if (!ref) {
          throw new Error(
            'ui_clear_text: no focused editable field found. Call ui_tap on the target input first, or provide a ref.',
          );
        }
      }
      return ctrl.performAction(ref, 'clearText').then((ok) => {
        if (ok) return true;
        return {
          ok: false,
          error: `输入框 ${ref} 拒绝清除文本（ACTION_CLEAR 未生效）`,
          hint: '可尝试用 ui_fill 直接覆盖输入内容，或 ui_tap 后长按呼出系统粘贴菜单。',
        };
      });
    });

    this.registry.register(phoneTool('ui_press_enter'), async (args) => {
      const ctrl = getController();
      // MobileAgent-style: IME enter on the focused node. No pressEnterFocused
      // primitive exists — resolve the focused editable node and dispatch the
      // imeEnter accessibility action.
      let ref = isValidRef(args.ref) ? String(args.ref) : null;
      if (!ref) {
        const tree = await ctrl.getAccessibilityTree();
        ref = findFocusedEditableNode(tree);
        if (!ref) {
          throw new Error(
            'ui_press_enter: no focused editable field found. Call ui_tap on the target input first, or provide a ref.',
          );
        }
      }
      return ctrl.performAction(ref, 'imeEnter');
    });

    this.registry.register(phoneTool('ui_swipe'), async (args) => {
      const ctrl = getController();
      return ctrl.swipe(
        Number(args.startX),
        Number(args.startY),
        Number(args.endX),
        Number(args.endY),
        args.durationMs !== undefined ? Number(args.durationMs) : undefined,
      );
    });

    this.registry.register(phoneTool('ui_scroll'), async (args) => {
      const ctrl = getController();
      const direction = String(args.direction);
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        return toolFailure('scroll 的 direction 无效', 'INVALID_ARGUMENT', {
          retryable: false,
          hint: 'direction 只能是 up、down、left 或 right。',
        });
      }
      const distance = args.distance === undefined ? 'medium' : String(args.distance);
      if (!Object.prototype.hasOwnProperty.call(SCROLL_DISTANCE_RATIOS, distance)) {
        return toolFailure('scroll 的 distance 无效', 'INVALID_ARGUMENT', {
          retryable: false,
          hint: 'distance 只能是 short、medium 或 long。',
        });
      }

      const requestedRef = isValidRef(args.ref) ? String(args.ref) : null;
      if (args.ref !== undefined && !requestedRef) {
        return toolFailure('scroll 的 ref 格式无效', 'INVALID_ARGUMENT', {
          retryable: true,
          hint: '请使用当前无障碍元素树中 ref= 后的完整值，或省略 ref 让工具自动选择。',
        });
      }
      let ref: string;
      let viewport: NonNullable<A11yNode['bounds']>;
      if (requestedRef) {
        if (typeof ctrl.getNodeInfoByRef === 'function') {
          const info = await ctrl.getNodeInfoByRef(requestedRef);
          const liveBounds = validBounds(info.bounds);
          if (!info.found || !liveBounds) {
            return toolFailure(`滚动容器 ${requestedRef} 已失效或没有有效边界`, 'TARGET_CHANGED', {
              retryable: true,
              hint: '界面可能已经变化，请重新观察后使用当前 ref。',
            });
          }
          ref = requestedRef;
          viewport = liveBounds;
        } else {
          const tree = await ctrl.getAccessibilityTree();
          const treeBounds = getBoundsByRef(tree, requestedRef);
          if (!treeBounds) {
            return toolFailure(`滚动容器 ${requestedRef} 已不在当前界面或没有有效边界`, 'TARGET_CHANGED', {
              retryable: true,
              hint: '界面可能已经变化，请重新观察后使用当前 ref。',
            });
          }
          ref = requestedRef;
          viewport = treeBounds;
        }
      } else {
        const tree = await ctrl.getAccessibilityTree();
        const scrollableNodes = collectScrollableNodes(tree);
        if (scrollableNodes.length > 1) {
          return toolFailure('当前界面存在多个可滚动容器，无法确定滚动目标', 'AMBIGUOUS_SCROLL_TARGET', {
            retryable: true,
            hint: '请根据当前界面结构选择目标容器，并在 scroll 中传入它的 ref。',
            details: { candidates: scrollableNodes },
          });
        }
        const selected = scrollableNodes[0];
        const selectedBounds = selected ? getBoundsByRef(tree, selected.ref) : null;
        if (!selected || !selectedBounds) {
          return toolFailure('当前屏幕上没有找到可滚动元素', 'SCROLL_TARGET_UNAVAILABLE', {
            retryable: true,
            hint: '请重新观察界面并提供可滚动容器的 ref。',
          });
        }
        ref = selected.ref;
        viewport = selectedBounds;
      }

      const typedDistance = distance as ScrollDistance;
      const distanceRatio = SCROLL_DISTANCE_RATIOS[typedDistance];
      const gesture = scrollGesture(viewport, direction, distanceRatio);
      const gestureAccepted = await ctrl.swipe(
        gesture.startX,
        gesture.startY,
        gesture.endX,
        gesture.endY,
        350,
      );
      if (gestureAccepted) {
        return {
          ok: true,
          data: {
            actionAccepted: true,
            method: 'coordinate',
            ref,
            direction,
            distance: typedDistance,
            distanceRatio,
            distanceControlled: true,
            gesture,
          },
        };
      }

      const nodeAccepted = await ctrl.scrollNode(ref, direction);
      if (nodeAccepted) {
        return {
          ok: true,
          data: {
            actionAccepted: true,
            method: 'node',
            ref,
            direction,
            distance: typedDistance,
            distanceRatio,
            distanceControlled: false,
          },
        };
      }
      return toolFailure('滚动操作被系统拒绝', 'SCROLL_REJECTED', {
        retryable: true,
        hint: '请确认目标容器仍可滚动，并在界面变化后重新观察。',
        details: { ref, direction, distance: typedDistance },
      });
    });

    this.registry.register(phoneTool('ui_scroll_page'), async (args) => {
      const ctrl = getController();
      const direction = String(args.direction);
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        return toolFailure('ui_scroll_page 的 direction 无效', 'INVALID_ARGUMENT', {
          retryable: false,
          hint: 'direction 只能是 up、down、left 或 right。',
        });
      }
      const overlapRatio = clampNumber(args.overlapRatio, 0.1, 0.4, 0.2);
      const beforeTree = await ctrl.getAccessibilityTree();
      const visualBaseline = await this.captureFastVisualFrame();
      const requestedRef = isValidRef(args.ref) ? String(args.ref) : null;
      if (args.ref !== undefined && !requestedRef) {
        return toolFailure('ui_scroll_page 的 ref 格式无效', 'INVALID_ARGUMENT', {
          retryable: true,
          hint: '请使用当前无障碍元素树中 ref= 后的完整值，或省略 ref 让工具自动选择。',
        });
      }

      let ref = requestedRef ?? findFirstScrollableNode(beforeTree);
      let viewport: NonNullable<A11yNode['bounds']> | null = null;
      if (requestedRef && typeof ctrl.getNodeInfoByRef === 'function') {
        const info = await ctrl.getNodeInfoByRef(requestedRef);
        viewport = info.found ? validBounds(info.bounds) : null;
      } else if (ref) {
        viewport = getBoundsByRef(beforeTree, ref);
      }
      if (requestedRef && !viewport) {
        return toolFailure(`滚动容器 ${requestedRef} 已失效或没有有效边界`, 'TARGET_CHANGED', {
          retryable: true,
          hint: '界面可能已经变化，请重新观察后使用当前 ref，或省略 ref。',
        });
      }

      const attempts: Array<{ method: 'node' | 'coordinate'; accepted: boolean }> = [];
      let accepted = false;
      let method: 'node' | 'coordinate' = 'coordinate';
      let gesture: ReturnType<typeof scrollGesture> | null = null;
      if (ref) {
        accepted = await ctrl.scrollNode(ref, direction);
        attempts.push({ method: 'node', accepted });
        if (accepted) method = 'node';
      }
      if (!accepted) {
        viewport ??= largestBoundsInTree(beforeTree);
        if (!viewport) {
          return toolFailure('无法确定分页滚动区域', 'SCROLL_TARGET_UNAVAILABLE', {
            retryable: true,
            hint: '请重新观察界面并提供可滚动容器 ref；精确知道区域时也可以改用 ui_swipe。',
            details: { attempts },
          });
        }
        gesture = scrollGesture(viewport, direction, 1 - overlapRatio);
        accepted = await ctrl.swipe(
          gesture.startX,
          gesture.startY,
          gesture.endX,
          gesture.endY,
          450,
        );
        method = 'coordinate';
        attempts.push({ method, accepted });
      }
      if (!accepted) {
        return toolFailure('分页滚动手势被系统拒绝', 'SCROLL_REJECTED', {
          retryable: true,
          hint: '请确认目标区域可滚动，重新观察后提供容器 ref，或改用精确 ui_swipe。',
          details: { attempts },
        });
      }

      await this.deps.delay(350);
      const [afterTreeResult, postImage] = await Promise.all([
        ctrl.getAccessibilityTree().then((tree) => ({ tree })).catch(() => ({ tree: null })),
        this.captureFastVisualFrame().then(async (image) => image ?? this.capturePostActionEvidence()),
      ]);
      const afterTree = afterTreeResult.tree;
      const treeChanged = afterTree !== null && hasMeaningfulUiChange(
        createUiSnapshot(beforeTree),
        createUiSnapshot(afterTree),
      );
      let visualDifference: {
        changedPixelRatio: number;
        changedTileRatio: number;
        meanDelta: number;
      } | undefined;
      let visualChanged: boolean | null = null;
      if (
        visualBaseline?.path &&
        postImage?.path &&
        typeof ctrl.compareScreenshotFiles === 'function'
      ) {
        const comparison = await Promise.race([
          ctrl.compareScreenshotFiles(visualBaseline.path, postImage.path).catch(() => null),
          this.deps.delay(TAP_VISUAL_COMPARE_TIMEOUT_MS).then(() => null),
        ]);
        if (comparison) {
          visualChanged = comparison.changed;
          visualDifference = {
            changedPixelRatio: comparison.changedPixelRatio,
            changedTileRatio: comparison.changedTileRatio,
            meanDelta: comparison.meanDelta,
          };
        }
      }

      const changed = treeChanged || visualChanged === true;
      const comparisonAvailable = afterTree !== null || visualChanged !== null;
      const verificationStatus = changed
        ? 'verified_changed'
        : comparisonAvailable && visualChanged === false
          ? 'verified_unchanged'
          : 'accepted_unverified';
      const atEdge = verificationStatus === 'verified_unchanged';
      const accessibilityTree = afterTree === null
        ? '=== 屏幕元素 === (分页后读取失败)'
        : ScreenSerializer.serialize(afterTree);
      return {
        ok: true,
        data: {
          actionAccepted: true,
          changed,
          atEdge,
          verificationStatus,
          method,
          direction,
          overlapRatio,
          ...(gesture ? { gesture } : {}),
          attempts,
          accessibility_tree: accessibilityTree,
          ...(visualDifference ? { visualDifference } : {}),
        },
        ...(postImage ? { observationImage: postImage } : {}),
      };
    });

    this.registry.register(phoneTool('open_app'), async (args) => {
      const ctrl = getController();
      const pkg = String(args.packageName);
      const startedAt = Date.now();
      const confirmationAvailable = typeof ctrl.getCurrentForegroundApp === 'function';
      let foreground = confirmationAvailable
        ? await this.readForegroundApp(() => ctrl.getCurrentForegroundApp!())
        : null;

      if (foreground?.packageName === pkg) {
        return {
          ok: true,
          data: this.appLaunchState(pkg, foreground, {
            launchAccepted: true,
            launchConfirmed: true,
            confirmationAvailable: true,
            alreadyForeground: true,
            elapsedMs: Date.now() - startedAt,
          }),
        };
      }

      if (!(await ctrl.openApp(pkg))) {
        return {
          ok: false,
          error: 'APP_LAUNCH_REJECTED',
          hint: `无法打开 ${pkg}。请用 list_apps 确认已安装应用的准确包名后重试。`,
          data: this.appLaunchState(pkg, foreground, {
            launchAccepted: false,
            launchConfirmed: false,
            confirmationAvailable,
            alreadyForeground: false,
            elapsedMs: Date.now() - startedAt,
          }),
        };
      }

      if (!confirmationAvailable) {
        return {
          ok: true,
          data: this.appLaunchState(pkg, null, {
            launchAccepted: true,
            launchConfirmed: false,
            confirmationAvailable: false,
            alreadyForeground: false,
            elapsedMs: Date.now() - startedAt,
          }),
        };
      }

      for (
        let attempt = 0;
        attempt < OPEN_APP_CONFIRM_ATTEMPTS &&
          Date.now() - startedAt < OPEN_APP_CONFIRM_TIMEOUT_MS;
        attempt += 1
      ) {
        foreground = await this.readForegroundApp(() => ctrl.getCurrentForegroundApp!());
        if (foreground?.packageName === pkg) {
          return {
            ok: true,
            data: this.appLaunchState(pkg, foreground, {
              launchAccepted: true,
              launchConfirmed: true,
              confirmationAvailable: true,
              alreadyForeground: false,
              elapsedMs: Date.now() - startedAt,
            }),
          };
        }
        if (attempt < OPEN_APP_CONFIRM_ATTEMPTS - 1) {
          await this.deps.delay(OPEN_APP_CONFIRM_POLL_MS);
        }
      }

      const actualPackage = foreground?.packageName || '未知';
      return {
        ok: false,
        error: 'APP_NOT_FOREGROUND',
        hint: `启动请求已发出，但未确认 ${pkg} 进入前台；当前前台为 ${actualPackage}。请根据当前屏幕继续处理，不要立即重复打开应用。`,
        data: this.appLaunchState(pkg, foreground, {
          launchAccepted: true,
          launchConfirmed: false,
          confirmationAvailable: true,
          alreadyForeground: false,
          elapsedMs: Date.now() - startedAt,
        }),
      };
    });

    this.registry.register(phoneTool('list_apps'), async () => {
      const ctrl = getController();
      return ctrl.getInstalledApps();
    });

    this.registry.register(phoneTool('ui_dump_raw_tree'), async () => {
      const snapshot = await readRawAccessibilitySnapshotWithoutOverlay();
      return {
        format: 'depth_first_flat_tree',
        hierarchy: 'Use index, parentIndex, depth and childCount to reconstruct the tree.',
        ...snapshot,
      };
    });

    this.registry.register(phoneTool('ui_find_node'), async (args) => {
      const query: NodeQuery = {
        text: args.text !== undefined ? String(args.text) : undefined,
        contentDescription: args.contentDescription !== undefined
          ? String(args.contentDescription)
          : undefined,
        className: args.className !== undefined ? String(args.className) : undefined,
        isChecked: args.isChecked !== undefined ? Boolean(args.isChecked) : undefined,
        isEnabled: args.isEnabled !== undefined ? Boolean(args.isEnabled) : undefined,
      };
      const direct = getController().findAccessibilityNodes
        ? await findAccessibilityNodesWithoutOverlay(query, 50)
        : null;
      const tree = direct?.nodes ?? await readAccessibilityTreeWithoutOverlay();
      const matches = collectAllNodeDetails(tree, query);
      const observationId = this.rememberUiObservation('tree');
      if (matches.length > 0) {
        const result = {
          observationId,
          found: true,
          ambiguous: matches.length > 1,
          matchCount: matches.length,
          truncated: direct?.truncated ?? false,
          matches,
        };
        return matches.length === 1 ? { ...result, ...matches[0] } : result;
      }
      return {
        observationId,
        found: false,
        ambiguous: false,
        reason: direct?.truncated
          ? `SEARCH_TRUNCATED_${direct.reason ?? 'UNKNOWN'}`
          : 'NO_MATCH_IN_CURRENT_ACCESSIBILITY_TREE',
        scope: 'current_accessibility_tree',
        matchCount: 0,
        truncated: direct?.truncated ?? false,
        matches: [],
        message: direct?.truncated
          ? '定向搜索已达到本次深度、耗时或结果边界，当前结果中没有匹配节点。'
          : '当前时刻的无障碍树中没有匹配节点；这不能证明目标位于屏幕下方、其他页面或视觉界面中。',
      };
    });

    this.registry.register(phoneTool('ui_global_action'), async (args) => {
      const ctrl = getController();
      const action = String(args.action);
      if (await ctrl.globalAction(action)) return true;
      return {
        ok: false,
        error: `系统操作 ${action} 未生效`,
        hint: '请确认当前前台应用允许该操作，或改用其他方式推进。',
      };
    });

    this.registry.register(phoneTool('wait'), async (args) => {
      const ctrl = getController();
      const ms = Math.max(0, args.ms !== undefined ? Number(args.ms) : 1000);
      // `ms` is the maximum wait time: poll the screen every 500ms and
      // return early the moment the content changes (page loaded, animation
      // finished), so the next observation sees the new screen sooner.
      let baseline: string | null = null;
      try {
        baseline = await ctrl.getScreenText();
      } catch {
        // No readable screen: degrade to a plain delay.
        await this.deps.delay(ms);
        return `等待 ${ms}ms 完成`;
      }
      const started = Date.now();
      const pollMs = 500;
      const deadline = started + ms;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await this.deps.delay(Math.min(pollMs, remaining));
        try {
          const current = await ctrl.getScreenText();
          if (current !== baseline) {
            return `等待中屏幕已变化（第 ${Date.now() - started}ms），提前返回`;
          }
        } catch {
          // A single failed read is not fatal: keep waiting.
        }
      }
      return `等待 ${ms}ms 完成，屏幕未变化`;
    });

    this.registry.register(phoneTool('ui_wait_for_node'), async (args) => {
      const timeoutMs = args.timeoutMs !== undefined ? Number(args.timeoutMs) : 5000;
      const intervalMs = args.intervalMs !== undefined ? Number(args.intervalMs) : 500;
      const query: NodeQuery = {
        text: args.text !== undefined ? String(args.text) : undefined,
        contentDescription: args.contentDescription !== undefined
          ? String(args.contentDescription)
          : undefined,
        className: args.className !== undefined ? String(args.className) : undefined,
        isChecked: args.isChecked !== undefined ? Boolean(args.isChecked) : undefined,
        isEnabled: args.isEnabled !== undefined ? Boolean(args.isEnabled) : undefined,
      };
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const direct = getController().findAccessibilityNodes
          ? await findAccessibilityNodesWithoutOverlay(query, 50)
          : null;
        const tree = direct?.nodes ?? await readAccessibilityTreeWithoutOverlay();
        const found = findNodeInTree(tree, query);
        if (found !== null) return found.ref;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await this.deps.delay(Math.min(intervalMs, remaining));
      }
      return null;
    });

    this.registry.register(phoneTool('ui_wait_for_change'), async (args) => {
      const ctrl = getController();
      const timeoutMs = args.timeoutMs !== undefined ? Number(args.timeoutMs) : 5000;
      const intervalMs = args.pollIntervalMs !== undefined ? Number(args.pollIntervalMs) : 500;
      const baseline = await ctrl.getScreenText();
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await this.deps.delay(Math.min(intervalMs, remaining));
        const current = await ctrl.getScreenText();
        if (current !== baseline) return true;
      }
      return {
        ok: false,
        error: `等待 ${timeoutMs}ms 内屏幕未发生变化`,
        hint: '页面可能未加载完成或上一步动作未生效，请重新观察屏幕。',
      };
    });

    this.registry.register(phoneTool('ui_get_node'), async (args) => {
      const ctrl = getController();
      const ref = String(args.ref);
      if (typeof ctrl.getNodeInfoByRef === 'function') {
        const info = await ctrl.getNodeInfoByRef(ref);
        if (info.found) return nodeDetails(ref, info);
        return toolFailure(`ref "${ref}" 已失效`, 'STALE_TARGET_REF', {
          retryable: true,
          hint: '界面可能已经变化，请重新观察后使用当前 ref。',
        });
      }
      const tree = await readAccessibilityTreeWithoutOverlay();
      const roots = Array.isArray(tree) ? tree : [tree];
      const node = findNodeRecordByRef(roots, ref);
      return node
        ? nodeDetails(ref, { found: true, ...node })
        : toolFailure(`ref "${ref}" 已失效`, 'STALE_TARGET_REF', {
          retryable: true,
          hint: '界面可能已经变化，请重新观察后使用当前 ref。',
        });
    });

    this.registry.register(phoneTool('ui_set_checked'), async (args) => {
      const ctrl = getController();
      const ref = String(args.ref);
      if (typeof args.checked !== 'boolean') {
        return toolFailure('checked 必须是布尔值', 'INVALID_ARGUMENT', {
          retryable: false,
        });
      }
      const desired = args.checked;
      const info = typeof ctrl.getNodeInfoByRef === 'function'
        ? await ctrl.getNodeInfoByRef(ref)
        : null;
      const currentState = info
        ? (info.found ? checkedStateFromLiveInfo(info) : null)
        : getNodeCheckedStateByRef(await ctrl.getAccessibilityTree(), ref);
      if (currentState === null) {
        return toolFailure(`ref "${ref}" 已失效或不可读取`, 'STALE_TARGET_REF', {
          retryable: true,
          hint: '请重新观察后使用当前复选框、开关或单选按钮的 ref。',
        });
      }
      if (!currentState.isEnabled) {
        return toolFailure(`ref "${ref}" 当前不可用`, 'TARGET_DISABLED', {
          retryable: true,
        });
      }
      if (!currentState.isCheckable) {
        return toolFailure(`ref "${ref}" 不是可勾选控件`, 'TARGET_NOT_CHECKABLE', {
          retryable: true,
        });
      }
      if (currentState.isChecked === desired) {
        return { changed: false, verified: true, checked: desired, ref };
      }

      const accepted = await ctrl.tapNode(ref);
      if (!accepted) {
        return toolFailure(`ref "${ref}" 的勾选操作被系统拒绝`, 'SET_CHECKED_REJECTED', {
          retryable: true,
        });
      }

      let observedChecked = currentState.isChecked;
      let targetReadable = true;
      for (let attempt = 0; attempt < SET_CHECKED_VERIFY_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await this.deps.delay(SET_CHECKED_VERIFY_POLL_MS);
        const after = typeof ctrl.getNodeInfoByRef === 'function'
          ? await ctrl.getNodeInfoByRef(ref).catch(() => null)
          : null;
        const afterState = after?.found
          ? checkedStateFromLiveInfo(after)
          : typeof ctrl.getNodeInfoByRef === 'function'
            ? null
            : getNodeCheckedStateByRef(await ctrl.getAccessibilityTree(), ref);
        if (!afterState) {
          targetReadable = false;
          continue;
        }
        targetReadable = true;
        observedChecked = afterState.isChecked;
        if (observedChecked === desired) {
          return { changed: true, verified: true, checked: desired, ref };
        }
      }

      return toolFailure(
        targetReadable
          ? `ref "${ref}" 接受了点击，但状态未变为 ${desired}`
          : `ref "${ref}" 接受了点击，但无法复查最终状态`,
        targetReadable ? 'SET_CHECKED_UNCHANGED' : 'SET_CHECKED_UNVERIFIED',
        {
          retryable: true,
          details: { actionAccepted: true, desired, observedChecked },
        },
      );
    });

    this.registry.register(phoneTool('write_note'), async (args) => {
      this.notes.set(String(args.key), String(args.value));
      return true;
    });

    this.registry.register(phoneTool('read_note'), async (args) => {
      const value = this.notes.get(String(args.key));
      return value !== undefined ? value : null;
    });

    // task_complete and task_failed are handled specially in the loop, but
    // register no-ops so registry.has() returns true for both.
    this.registry.register(phoneTool('task_complete'), async () => true);
    this.registry.register(phoneTool('task_failed'), async () => true);
  }

  private async readForegroundApp(
    inspect: () => Promise<{ packageName?: string; className?: string }>,
  ): Promise<{ packageName?: string; className?: string } | null> {
    return Promise.race([
      Promise.resolve().then(inspect).catch(() => null),
      this.deps.delay(FOREGROUND_QUERY_TIMEOUT_MS).then(() => null),
    ]);
  }

  /** Capture a fast MediaProjection frame for local action verification. */
  private async captureFastVisualFrame(): Promise<ScreenshotImage | undefined> {
    return withOverlaySuspendedForObservation(async (ctrl) => {
      if (
        typeof ctrl?.isMediaProjectionReady !== 'function' ||
        typeof ctrl.captureWithMediaProjection !== 'function'
      ) {
        return undefined;
      }
      const ready = await Promise.race([
        ctrl.isMediaProjectionReady().catch(() => false),
        this.deps.delay(300).then(() => false),
      ]);
      if (!ready) return undefined;
      return await Promise.race([
        ctrl.captureWithMediaProjection().catch(() => undefined),
        this.deps.delay(TAP_VISUAL_CAPTURE_TIMEOUT_MS).then(() => undefined),
      ]);
    }, SCREENSHOT_OVERLAY_SETTLE_MS, this.deps.delay);
  }

  /**
   * Build a model-only Set-of-Mark copy. Clean captures remain untouched and
   * continue to back local visual comparison. Annotation failure is a soft
   * fallback so disabling the switch is not the only recovery path.
   */
  private async annotateScreenshotForModel(
    image: ScreenshotImage,
    accessibilityTree: string,
    ocrElements: ScreenshotOcrElement[] = [],
  ): Promise<ScreenshotImage> {
    if (!this.screenshotNodeMarkersEnabled) return image;
    if (!image.path) return image;
    const accessibilityMarkers = parseScreenshotNodeMarkers(accessibilityTree).map((marker) => ({
      ...marker,
      kind: 'accessibility' as const,
    }));
    const imageWidth = positiveImageDimension(image.width);
    const imageHeight = positiveImageDimension(image.height);
    const ocrMarkers = imageWidth && imageHeight
      ? ocrElements.map((element) => ({
        ref: element.ref,
        kind: 'ocr' as const,
        bounds: {
          left: Math.round((element.bounds.left / 1000) * imageWidth),
          top: Math.round((element.bounds.top / 1000) * imageHeight),
          right: Math.round((element.bounds.right / 1000) * imageWidth),
          bottom: Math.round((element.bounds.bottom / 1000) * imageHeight),
        },
      })).filter((ocrMarker) => !accessibilityMarkers.some((accessibilityMarker) =>
        markerCoversMostOfTarget(accessibilityMarker.bounds, ocrMarker.bounds)))
      : [];
    const markers = [...accessibilityMarkers, ...ocrMarkers];
    if (markers.length === 0) return image;
    const ctrl = getController();
    if (typeof ctrl.annotateScreenshot !== 'function') return image;
    return await Promise.race([
      ctrl.annotateScreenshot(image.path, markers, image.width ?? 0, image.height ?? 0)
        .then((annotated) => ({
          ...image,
          ...annotated,
          width: positiveImageDimension(annotated.width) ?? image.width,
          height: positiveImageDimension(annotated.height) ?? image.height,
          mimeType: 'image/jpeg',
        }))
        .catch(() => image),
      this.deps.delay(1500).then(() => image),
    ]);
  }

  /** Cap only the inference attachment; screen geometry remains original. */
  private async resizeScreenshotForModel(image: ScreenshotImage): Promise<ScreenshotImage> {
    const maxEdge = 2000;
    const jpegQuality = 85;
    if (!this.screenshotDownscalingEnabled || !image.path) return image;
    const width = positiveImageDimension(image.width);
    const height = positiveImageDimension(image.height);
    if (!width || !height || Math.max(width, height) <= maxEdge) return image;
    const ctrl = getController();
    if (typeof ctrl.resizeScreenshotForModel !== 'function') return image;
    return await Promise.race([
      ctrl.resizeScreenshotForModel(image.path, maxEdge, jpegQuality)
        .then((resized) => ({
          ...image,
          ...resized,
          width: positiveImageDimension(resized.width) ?? image.width,
          height: positiveImageDimension(resized.height) ?? image.height,
          mimeType: 'image/jpeg',
        }))
        .catch(() => image),
      this.deps.delay(1500).then(() => image),
    ]);
  }

  private emitTimingDiagnostic(event: Record<string, unknown>): void {
    try {
      this.deps.onTimingDiagnostic?.(event);
    } catch {
      // Diagnostics must never affect screenshot execution.
    }
  }

  /** Run optional bundled OCR without making screenshot capture depend on it. */
  private async recognizeScreenshotTextForModel(
    image: ScreenshotImage,
  ): Promise<{
    elements?: ScreenshotOcrElement[];
    status?: 'unavailable' | 'timeout' | 'failed';
  }> {
    const ctrl = getController();
    if (!image.path || typeof ctrl.recognizeScreenshotText !== 'function') {
      return { status: 'unavailable' };
    }
    const result = await Promise.race([
      ctrl.recognizeScreenshotText(image.path)
        .then((value) => ({ kind: 'success' as const, value }))
        .catch(() => ({ kind: 'failed' as const })),
      this.deps.delay(2500).then(() => ({ kind: 'timeout' as const })),
    ]);
    if (result.kind === 'timeout') return { status: 'timeout' };
    if (result.kind === 'failed') return { status: 'failed' };
    return {
      elements: normalizeScreenshotOcrElements(
        result.value.elements,
        positiveImageDimension(result.value.imageWidth) ?? image.width,
        positiveImageDimension(result.value.imageHeight) ?? image.height,
      ),
    };
  }

  private rememberObservedRefs(serializedTree: string): void {
    this.observedRefTargets.clear();
    for (const target of parseObservedRefTargets(serializedTree)) {
      this.observedRefTargets.set(target.ref, { ...target, source: 'accessibility' });
    }
  }

  private rememberOcrRefs(
    observationId: string,
    elements: ScreenshotOcrElement[],
    imageWidth?: number,
    imageHeight?: number,
  ): void {
    if (!imageWidth || !imageHeight) return;
    for (const element of elements) {
      const bounds = {
        left: Math.round((element.bounds.left / 1000) * imageWidth),
        top: Math.round((element.bounds.top / 1000) * imageHeight),
        right: Math.round((element.bounds.right / 1000) * imageWidth),
        bottom: Math.round((element.bounds.bottom / 1000) * imageHeight),
      };
      this.observedRefTargets.set(element.ref, {
        ref: element.ref,
        bounds,
        label: element.text,
        resourceId: null,
        source: 'ocr',
        observationId,
        center: {
          x: Math.round((bounds.left + bounds.right) / 2),
          y: Math.round((bounds.top + bounds.bottom) / 2),
        },
      });
    }
  }

  private rememberUiObservation(
    kind: 'tree' | 'shot',
    explicitId?: string,
    width?: number,
    height?: number,
  ): string {
    const observationId = explicitId ?? `tree_${(++this.treeObservationSequence).toString(36)}`;
    this.activeUiObservations.set(observationId, {
      kind,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    });
    while (this.activeUiObservations.size > 16) {
      const oldest = this.activeUiObservations.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.activeUiObservations.delete(oldest);
    }
    return observationId;
  }

  private invalidateUiObservations(): void {
    this.activeUiObservations.clear();
    this.observedRefTargets.clear();
  }

  /** Capture one post-action evidence frame when no comparable fast baseline exists. */
  private async capturePostActionEvidence(): Promise<ScreenshotImage | undefined> {
    if (!this.deps.captureScreenshot) return undefined;
    try {
      return await withOverlaySuspendedForObservation(
        () => this.deps.captureScreenshot!(),
        SCREENSHOT_OVERLAY_SETTLE_MS,
        this.deps.delay,
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Verify that an accepted tap produced a meaningful UI transition. Native
   * ACTION_CLICK / gesture booleans only report dispatch acceptance; they do
   * not prove that the intended page opened. Accessibility structure remains
   * the cheapest signal; foreground state and a local down-sampled screenshot
   * comparison cover app switches and visual-only WebView/Canvas overlays.
   */
  private async verifyTapChangedScreen(
    beforeTree: unknown | undefined,
    beforeForeground: { packageName?: string; className?: string } | null,
    visualBaseline: ScreenshotImage | undefined,
  ): Promise<{
    screenChanged: boolean;
    method: string;
    status: 'verified_changed' | 'verified_unchanged' | 'accepted_unverified';
    elapsedMs: number;
    visualDifference?: {
      changedPixelRatio: number;
      changedTileRatio: number;
      meanDelta: number;
    };
    observationImage?: ScreenshotImage;
  }> {
    const ctrl = getController();
    const startedAt = Date.now();
    if (beforeTree !== undefined) {
      const before = createUiSnapshot(beforeTree);
      for (let attempt = 0; attempt < TAP_VERIFY_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await this.deps.delay(TAP_VERIFY_POLL_MS);
        try {
          const afterTree = await ctrl.getAccessibilityTree();
          if (hasMeaningfulUiChange(before, createUiSnapshot(afterTree))) {
            return {
              screenChanged: true,
              method: 'accessibility_tree',
              status: 'verified_changed',
              elapsedMs: Date.now() - startedAt,
            };
          }
        } catch {
          // A transient tree-read failure is not proof of progress; keep polling.
        }
      }
    }

    if (beforeForeground && typeof ctrl.getCurrentForegroundApp === 'function') {
      const afterForeground = await this.readForegroundApp(() => ctrl.getCurrentForegroundApp!());
      if (
        afterForeground &&
        (afterForeground.packageName !== beforeForeground.packageName ||
          afterForeground.className !== beforeForeground.className)
      ) {
        return {
          screenChanged: true,
          method: 'foreground_app',
          status: 'verified_changed',
          elapsedMs: Date.now() - startedAt,
        };
      }
    }

    let observationImage = await this.captureFastVisualFrame();
    if (
      visualBaseline?.path &&
      observationImage?.path &&
      typeof ctrl.compareScreenshotFiles === 'function'
    ) {
      const comparison = await Promise.race([
        ctrl.compareScreenshotFiles(visualBaseline.path, observationImage.path).catch(() => null),
        this.deps.delay(TAP_VISUAL_COMPARE_TIMEOUT_MS).then(() => null),
      ]);
      if (comparison) {
        const visualDifference = {
          changedPixelRatio: comparison.changedPixelRatio,
          changedTileRatio: comparison.changedTileRatio,
          meanDelta: comparison.meanDelta,
        };
        return {
          screenChanged: comparison.changed,
          method: 'visual_diff',
          status: comparison.changed ? 'verified_changed' : 'verified_unchanged',
          elapsedMs: Date.now() - startedAt,
          visualDifference,
        };
      }
    }

    // Without a comparable baseline, an unchanged accessibility tree cannot
    // disprove a visual-only WebView transition. Return the fresh frame as
    // evidence for the next model turn, but never claim progress or re-tap.
    observationImage ??= await this.capturePostActionEvidence();
    return {
      screenChanged: false,
      method: 'visual_unavailable',
      status: 'accepted_unverified',
      elapsedMs: Date.now() - startedAt,
      ...(observationImage ? { observationImage } : {}),
    };
  }

  private appLaunchState(
    requestedPackage: string,
    foreground: { packageName?: string; className?: string } | null,
    state: Omit<AppLaunchState, 'requestedPackage' | 'foregroundPackage' | 'activity'>,
  ): AppLaunchState {
    return {
      requestedPackage,
      foregroundPackage: foreground?.packageName ?? '',
      activity: foreground?.className ?? '',
      ...state,
    };
  }
}

// ---------------------------------------------------------------------------
// Accessibility tree helpers
// ---------------------------------------------------------------------------

/**
 * Structured result returned by find_node. `matchCount` is the total number
 * of nodes satisfying the query; tap independently checks how often the
 * returned ref itself occurs because different labels may share one id.
 */
type NodeQuery = {
  text?: string;
  contentDescription?: string;
  className?: string;
  resourceId?: string;
  isChecked?: boolean;
  isEnabled?: boolean;
};

type FindNodeResult = {
  ref: string | null;
  text: string;
  className: string;
  bounds: A11yNode['bounds'] | null;
  center: { x: number; y: number } | null;
  matchCount: number;
};

function findNodeInTree(tree: unknown, query: NodeQuery): FindNodeResult | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  const matches: Record<string, unknown>[] = [];
  gatherMatchingNodes(roots as Record<string, unknown>[], query, matches);
  const ranked = rankMatchingNodes(matches, query);
  const first = ranked[0];
  if (!first) return null;
  const bounds = validBounds(first.bounds);
  return {
    ref: typeof first.ref === 'string' ? first.ref : null,
    text: nodeLabel(first),
    className: typeof first.className === 'string' ? first.className : '',
    bounds,
    center: centerOf(bounds ?? undefined),
    matchCount: matches.length,
  };
}

function nodeQueryMatches(node: Record<string, unknown>, query: NodeQuery): boolean {
  const hasStringCriteria =
    query.text !== undefined ||
    query.contentDescription !== undefined ||
    query.className !== undefined ||
    query.resourceId !== undefined;
  const hasBoolCriteria =
    query.isChecked !== undefined || query.isEnabled !== undefined;

  if (!hasStringCriteria && !hasBoolCriteria) return false;

  if (hasStringCriteria) {
    const nodeText = typeof node.text === 'string' ? node.text : null;
    const nodeDesc = typeof node.contentDescription === 'string' ? node.contentDescription : null;
    const nodeCls = typeof node.className === 'string' ? node.className : null;
    const nodeResource = typeof node.resourceId === 'string' ? node.resourceId : null;
    const stringMatches =
      (query.text !== undefined && nodeText !== null && nodeText.includes(query.text)) ||
      (query.contentDescription !== undefined && nodeDesc !== null && nodeDesc.includes(query.contentDescription)) ||
      (query.className !== undefined && nodeCls === query.className) ||
      (query.resourceId !== undefined && nodeResource !== null &&
        (nodeResource === query.resourceId || nodeResource.endsWith(`/${query.resourceId}`)));
    if (!stringMatches) return false;
  }

  if (query.isChecked !== undefined && Boolean(node.isChecked) !== query.isChecked) return false;
  if (query.isEnabled !== undefined && Boolean(node.isEnabled) !== query.isEnabled) return false;

  return true;
}

function gatherMatchingNodes(
  nodes: Record<string, unknown>[],
  query: NodeQuery,
  matches: Record<string, unknown>[],
): void {
  for (const node of nodes) {
    if (nodeQueryMatches(node, query)) matches.push(node);

    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    gatherMatchingNodes(children, query, matches);
  }
}

function validBounds(value: unknown): NonNullable<A11yNode['bounds']> | null {
  if (!value || typeof value !== 'object') return null;
  const bounds = value as Record<string, unknown>;
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function nodeLabel(node: Record<string, unknown>): string {
  if (typeof node.text === 'string' && node.text.trim()) return node.text.trim();
  if (typeof node.contentDescription === 'string' && node.contentDescription.trim()) {
    return node.contentDescription.trim();
  }
  return '';
}

/**
 * Collect all matching nodes with enough metadata for the caller to choose
 * between duplicate text matches without issuing another ref lookup.
 */
function collectAllNodeDetails(tree: unknown, query: NodeQuery): Array<Record<string, unknown>> {
  const roots = Array.isArray(tree) ? tree : [tree];
  const matches: Record<string, unknown>[] = [];
  gatherMatchingNodes(roots as Record<string, unknown>[], query, matches);
  return rankMatchingNodes(matches, query)
    .flatMap((node) => {
      if (typeof node.ref !== 'string') return [];
      const bounds = validBounds(node.bounds);
      return [{
        ref: node.ref,
        text: typeof node.text === 'string' ? node.text : null,
        contentDescription: typeof node.contentDescription === 'string'
          ? node.contentDescription
          : null,
        resourceId: typeof node.resourceId === 'string' ? node.resourceId : null,
        className: typeof node.className === 'string' ? node.className : null,
        bounds,
        center: bounds
          ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
          : null,
        isClickable: Boolean(node.isClickable),
        isScrollable: Boolean(node.isScrollable),
        isEditable: Boolean(node.isEditable),
        isChecked: Boolean(node.isChecked),
        isEnabled: Boolean(node.isEnabled),
      }];
    });
}

/**
 * Keep substring matching as a fallback, but make the first result reflect
 * the most specific live node. Stable sort preserves tree/visual order among
 * candidates with the same specificity.
 */
function rankMatchingNodes(
  matches: Record<string, unknown>[],
  query: NodeQuery,
): Record<string, unknown>[] {
  return matches
    .map((node, order) => ({ node, order, score: nodeMatchSpecificity(node, query) }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(({ node }) => node);
}

function nodeMatchSpecificity(node: Record<string, unknown>, query: NodeQuery): number {
  const scores: number[] = [];
  if (query.text !== undefined && typeof node.text === 'string') {
    scores.push(stringMatchSpecificity(node.text, query.text));
  }
  if (query.contentDescription !== undefined && typeof node.contentDescription === 'string') {
    scores.push(stringMatchSpecificity(node.contentDescription, query.contentDescription));
  }
  if (query.resourceId !== undefined && typeof node.resourceId === 'string') {
    scores.push(node.resourceId === query.resourceId || node.resourceId.endsWith(`/${query.resourceId}`) ? 3 : 0);
  }
  if (query.className !== undefined && typeof node.className === 'string') {
    scores.push(node.className === query.className ? 3 : 0);
  }
  return scores.length > 0 ? Math.max(...scores) : 0;
}

function stringMatchSpecificity(value: string, query: string): number {
  if (value === query) return 3;
  if (value.startsWith(query)) return 2;
  if (value.includes(query)) return 1;
  return 0;
}

function findNodeRecordByRef(nodes: unknown[], ref: string): A11yNode | null {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const typed = node as A11yNode;
    if (typed.ref === ref) return typed;
    const found = findNodeRecordByRef(Array.isArray(typed.children) ? typed.children : [], ref);
    if (found) return found;
  }
  return null;
}

function nodeDetails(ref: string, info: LiveNodeRefInfo): Record<string, unknown> {
  const bounds = validBounds(info.bounds);
  return {
    ref,
    text: info.text ?? null,
    contentDescription: info.contentDescription ?? null,
    resourceId: info.resourceId ?? null,
    className: info.className ?? null,
    bounds,
    center: info.center ?? centerOf(bounds ?? undefined),
    isClickable: Boolean(info.isClickable),
    isScrollable: Boolean(info.isScrollable),
    isEditable: Boolean(info.isEditable),
    isFocused: Boolean(info.isFocused),
    isCheckable: Boolean(info.isCheckable),
    isChecked: Boolean(info.isChecked),
    isEnabled: Boolean(info.isEnabled),
  };
}

/**
 * Find a specific node by its ref and return its isChecked state.
 * Returns null if the node is not found.
 */
type CheckedNodeState = {
  isCheckable: boolean;
  isChecked: boolean;
  isEnabled: boolean;
};

function checkedStateFromLiveInfo(info: LiveNodeRefInfo): CheckedNodeState {
  return {
    isCheckable: info.isCheckable === true,
    isChecked: info.isChecked === true,
    isEnabled: info.isEnabled !== false,
  };
}

function getNodeCheckedStateByRef(tree: unknown, ref: string): CheckedNodeState | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  return findNodeCheckedState(roots as Record<string, unknown>[], ref);
}

function findNodeCheckedState(
  nodes: Record<string, unknown>[],
  ref: string,
): CheckedNodeState | null {
  for (const node of nodes) {
    if (node.ref === ref) {
      if (
        typeof node.isCheckable !== 'boolean' ||
        typeof node.isChecked !== 'boolean'
      ) return null;
      return {
        isCheckable: node.isCheckable,
        isChecked: node.isChecked,
        isEnabled: node.isEnabled !== false,
      };
    }
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    const found = findNodeCheckedState(children, ref);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Find the ref of the currently focused editable field in the accessibility tree.
 * Returns null if no focused editable node exists.
 */
function findFocusedEditableNode(tree: unknown): string | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  return searchFocusedEditable(roots as Record<string, unknown>[]);
}

/**
 * Opaque refs are issued by the native short-lived node registry.
 */
function isValidRef(ref: unknown): boolean {
  return typeof ref === 'string' && /^u[0-9a-z]+$/.test(ref);
}

/** Return every occurrence because Android apps frequently reuse resource IDs. */
function findElementsByRef(tree: unknown, ref: string): A11yNode[] {
  const roots = (Array.isArray(tree) ? tree : [tree]) as A11yNode[];
  const matches: A11yNode[] = [];
  gatherByRef(roots, ref, matches);
  return matches;
}

function gatherByRef(nodes: A11yNode[], ref: string, matches: A11yNode[]): void {
  for (const node of nodes) {
    if (node.ref === ref) matches.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    gatherByRef(children, ref, matches);
  }
}

/** Center of a bounds rect, rounded for gesture dispatch. */
/**
 * A node is a valid direct tap target only when Android exposes an actionable
 * semantic. Scroll-only/full-screen containers remain useful for scroll but
 * must not stand in for an unexposed child control (for example JD's search
 * box inside the root ViewPager).
 */
function isTapEligibleNode(node: A11yNode): boolean {
  if (node.isEnabled === false) return false;
  if (node.isClickable === true || node.isEditable === true) return true;
  const className = (node.className ?? '').toLowerCase();
  return /(button|edittext|checkbox|switch|radiobutton|spinner)/.test(className);
}

function centerOf(
  bounds?: { left: number; top: number; right: number; bottom: number },
): { x: number; y: number } | null {
  if (!bounds) return null;
  const { left, top, right, bottom } = bounds;
  if (right <= left || bottom <= top) return null;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

/** Select the tightest matching node containing a visual target point. */
function smallestNodeContainingPoint(nodes: A11yNode[], x: number, y: number): A11yNode | null {
  return nodes
    .filter((node) => {
      const bounds = node.bounds;
      return Boolean(
        bounds &&
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom,
      );
    })
    .sort((a, b) => {
      const aBounds = a.bounds!;
      const bBounds = b.bounds!;
      const aArea = (aBounds.right - aBounds.left) * (aBounds.bottom - aBounds.top);
      const bArea = (bBounds.right - bBounds.left) * (bBounds.bottom - bBounds.top);
      return aArea - bArea;
    })[0] ?? null;
}

type UiSnapshot = {
  structure: string[];
  semantics: string[];
  state: string[];
};

/** Build a privacy-local, deterministic tree snapshot for post-tap validation. */
function createUiSnapshot(tree: unknown): UiSnapshot {
  const snapshot: UiSnapshot = { structure: [], semantics: [], state: [] };
  const roots = (Array.isArray(tree) ? tree : [tree]) as A11yNode[];
  collectUiSnapshot(roots, snapshot);
  snapshot.structure.sort();
  snapshot.semantics.sort();
  snapshot.state.sort();
  return snapshot;
}

function collectUiSnapshot(nodes: A11yNode[], snapshot: UiSnapshot): void {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const bounds = node.bounds;
    const boundsKey = bounds
      ? [bounds.left, bounds.top, bounds.right, bounds.bottom]
          .map((value) => Math.round(value / 4) * 4)
          .join(',')
      : '';
    const identity = `${node.resourceId ?? node.ref ?? ''}|${node.className ?? ''}|${boundsKey}`;
    snapshot.structure.push([
      identity,
      node.isClickable === true ? 'c' : '',
      node.isEditable === true ? 'e' : '',
      node.isScrollable === true ? 's' : '',
    ].join('|'));
    snapshot.state.push([
      identity,
      node.isChecked === true ? 'checked' : 'unchecked',
      node.isFocused === true ? 'focused' : 'blurred',
      node.isEnabled === false ? 'disabled' : 'enabled',
    ].join('|'));
    const label = normalizeUiLabel(node.text || node.contentDescription || '');
    if (label) snapshot.semantics.push(`${identity}|${label}`);
    collectUiSnapshot(Array.isArray(node.children) ? node.children : [], snapshot);
  }
}

/** Normalize clocks, counters and progress values so they cannot fake progress. */
function normalizeUiLabel(value: string): string {
  return value
    .trim()
    .replace(/\d+(?:[.:/-]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

function hasMeaningfulUiChange(before: UiSnapshot, after: UiSnapshot): boolean {
  const structureDiff = multisetSymmetricDifference(before.structure, after.structure);
  const structureScale = Math.max(before.structure.length, after.structure.length, 1);
  if (structureDiff >= 4 && structureDiff / structureScale >= 0.15) return true;

  // Checked/focused/enabled transitions are meaningful even without a page
  // replacement (checkboxes, tabs and focused inputs are common tap targets).
  if (multisetSymmetricDifference(before.state, after.state) >= 2) return true;

  // Require at least two labels to be replaced. This rejects a lone changing
  // clock, lyric, counter or carousel caption while accepting page navigation.
  const semanticDiff = multisetSymmetricDifference(before.semantics, after.semantics);
  const semanticScale = Math.max(before.semantics.length, after.semantics.length, 1);
  return semanticDiff >= 4 && semanticDiff / semanticScale >= 0.25;
}

function multisetSymmetricDifference(left: string[], right: string[]): number {
  const counts = new Map<string, number>();
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of right) counts.set(value, (counts.get(value) ?? 0) - 1);
  let difference = 0;
  for (const count of counts.values()) difference += Math.abs(count);
  return difference;
}

export type ScreenshotNodeMarker = {
  ref: string;
  bounds: { left: number; top: number; right: number; bottom: number };
};

/**
 * Treat an OCR rectangle as a duplicate when an accessibility marker covers
 * most of that text line. Coverage is measured against the smaller OCR box,
 * rather than IoU, because a button or card commonly contains its text while
 * having a substantially larger hit area.
 */
function markerCoversMostOfTarget(
  marker: ScreenshotNodeMarker['bounds'],
  target: ScreenshotNodeMarker['bounds'],
): boolean {
  const intersectionWidth = Math.max(
    0,
    Math.min(marker.right, target.right) - Math.max(marker.left, target.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(marker.bottom, target.bottom) - Math.max(marker.top, target.top),
  );
  const targetArea = Math.max(0, target.right - target.left) * Math.max(0, target.bottom - target.top);
  if (targetArea === 0) return false;
  return (intersectionWidth * intersectionHeight) / targetArea >= 0.6;
}

export type ScreenshotOcrElement = {
  ref: string;
  text: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  center: { x: number; y: number };
};

function positiveImageDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * Convert native OCR rectangles into the same normalized coordinate space as
 * visual taps. Invalid, empty and duplicate lines are discarded to keep the
 * model payload bounded. OCR and accessibility targets share the model-facing
 * ref field; their execution sources remain distinct inside AgentToolkit.
 */
export function normalizeScreenshotOcrElements(
  elements: Array<{
    text: string;
    bounds: { left: number; top: number; right: number; bottom: number };
  }>,
  imageWidth: number | undefined,
  imageHeight: number | undefined,
): ScreenshotOcrElement[] {
  if (!imageWidth || !imageHeight) return [];
  const normalized = elements.flatMap((element) => {
    const text = typeof element.text === 'string' ? element.text.trim() : '';
    const bounds = element.bounds;
    if (!text || text.length > 160 || !bounds) return [];
    const physical = [bounds.left, bounds.top, bounds.right, bounds.bottom];
    if (!physical.every(Number.isFinite) || bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
      return [];
    }
    const left = Math.round((Math.max(0, bounds.left) / imageWidth) * 1000);
    const top = Math.round((Math.max(0, bounds.top) / imageHeight) * 1000);
    const right = Math.round((Math.min(imageWidth, bounds.right) / imageWidth) * 1000);
    const bottom = Math.round((Math.min(imageHeight, bounds.bottom) / imageHeight) * 1000);
    if (right <= left || bottom <= top) return [];
    return [{ text, bounds: { left, top, right, bottom } }];
  });
  normalized.sort((left, right) =>
    left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left);

  const seen = new Set<string>();
  const output: ScreenshotOcrElement[] = [];
  for (const element of normalized) {
    const key = `${element.text}\u0000${element.bounds.left},${element.bounds.top},${element.bounds.right},${element.bounds.bottom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      ref: `ocr_${output.length + 1}`,
      text: element.text,
      bounds: element.bounds,
      center: {
        x: Math.round((element.bounds.left + element.bounds.right) / 2),
        y: Math.round((element.bounds.top + element.bounds.bottom) / 2),
      },
    });
    if (output.length >= 80) break;
  }
  return output;
}

export type ObservedRefTarget = ScreenshotNodeMarker & {
  label: string | null;
  resourceId: string | null;
};

type CachedObservedRefTarget = ObservedRefTarget & (
  | { source: 'accessibility' }
  | {
      source: 'ocr';
      observationId: string;
      center: { x: number; y: number };
    }
);

/** Parse ref metadata used only to make loop fingerprints stable across observations. */
export function parseObservedRefTargets(serializedTree: string): ObservedRefTarget[] {
  const targets: ObservedRefTarget[] = [];
  const boundsPattern = /边界\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/;
  const refPattern = /(?:^|\s)ref=(u[0-9a-z]+)(?:\s|$)/;
  const resourcePattern = /(?:^|\s)resourceId=([^\s]+)/;
  const labelPattern = /^\[\d+\]\s+\S*\s+"(.*?)"\s+中心/;
  for (const line of serializedTree.split('\n')) {
    const boundsMatch = line.match(boundsPattern);
    const refMatch = line.match(refPattern);
    if (!boundsMatch || !refMatch) continue;
    const [left, top, right, bottom] = boundsMatch.slice(1).map(Number);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    targets.push({
      ref: refMatch[1],
      bounds: { left, top, right, bottom },
      label: line.match(labelPattern)?.[1] ?? null,
      resourceId: line.match(resourcePattern)?.[1] ?? null,
    });
  }
  return targets;
}

/** Extract actionable ref rectangles from ScreenSerializer's stable output. */
export function parseScreenshotNodeMarkers(serializedTree: string): ScreenshotNodeMarker[] {
  const candidates: Array<ScreenshotNodeMarker & { order: number; area: number }> = [];
  const seenBounds = new Set<string>();
  const boundsPattern = /边界\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/;
  const refPattern = /(?:^|\s)ref=(u[0-9a-z]+)(?:\s|$)/;
  const lines = serializedTree.split('\n');
  let viewportRight = 0;
  let viewportBottom = 0;

  for (const line of lines) {
    const boundsMatch = line.match(boundsPattern);
    if (!boundsMatch) continue;
    const [, , right, bottom] = boundsMatch.slice(1).map(Number);
    if (Number.isFinite(right)) viewportRight = Math.max(viewportRight, right);
    if (Number.isFinite(bottom)) viewportBottom = Math.max(viewportBottom, bottom);
  }

  for (const [order, line] of lines.entries()) {
    if ((!line.includes('可点击') && !line.includes('可编辑')) || line.includes('已禁用')) continue;
    const boundsMatch = line.match(boundsPattern);
    const refMatch = line.match(refPattern);
    if (!boundsMatch || !refMatch) continue;
    const [left, top, right, bottom] = boundsMatch.slice(1).map(Number);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    const width = right - left;
    const height = bottom - top;
    if (width < 8 || height < 8) continue;
    const area = width * height;
    if (
      viewportRight >= 480 && viewportBottom >= 800 &&
      width / viewportRight >= 0.8 &&
      height / viewportBottom >= 0.8 &&
      area / (viewportRight * viewportBottom) >= 0.7
    ) continue;
    const boundsKey = `${left},${top},${right},${bottom}`;
    if (seenBounds.has(boundsKey)) continue;
    seenBounds.add(boundsKey);
    candidates.push({ ref: refMatch[1], bounds: { left, top, right, bottom }, order, area });
  }

  // Prefer the smallest actionable rectangle when nested wrappers describe
  // effectively the same hit target, then restore screen traversal order.
  const selected: typeof candidates = [];
  for (const candidate of [...candidates].sort((left, right) => left.area - right.area || left.order - right.order)) {
    const duplicatesSelectedTarget = selected.some((other) => {
      const overlapWidth = Math.max(0,
        Math.min(candidate.bounds.right, other.bounds.right) - Math.max(candidate.bounds.left, other.bounds.left));
      const overlapHeight = Math.max(0,
        Math.min(candidate.bounds.bottom, other.bounds.bottom) - Math.max(candidate.bounds.top, other.bounds.top));
      const intersection = overlapWidth * overlapHeight;
      return intersection / Math.min(candidate.area, other.area) >= 0.9;
    });
    if (!duplicatesSelectedTarget) selected.push(candidate);
  }
  return selected
    .sort((left, right) => left.order - right.order)
    .map(({ ref, bounds }) => ({ ref, bounds }));
}

function searchFocusedEditable(nodes: Record<string, unknown>[]): string | null {
  for (const node of nodes) {
    if (node.isFocused === true && node.isEditable === true) {
      return typeof node.ref === 'string' ? node.ref : null;
    }
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    const found = searchFocusedEditable(children);
    if (found) return found;
  }
  return null;
}

/**
 * Find the ref of the first scrollable node in the accessibility tree.
 * Returns null if no scrollable node exists.
 */
function findFirstScrollableNode(tree: unknown): string | null {
  return collectScrollableNodes(tree)[0]?.ref ?? null;
}

type ScrollableNodeCandidate = {
  ref: string;
  className: string;
  bounds: A11yNode['bounds'] | null;
};

function collectScrollableNodes(tree: unknown): ScrollableNodeCandidate[] {
  const roots = Array.isArray(tree) ? tree : [tree];
  const candidates: ScrollableNodeCandidate[] = [];
  const seen = new Set<string>();
  gatherScrollableNodes(roots as Record<string, unknown>[], candidates, seen);
  return candidates;
}

function gatherScrollableNodes(
  nodes: Record<string, unknown>[],
  candidates: ScrollableNodeCandidate[],
  seen: Set<string>,
): void {
  for (const node of nodes) {
    if (node.isScrollable === true && typeof node.ref === 'string' && !seen.has(node.ref)) {
      seen.add(node.ref);
      candidates.push({
        ref: node.ref,
        className: typeof node.className === 'string' ? node.className : '',
        bounds: validBounds(node.bounds),
      });
    }
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    gatherScrollableNodes(children, candidates, seen);
  }
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

/** Largest visible bounds rect, used only when a WebView does not expose a
 * scrollable accessibility node. It supplies a safe viewport for a requested
 * page gesture without introducing an implicit UI observation in AgentLoop. */
function largestBoundsInTree(
  tree: unknown,
): { left: number; top: number; right: number; bottom: number } | null {
  const roots = (Array.isArray(tree) ? tree : [tree]) as Record<string, unknown>[];
  let largest: { left: number; top: number; right: number; bottom: number } | null = null;
  let largestArea = 0;
  const visit = (nodes: Record<string, unknown>[]) => {
    for (const node of nodes) {
      const bounds = validBounds(node.bounds);
      if (bounds) {
        const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
        if (area > largestArea) {
          largest = bounds;
          largestArea = area;
        }
      }
      if (Array.isArray(node.children)) {
        visit(node.children as Record<string, unknown>[]);
      }
    }
  };
  visit(roots);
  return largest;
}

/** Build a bounded scroll gesture. Android scroll directions describe the
 * content direction, so browsing down injects an upward finger gesture. */
function scrollGesture(
  viewport: { left: number; top: number; right: number; bottom: number },
  direction: string,
  distanceRatio: number,
): { startX: number; startY: number; endX: number; endY: number } {
  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  const centerX = Math.round(viewport.left + width / 2);
  const centerY = Math.round(viewport.top + height / 2);
  const high = 0.9;
  const low = Math.max(0.1, high - distanceRatio);
  const leftX = Math.round(viewport.left + width * low);
  const rightX = Math.round(viewport.left + width * high);
  const topY = Math.round(viewport.top + height * low);
  const bottomY = Math.round(viewport.top + height * high);
  switch (direction) {
    case 'up':
      return { startX: centerX, startY: topY, endX: centerX, endY: bottomY };
    case 'left':
      return { startX: leftX, startY: centerY, endX: rightX, endY: centerY };
    case 'right':
      return { startX: rightX, startY: centerY, endX: leftX, endY: centerY };
    case 'down':
    default:
      return { startX: centerX, startY: bottomY, endX: centerX, endY: topY };
  }
}

/**
 * Find a specific node by its ref and return its bounds.
 * Returns null if the node is not found or has no bounds.
 */
function getBoundsByRef(
  tree: unknown,
  ref: string,
): { left: number; top: number; right: number; bottom: number } | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  return findNodeBounds(roots as Record<string, unknown>[], ref);
}

function findNodeBounds(
  nodes: Record<string, unknown>[],
  ref: string,
): { left: number; top: number; right: number; bottom: number } | null {
  for (const node of nodes) {
    if (node.ref === ref) {
      const b = node.bounds as Record<string, unknown> | undefined;
      if (b && typeof b.left === 'number' && typeof b.top === 'number' &&
          typeof b.right === 'number' && typeof b.bottom === 'number') {
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      }
      return null;
    }
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    const found = findNodeBounds(children, ref);
    if (found !== null) return found;
  }
  return null;
}
