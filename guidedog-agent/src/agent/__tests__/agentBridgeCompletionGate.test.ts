const mockReturnToPreviousApp = jest.fn<Promise<boolean>, [string]>();
const mockGetCurrentForegroundApp = jest.fn();
const mockGetLastForegroundApp = jest.fn();
const mockBringHostAppToForeground = jest.fn(() => Promise.resolve(true));
const mockShowRiskConfirmOverlay = jest.fn<
  Promise<void>,
  [string, string, string?]
>(() => Promise.resolve());
const mockCancelRiskConfirmOverlay = jest.fn(() => Promise.resolve());
const mockShowTextInputOverlay = jest.fn<Promise<void>, [Record<string, unknown>]>(
  () => Promise.resolve(),
);
const mockCancelTextInputOverlay = jest.fn(() => Promise.resolve());
const mockBrowserDismiss = jest.fn();
const mockSpeakText = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

jest.mock('react-native-accessibility-controller', () => ({
  getCurrentForegroundApp: () => mockGetCurrentForegroundApp(),
  getLastForegroundApp: () => mockGetLastForegroundApp(),
  returnToPreviousApp: (pkg: string) => mockReturnToPreviousApp(pkg),
  bringHostAppToForeground: () => mockBringHostAppToForeground(),
  showRiskConfirmOverlay: (action: string, risk: string, reason?: string) =>
    mockShowRiskConfirmOverlay(action, risk, reason),
  cancelRiskConfirmOverlay: () => mockCancelRiskConfirmOverlay(),
  showTextInputOverlay: (config: Record<string, unknown>) => mockShowTextInputOverlay(config),
  cancelTextInputOverlay: () => mockCancelTextInputOverlay(),
}), { virtual: true });

const eventListeners = new Map<string, (payload: unknown) => void>();
jest.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: jest.fn() },
  DeviceEventEmitter: {
    addListener: (name: string, listener: (payload: unknown) => void) => {
      eventListeners.set(name, listener);
      return { remove: jest.fn() };
    },
  },
  NativeModules: {},
  Vibration: { vibrate: jest.fn() },
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'Light' },
  impactAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('../foregroundService', () => ({
  cancelPendingNotification: jest.fn(),
  cancelRiskConfirmNotification: jest.fn(),
  completeForegroundService: jest.fn(),
  showCompletionNotification: jest.fn(),
  showRiskConfirmNotification: jest.fn(),
  startForegroundService: jest.fn(),
  startHeartbeat: jest.fn(),
  stopForegroundService: jest.fn(),
  stopHeartbeat: jest.fn(),
  updateForegroundService: jest.fn(),
}));
jest.mock('../llmBridge', () => ({ getGenerateFn: jest.fn(), getGenerateWithImageFn: jest.fn() }));
jest.mock('../otelLogger', () => ({
  beginTrace: () => 'trace', endTrace: jest.fn(), startSpan: () => 'span',
  endSpan: jest.fn(), logEvent: jest.fn(),
}));
jest.mock('../../store/taskLogger', () => ({
  beginTaskLog: jest.fn(), appendTaskLog: jest.fn(), flushTaskLog: jest.fn(),
}));
jest.mock('../todoFileStore', () => ({
  beginTodoFile: jest.fn(), finalizeTodoFile: jest.fn(), saveTodos: jest.fn(),
}));
jest.mock('../watchdogBridge', () => ({ setAgentBusy: jest.fn() }));
jest.mock('../../browser', () => ({
  browserSession: { dismiss: mockBrowserDismiss },
  createBrowserToolRegistrations: jest.fn(() => []),
}));
jest.mock('../../shell', () => ({
  SHELL_EXECUTE_TOOL: { name: 'shell_execute' },
  createShellExecuteHandler: jest.fn(() => jest.fn()),
}));
jest.mock('../../voice/voiceBridge', () => ({
  speakText: (text: string) => mockSpeakText(text),
}));

import {
  AGENT_SYSTEM_PROMPT,
  ASK_USER_TOOL,
  beginCompletionSupplement,
  buildAskUserTool,
  buildConfirmTool,
  recordTaskToolDispatch,
  rejectCompletion,
  requestCompletionDecision,
  resetTaskInteractionKind,
  returnToCompletionDecision,
  submitCompletionSupplement,
} from '../agentBridge';
import { submitUserClarification } from '../../store/clarificationStore';
import {
  cancelPendingNotification,
  cancelRiskConfirmNotification,
  showCompletionNotification,
  showRiskConfirmNotification,
} from '../foregroundService';
import { agentStopped, getAgentState } from '../../store/agentStore';
import * as settingsStore from '../../store/settingsStore';

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('agentBridge completion gate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    resetTaskInteractionKind();
    agentStopped();
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native').AppState.currentState = 'background';
    mockGetCurrentForegroundApp.mockResolvedValue({ packageName: 'com.example.target' });
    mockGetLastForegroundApp.mockResolvedValue({ packageName: 'com.example.last' });
    mockReturnToPreviousApp.mockResolvedValue(true);
    mockShowTextInputOverlay.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('routes execution-backed informational work to tools without tool-filtering ordinary answers', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('运行在 Android 设备上的能力完备的通用 AI 助手');
    expect(AGENT_SYSTEM_PROMPT).toContain('既不默认调用工具，也不回避必要的工具调用');
    expect(AGENT_SYSTEM_PROMPT).toContain('仅对不依赖当前时间、外部状态或现实对象可用性的稳定事实直接回答');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('仅凭已有知识和上下文能够准确、可靠地回答时');
    expect(AGENT_SYSTEM_PROMPT).toContain('需要实时信息、精确计算、数据转换');
    expect(AGENT_SYSTEM_PROMPT).toContain('严格依据真实返回结果决定下一步');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('只使用当前实际提供的观察工具');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('不确定是否需要视觉信息时，优先使用轻量的结构观察');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('任务本身明确依赖视觉信息');
    expect(AGENT_SYSTEM_PROMPT).toContain('如果下一步依赖该操作的实际效果，必须通过新的界面观察');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('成本更低的观察方式');
    expect(AGENT_SYSTEM_PROMPT).toContain('accepted=true、dispatched=true 或 effect=unknown 均不能证明页面已变化');
    expect(AGENT_SYSTEM_PROMPT).toContain('ui_inspect');
    expect(AGENT_SYSTEM_PROMPT).toContain('ui_screenshot');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('不要先用返回键');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('## 意图路由');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('## 操作任务工作循环');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('直接回答类意图');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('不要调用任何工具');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('## 需求澄清');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('只能由用户提供');
    expect(AGENT_SYSTEM_PROMPT).not.toContain('执行路径或风险');
  });

  it('returns an ask_user overlay answer as a tool result without switching apps', async () => {
    expect(ASK_USER_TOOL.description).toContain('只能由用户提供');
    expect(ASK_USER_TOOL.description).toContain('仅有多种执行方式时不得调用');
    const gate = buildAskUserTool().handler({
      question: '你想发送给谁？',
      placeholder: '联系人',
    });
    await flushPromises();
    expect(mockShowTextInputOverlay).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '你想发送给谁？',
      placeholder: '联系人',
    }));
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    const requestId = mockShowTextInputOverlay.mock.calls[0][0].requestId as string;
    eventListeners.get('overlay-text-input')?.({ requestId, action: 'submit', text: '妈妈' });
    await expect(gate).resolves.toEqual({
      ok: true,
      answered: true,
      answer: '妈妈',
      message: '用户已补充信息，请据此继续当前任务',
    });
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
    expect(mockCancelTextInputOverlay).toHaveBeenCalled();
  });

  it('falls back to the host editor when ask_user overlay input is unavailable', async () => {
    mockShowTextInputOverlay.mockRejectedValueOnce(new Error('overlay unavailable'));
    const gate = buildAskUserTool().handler({ question: '你想发送给谁？' });
    await flushPromises();

    expect(mockBringHostAppToForeground).toHaveBeenCalledTimes(1);
    expect(submitUserClarification('妈妈')).toEqual({ ok: true });
    await expect(gate).resolves.toMatchObject({ answered: true, answer: '妈妈' });
    expect(mockReturnToPreviousApp).toHaveBeenCalledWith('com.example.target');
  });

  it('speaks a clarification question once when TTS is enabled', async () => {
    jest.spyOn(settingsStore, 'getSettings').mockReturnValue({
      ...settingsStore.getSettings(),
      ttsEnabled: true,
      voiceMode: false,
    });
    const gate = buildAskUserTool().handler({ question: '请告诉我收件人的姓名' });
    await flushPromises();

    expect(mockSpeakText).toHaveBeenCalledTimes(1);
    expect(mockSpeakText).toHaveBeenCalledWith('需要你补充信息。请告诉我收件人的姓名');

    expect(submitUserClarification('妈妈')).toEqual({ ok: true });
    await expect(gate).resolves.toMatchObject({ answered: true, answer: '妈妈' });
  });

  it('keeps a host-originated ask_user answer in the host app', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native').AppState.currentState = 'active';
    const gate = buildAskUserTool().handler({ question: '还需要什么信息？' });
    await flushPromises();

    expect(mockGetCurrentForegroundApp).not.toHaveBeenCalled();
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    expect(submitUserClarification('补充内容')).toEqual({ ok: true });
    await expect(gate).resolves.toMatchObject({
      ok: true,
      answered: true,
      answer: '补充内容',
    });
    expect(mockGetLastForegroundApp).not.toHaveBeenCalled();
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });

  it('shows risk confirmation in the overlay without foregrounding the host app', async () => {
    const gate = buildConfirmTool().handler({
      action: '发送短信给妈妈',
      risk: 'high',
      reason: '  会向外部联系人\u0000发送\n真实消息\uD800  ',
    });
    await flushPromises();

    expect(mockShowRiskConfirmOverlay).toHaveBeenCalledWith(
      '发送短信给妈妈',
      'high',
      '会向外部联系人 发送 真实消息�',
    );
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    expect(showRiskConfirmNotification).not.toHaveBeenCalled();

    eventListeners.get('onOverlayRiskDecision')?.({ decision: 'execute' });
    await expect(gate).resolves.toMatchObject({ confirmed: true, denied: false });
    expect(mockCancelRiskConfirmOverlay).toHaveBeenCalled();
    expect(cancelRiskConfirmNotification).toHaveBeenCalled();
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });

  it('speaks risk-confirmation content once when voice mode enables TTS', async () => {
    jest.spyOn(settingsStore, 'getSettings').mockReturnValue({
      ...settingsStore.getSettings(),
      ttsEnabled: false,
      voiceMode: true,
    });
    const gate = buildConfirmTool().handler({
      action: '删除测试订单',
      risk: 'high',
      reason: '删除后无法恢复',
    });
    await flushPromises();

    expect(mockSpeakText).toHaveBeenCalledTimes(1);
    expect(mockSpeakText).toHaveBeenCalledWith(
      '需要你的确认。高风险操作：删除测试订单。风险说明：删除后无法恢复',
    );

    eventListeners.get('onOverlayRiskDecision')?.({ decision: 'reject' });
    await expect(gate).resolves.toMatchObject({ confirmed: false, denied: true });
  });

  it('does not speak user gates when speech output is disabled', async () => {
    const gate = buildAskUserTool().handler({ question: '请补充测试信息' });
    await flushPromises();

    expect(mockSpeakText).not.toHaveBeenCalled();
    expect(submitUserClarification('测试答案')).toEqual({ ok: true });
    await expect(gate).resolves.toMatchObject({ answered: true });
  });

  it('keeps the operated app foreground when completion is accepted on the overlay', async () => {
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();
    expect(getAgentState().completionPending?.phase).toBe('decision');
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    expect(showCompletionNotification).not.toHaveBeenCalled();
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await expect(gate).resolves.toBe('complete');
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });

  it.each(['ui_find_node', 'wait', 'todo_update'])('skips completion UI after only %s', async (tool) => {
    recordTaskToolDispatch(tool);
    await expect(requestCompletionDecision('answer')).resolves.toBe('complete');
    expect(getAgentState().completionPending).toBeNull();
    expect(showCompletionNotification).not.toHaveBeenCalled();
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    expect(mockGetCurrentForegroundApp).not.toHaveBeenCalled();
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });

  it('requires completion UI after an interactive browser action', async () => {
    recordTaskToolDispatch('browser_navigate', { url: 'https://example.com' });
    const gate = requestCompletionDecision('answer');
    await flushPromises();
    expect(getAgentState().completionPending?.phase).toBe('decision');
    expect(showCompletionNotification).not.toHaveBeenCalled();
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await expect(gate).resolves.toBe('complete');
    expect(mockBrowserDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the browser window open when the user continues execution', async () => {
    recordTaskToolDispatch('browser_navigate', { url: 'https://example.com' });
    const gate = requestCompletionDecision('answer');
    await flushPromises();

    eventListeners.get('completion-decision')?.({ decision: 'reject' });

    await expect(gate).resolves.toEqual({
      continue: '用户确认任务尚未完成：answer。请继续完成剩余步骤。',
    });
    expect(mockBrowserDismiss).not.toHaveBeenCalled();
  });

  it('requires completion UI after user clarification', async () => {
    recordTaskToolDispatch('ask_user', { question: '你想发送给谁？' });
    const gate = requestCompletionDecision('answer');
    await flushPromises();
    expect(showCompletionNotification).not.toHaveBeenCalled();
    expect(getAgentState().completionPending?.phase).toBe('decision');
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await expect(gate).resolves.toBe('complete');
  });

  it('requires completion UI after risk confirmation', async () => {
    recordTaskToolDispatch('confirm_action', { operation: '发送消息' });
    const gate = requestCompletionDecision('answer');
    await flushPromises();
    expect(showCompletionNotification).not.toHaveBeenCalled();
    expect(getAgentState().completionPending?.phase).toBe('decision');
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await expect(gate).resolves.toBe('complete');
  });

  it('uses the recent external app fallback for a later supplement but keeps continue in place', async () => {
    recordTaskToolDispatch('open_app');
    mockGetCurrentForegroundApp.mockResolvedValue({ packageName: '' });
    const gate = requestCompletionDecision('not quite');
    await flushPromises();
    rejectCompletion('not quite');
    await expect(gate).resolves.toEqual({
      continue: '用户确认任务尚未完成：not quite。请继续完成剩余步骤。',
    });
    expect(mockGetLastForegroundApp).toHaveBeenCalled();
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });

  it('pauses both timeouts in supplement mode and settles once with trimmed text', async () => {
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();
    eventListeners.get('completion-decision')?.({ decision: 'supplement' });
    await flushPromises();
    expect(getAgentState().completionPending?.phase).toBe('supplement');
    expect(cancelPendingNotification).toHaveBeenCalled();
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();
    expect(mockShowTextInputOverlay).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '请补充需要豆泡继续处理的信息',
      fallbackLabel: '返回',
    }));

    // A queued tap from the dismissed binary notification/overlay must not
    // bypass the required text submission.
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    eventListeners.get('completion-decision')?.({ decision: 'reject' });
    expect(getAgentState().completionPending?.phase).toBe('supplement');

    await jest.advanceTimersByTimeAsync(120_000);
    expect(getAgentState().completionPending?.phase).toBe('supplement');

    const requestId = mockShowTextInputOverlay.mock.calls[0][0].requestId as string;
    eventListeners.get('overlay-text-input')?.({
      requestId,
      action: 'submit',
      text: 'add this',
    });
    await expect(gate).resolves.toEqual({
      continue: 'add this',
    });
    expect(getAgentState().completionPending).toBeNull();
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });

  it('falls back to the host editor when completion overlay input is unavailable', async () => {
    mockShowTextInputOverlay.mockRejectedValueOnce(new Error('overlay unavailable'));
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();

    eventListeners.get('completion-decision')?.({ decision: 'supplement' });
    await flushPromises();
    expect(getAgentState().completionPending?.phase).toBe('supplement');
    expect(mockBringHostAppToForeground).toHaveBeenCalledTimes(1);

    expect(submitCompletionSupplement('继续处理')).toEqual({ ok: true });
    await expect(gate).resolves.toEqual({ continue: '继续处理' });
    expect(mockReturnToPreviousApp).toHaveBeenCalledWith('com.example.target');
  });

  it('preserves the external hand-back across a repeated inline supplement transition', async () => {
    let finishReturn!: (ok: boolean) => void;
    mockReturnToPreviousApp.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finishReturn = resolve;
    }));
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();

    beginCompletionSupplement();
    // Simulates a delayed host render that still sees the decision phase.
    beginCompletionSupplement({ foregroundHost: false });
    expect(submitCompletionSupplement('continue')).toEqual({ ok: true });
    await flushPromises();

    let settled = false;
    void gate.then(() => { settled = true; });
    await flushPromises();
    expect(mockReturnToPreviousApp).toHaveBeenCalledWith('com.example.target');
    expect(settled).toBe(false);

    finishReturn(true);
    await expect(gate).resolves.toEqual({
      continue: 'continue',
    });
  });

  it('returns an inline main-input supplement to its captured external app', async () => {
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();

    beginCompletionSupplement({ foregroundHost: false });
    expect(getAgentState().completionPending?.phase).toBe('supplement');
    expect(mockBringHostAppToForeground).not.toHaveBeenCalled();

    expect(submitCompletionSupplement('more context')).toEqual({ ok: true });
    await expect(gate).resolves.toEqual({
      continue: 'more context',
    });
    expect(mockReturnToPreviousApp).toHaveBeenCalledWith('com.example.target');
  });

  it('restarts a fresh timeout after returning from supplement', async () => {
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();
    beginCompletionSupplement();
    expect(mockBringHostAppToForeground).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(59_000);
    returnToCompletionDecision();
    expect(showCompletionNotification).not.toHaveBeenCalled();
    expect(mockReturnToPreviousApp).toHaveBeenCalledWith('com.example.target');
    await jest.advanceTimersByTimeAsync(59_000);
    expect(getAgentState().completionPending?.phase).toBe('decision');
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(gate).resolves.toBe('complete');
  });

  it('rejects empty and oversized supplements without settling', async () => {
    recordTaskToolDispatch('ui_tap');
    const gate = requestCompletionDecision('done');
    await flushPromises();
    beginCompletionSupplement();
    expect(submitCompletionSupplement('  ')).toEqual({ ok: false, error: 'empty' });
    expect(submitCompletionSupplement('x'.repeat(2001))).toEqual({ ok: false, error: 'too_long' });
    expect(getAgentState().completionPending?.phase).toBe('supplement');
    submitCompletionSupplement('ok');
    await gate;
  });

  it('recaptures every round and returns only for an external-origin supplement', async () => {
    recordTaskToolDispatch('ui_tap');
    mockGetCurrentForegroundApp.mockResolvedValueOnce({ packageName: 'com.example.first' });
    const first = requestCompletionDecision('first');
    await flushPromises();
    beginCompletionSupplement();
    submitCompletionSupplement('more');
    await first;

    mockGetCurrentForegroundApp.mockResolvedValueOnce({ packageName: 'com.example.second' });
    const second = requestCompletionDecision('second');
    await flushPromises();
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await second;
    expect(mockReturnToPreviousApp).toHaveBeenCalledTimes(1);
    expect(mockReturnToPreviousApp).toHaveBeenCalledWith('com.example.first');

    resetTaskInteractionKind();
    const freshTask = requestCompletionDecision('fresh');
    await flushPromises();
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await freshTask;
    expect(mockReturnToPreviousApp).toHaveBeenCalledTimes(1);
  });

  it('settles normally when target resolution and return fail', async () => {
    recordTaskToolDispatch('ui_tap');
    mockGetCurrentForegroundApp.mockRejectedValue(new Error('unavailable'));
    mockGetLastForegroundApp.mockResolvedValue({ packageName: '' });
    const gate = requestCompletionDecision('done');
    await flushPromises();
    eventListeners.get('completion-decision')?.({ decision: 'complete' });
    await expect(gate).resolves.toBe('complete');
    expect(mockReturnToPreviousApp).not.toHaveBeenCalled();
  });
});
