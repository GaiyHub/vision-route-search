import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeModules, StyleSheet, Text, TouchableOpacity, View, findNodeHandle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { WebViewSource } from 'react-native-webview/lib/WebViewTypes';
import { browserSession, normalizeBrowserUrl } from './BrowserSession';
import type {
  BrowserHostAdapter,
  BrowserPageMeta,
  BrowserTabMeta,
  BrowserViewport,
} from './BrowserTypes';

interface PendingEvaluation {
  tabId: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingNavigation {
  resolve: (meta: BrowserPageMeta) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  target: string;
  started: boolean;
}

interface BridgeMessage {
  channel?: string;
  id?: string;
  ok?: boolean;
  value?: unknown;
  error?: string;
}

interface HostTab {
  id: number;
  source: WebViewSource;
  meta: BrowserPageMeta;
  userAgent: 'desktop_chrome' | 'mobile_chrome';
  viewport: BrowserViewport | null;
  generation: number;
}

const HOME_HTML = '<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:28px;color:#374151"><h2>豆泡浏览器</h2><p>网页工具启动后，页面将在这里显示。</p></body>';
const MAX_TABS = 3;
const DEFAULT_BROWSER_FULLSCREEN = false;
const USER_AGENTS = {
  desktop_chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  mobile_chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
} as const;

function blankTab(id: number): HostTab {
  return {
    id,
    source: { html: HOME_HTML },
    meta: { url: '', title: '豆泡浏览器', loading: false },
    userAgent: 'desktop_chrome',
    viewport: null,
    generation: 0,
  };
}

function bringHostToForeground(): void {
  try {
    const controller = require('react-native-accessibility-controller') as {
      bringHostAppToForeground?: () => Promise<boolean>;
    };
    void controller.bringHostAppToForeground?.().catch(() => false);
  } catch {
    const native = NativeModules.DeftAgentModule as { bringToForeground?: () => Promise<boolean> } | undefined;
    void native?.bringToForeground?.().catch(() => false);
  }
}

function isAllowedNavigation(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    normalizeBrowserUrl(url);
    return true;
  } catch {
    return false;
  }
}

export function BrowserHost() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [tabs, setTabs] = useState<HostTab[]>(() => [blankTab(0)]);
  const tabsRef = useRef(tabs);
  const [selectedTabId, setSelectedTabIdState] = useState(0);
  const selectedTabIdRef = useRef(0);
  const webViewRefs = useRef(new Map<number, WebView | null>());
  const evaluations = useRef(new Map<string, PendingEvaluation>());
  const navigations = useRef(new Map<number, PendingNavigation>());
  const readyWaiters = useRef(new Map<number, Array<() => void>>());
  const idCounter = useRef(0);
  const nextTabId = useRef(1);
  const [visible, setVisible] = useState(false);
  const [fullscreen, setFullscreen] = useState(DEFAULT_BROWSER_FULLSCREEN);

  const updateTabs = useCallback((fn: (current: HostTab[]) => HostTab[]) => {
    setTabs((current) => {
      const next = fn(current);
      tabsRef.current = next;
      return next;
    });
  }, []);

  const setSelectedTabId = useCallback((id: number) => {
    selectedTabIdRef.current = id;
    setSelectedTabIdState(id);
  }, []);

  const resolveTabId = useCallback((requested?: number): number => {
    const id = requested ?? selectedTabIdRef.current;
    if (!tabsRef.current.some((tab) => tab.id === id)) throw new Error(`标签页不存在: ${id}`);
    return id;
  }, []);

  const tabMeta = useCallback((tab: HostTab): BrowserTabMeta => ({
    id: tab.id,
    selected: tab.id === selectedTabIdRef.current,
    ...tab.meta,
  }), []);

  const show = useCallback(() => {
    bringHostToForeground();
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    setFullscreen(DEFAULT_BROWSER_FULLSCREEN);
  }, []);

  const waitForRef = useCallback((tabId: number, timeoutMs: number): Promise<void> => {
    if (webViewRefs.current.get(tabId)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`标签页 ${tabId} 初始化超时`)), timeoutMs);
      const done = () => { clearTimeout(timer); resolve(); };
      const list = readyWaiters.current.get(tabId) ?? [];
      list.push(done);
      readyWaiters.current.set(tabId, list);
    });
  }, []);

  const setRef = useCallback((tabId: number, ref: WebView | null) => {
    webViewRefs.current.set(tabId, ref);
    if (ref) {
      const waiters = readyWaiters.current.get(tabId) ?? [];
      readyWaiters.current.delete(tabId);
      waiters.forEach((resolve) => resolve());
    }
  }, []);

  const navigate = useCallback((url: string, timeoutMs: number, requestedTabId?: number) => {
    const tabId = resolveTabId(requestedTabId);
    show();
    setSelectedTabId(tabId);
    const existing = navigations.current.get(tabId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.reject(new Error('浏览器开始了新的导航'));
      navigations.current.delete(tabId);
    }
    return new Promise<BrowserPageMeta>((resolve, reject) => {
      const timer = setTimeout(() => {
        navigations.current.delete(tabId);
        reject(new Error(`页面加载超时（${timeoutMs}ms）`));
      }, timeoutMs);
      navigations.current.set(tabId, { resolve, reject, timer, target: url, started: false });
      updateTabs((current) => current.map((tab) => tab.id === tabId
        ? { ...tab, source: { uri: url }, meta: { ...tab.meta, url, loading: true } }
        : tab));
    });
  }, [resolveTabId, setSelectedTabId, show, updateTabs]);

  const evaluate = useCallback(async (script: string, timeoutMs: number, requestedTabId?: number) => {
    const tabId = resolveTabId(requestedTabId);
    show();
    setSelectedTabId(tabId);
    await waitForRef(tabId, Math.min(timeoutMs, 5_000));
    const id = `eval-${Date.now()}-${++idCounter.current}`;
    const wrapped = `(() => { const send=(ok,value,error)=>window.ReactNativeWebView.postMessage(JSON.stringify({channel:'deft-browser',id:${JSON.stringify(id)},ok,value,error})); try { Promise.resolve(${script}).then(v=>send(true,v),e=>send(false,null,String(e&&e.message||e))); } catch(e) { send(false,null,String(e&&e.message||e)); } })(); true;`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        evaluations.current.delete(id);
        reject(new Error(`网页操作超时（${timeoutMs}ms）`));
      }, timeoutMs);
      evaluations.current.set(id, { tabId, resolve, reject, timer });
      webViewRefs.current.get(tabId)?.injectJavaScript(wrapped);
    });
  }, [resolveTabId, setSelectedTabId, show, waitForRef]);

  const getMeta = useCallback((requestedTabId?: number) => {
    const id = resolveTabId(requestedTabId);
    return tabsRef.current.find((tab) => tab.id === id)!.meta;
  }, [resolveTabId]);

  const selectTab = useCallback((tabId: number) => {
    const id = resolveTabId(tabId);
    setSelectedTabId(id);
    show();
    return tabsRef.current.find((tab) => tab.id === id)!.meta;
  }, [resolveTabId, setSelectedTabId, show]);

  const listTabs = useCallback(() => tabsRef.current.map(tabMeta), [tabMeta]);

  const newTab = useCallback(async (url: string | undefined, timeoutMs: number) => {
    if (tabsRef.current.length >= MAX_TABS) throw new Error(`最多只能打开 ${MAX_TABS} 个标签页`);
    const id = nextTabId.current++;
    const tab = blankTab(id);
    tabsRef.current = [...tabsRef.current, tab];
    setTabs(tabsRef.current);
    setSelectedTabId(id);
    show();
    await waitForRef(id, Math.min(timeoutMs, 5_000));
    if (url) await navigate(url, timeoutMs, id);
    return tabMeta(tabsRef.current.find((candidate) => candidate.id === id)!);
  }, [navigate, setSelectedTabId, show, tabMeta, waitForRef]);

  const closeTab = useCallback(async (requestedTabId?: number) => {
    const id = resolveTabId(requestedTabId);
    const pending = navigations.current.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('标签页已关闭'));
      navigations.current.delete(id);
    }
    for (const [key, evalPending] of evaluations.current) {
      if (evalPending.tabId !== id) continue;
      clearTimeout(evalPending.timer);
      evalPending.reject(new Error('标签页已关闭'));
      evaluations.current.delete(key);
    }
    let next = tabsRef.current.filter((tab) => tab.id !== id);
    if (next.length === 0) next = [blankTab(nextTabId.current++)];
    tabsRef.current = next;
    setTabs(next);
    webViewRefs.current.delete(id);
    if (!next.some((tab) => tab.id === selectedTabIdRef.current)) setSelectedTabId(next[0].id);
    return next.map(tabMeta);
  }, [resolveTabId, setSelectedTabId, tabMeta]);

  const setUserAgent = useCallback(async (
    profile: 'desktop_chrome' | 'mobile_chrome',
    requestedTabId?: number,
  ) => {
    const id = resolveTabId(requestedTabId);
    updateTabs((current) => current.map((tab) => tab.id === id
      ? { ...tab, userAgent: profile, generation: tab.generation + 1 }
      : tab));
    await waitForRef(id, 5_000);
    return getMeta(id);
  }, [getMeta, resolveTabId, updateTabs, waitForRef]);

  const setViewport = useCallback(async (viewport: BrowserViewport | null, requestedTabId?: number) => {
    const id = resolveTabId(requestedTabId);
    updateTabs((current) => current.map((tab) => tab.id === id ? { ...tab, viewport } : tab));
    return getMeta(id);
  }, [getMeta, resolveTabId, updateTabs]);

  const adapter = useMemo<BrowserHostAdapter>(() => ({
    show, hide, navigate, evaluate, getMeta,
    getSelectedTabId: () => selectedTabIdRef.current,
    getViewTag: (tabId?: number) => {
      try { return findNodeHandle(webViewRefs.current.get(resolveTabId(tabId)) ?? null); }
      catch { return null; }
    },
    getViewport: (tabId?: number) => tabsRef.current.find((tab) => tab.id === resolveTabId(tabId))?.viewport ?? null,
    selectTab, newTab, closeTab, listTabs, setUserAgent, setViewport,
  }), [closeTab, evaluate, getMeta, hide, listTabs, navigate, newTab, resolveTabId, selectTab, setUserAgent, setViewport, show]);

  useEffect(() => browserSession.attach(adapter), [adapter]);

  useEffect(() => () => {
    for (const pending of evaluations.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('浏览器已关闭'));
    }
    evaluations.current.clear();
    for (const pending of navigations.current.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('浏览器已关闭'));
    }
    navigations.current.clear();
  }, []);

  const onMessage = useCallback((tabId: number, event: WebViewMessageEvent) => {
    let message: BridgeMessage;
    try { message = JSON.parse(event.nativeEvent.data) as BridgeMessage; } catch { return; }
    if (message.channel !== 'deft-browser' || !message.id) return;
    const pending = evaluations.current.get(message.id);
    if (!pending || pending.tabId !== tabId) return;
    clearTimeout(pending.timer);
    evaluations.current.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error || '网页脚本执行失败'));
  }, []);

  const onNavigationStateChange = useCallback((tabId: number, state: WebViewNavigation) => {
    const next = { url: state.url, title: state.title || state.url || '豆泡浏览器', loading: state.loading };
    updateTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, meta: next } : tab));
    const pending = navigations.current.get(tabId);
    if (!state.loading && pending?.started) {
      clearTimeout(pending.timer);
      navigations.current.delete(tabId);
      pending.resolve(next);
    }
  }, [updateTabs]);

  const onLoadStart = useCallback((tabId: number, url: string) => {
    updateTabs((current) => current.map((tab) => tab.id === tabId
      ? { ...tab, meta: { ...tab.meta, url, loading: true } }
      : tab));
    const pending = navigations.current.get(tabId);
    if (pending && (url === pending.target || !pending.started)) pending.started = true;
  }, [updateTabs]);

  const onLoadError = useCallback((tabId: number, description: string) => {
    updateTabs((current) => current.map((tab) => tab.id === tabId
      ? { ...tab, meta: { ...tab.meta, loading: false } }
      : tab));
    const pending = navigations.current.get(tabId);
    if (!pending) return;
    clearTimeout(pending.timer);
    navigations.current.delete(tabId);
    pending.reject(new Error(description || `无法加载 ${pending.target}`));
  }, [updateTabs]);

  const selectedTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];
  const selectedRef = webViewRefs.current.get(selectedTab?.id ?? 0);
  const compactScale = 1 / Math.sqrt(8);
  const previousCompactHeight = Math.max(320, Math.min(480, windowHeight * 0.58));
  const compactWidth = (windowWidth - 24) * compactScale;
  const compactHeight = previousCompactHeight * compactScale;
  const compactTop = Math.max(insets.top + 64, (windowHeight - compactHeight) / 2);

  return (
    <View
      pointerEvents={visible ? (fullscreen ? 'auto' : 'box-none') : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
      style={[styles.hostLayer, !visible && styles.hidden]}
    >
      <View
        pointerEvents="auto"
        style={[
          styles.browserSurface,
          fullscreen
            ? styles.fullscreenSurface
            : [styles.compactSurface, {
                top: compactTop,
                width: compactWidth,
                height: compactHeight,
              }],
        ]}
      >
        <View style={[
          styles.toolbar,
          !fullscreen && styles.compactToolbar,
          { paddingTop: fullscreen ? Math.max(insets.top, 8) : 6 },
        ]}>
          {fullscreen ? (
            <>
              <View style={styles.navButtons}>
                <TouchableOpacity accessibilityLabel="后退" style={styles.navButton} onPress={() => selectedRef?.goBack()}><Text style={styles.navText}>‹</Text></TouchableOpacity>
                <TouchableOpacity accessibilityLabel="前进" style={styles.navButton} onPress={() => selectedRef?.goForward()}><Text style={styles.navText}>›</Text></TouchableOpacity>
                <TouchableOpacity accessibilityLabel="刷新" style={styles.navButton} onPress={() => selectedRef?.reload()}><Text style={styles.reloadText}>↻</Text></TouchableOpacity>
              </View>
              <View style={styles.addressWrap}>
                <Text numberOfLines={1} style={styles.title}>{selectedTab?.meta.loading ? '加载中…' : selectedTab?.meta.title}</Text>
                <Text numberOfLines={1} style={styles.url}>#{selectedTab?.id} · {selectedTab?.meta.url || '内置浏览器'}</Text>
              </View>
            </>
          ) : (
            <Text numberOfLines={1} style={styles.compactTitle}>
              {selectedTab?.meta.loading ? '加载中…' : selectedTab?.meta.title || '浏览器'}
            </Text>
          )}
          <TouchableOpacity
            accessibilityLabel={fullscreen ? '退出全屏' : '全屏浏览器'}
            style={[styles.modeButton, !fullscreen && styles.compactButton]}
            onPress={() => setFullscreen((current) => !current)}
          >
            <Text style={styles.modeText}>{fullscreen ? '小窗' : '全屏'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="关闭浏览器"
            style={[styles.closeButton, !fullscreen && styles.compactCloseButton]}
            onPress={hide}
          >
            <Text style={styles.closeText}>{fullscreen ? '关闭' : '×'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.webViews}>
          {tabs.map((tab) => {
            const isSelected = tab.id === selectedTabId;
            const viewportStyle = tab.viewport
              ? { width: tab.viewport.width, height: tab.viewport.height, alignSelf: 'flex-start' as const }
              : undefined;
            return (
              <View key={`${tab.id}-${tab.generation}`} pointerEvents={isSelected ? 'auto' : 'none'} style={[styles.webViewLayer, !isSelected && styles.inactiveTab, viewportStyle]}>
                <WebView
                  ref={(ref) => setRef(tab.id, ref)}
                  source={tab.source}
                  style={styles.webView}
                  userAgent={USER_AGENTS[tab.userAgent]}
                  onMessage={(event) => onMessage(tab.id, event)}
                  onLoadStart={(event) => onLoadStart(tab.id, event.nativeEvent.url)}
                  onNavigationStateChange={(state) => onNavigationStateChange(tab.id, state)}
                  onError={(event) => onLoadError(tab.id, event.nativeEvent.description)}
                  onHttpError={(event) => onLoadError(tab.id, `HTTP ${event.nativeEvent.statusCode}`)}
                  onShouldStartLoadWithRequest={(request) => isAllowedNavigation(request.url)}
                  javaScriptEnabled
                  domStorageEnabled
                  sharedCookiesEnabled
                  thirdPartyCookiesEnabled
                  allowsBackForwardNavigationGestures
                  setSupportMultipleWindows={false}
                  originWhitelist={['http://*', 'https://*', 'about:blank']}
                />
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hostLayer: { ...StyleSheet.absoluteFillObject, zIndex: 10000, elevation: 10000 },
  hidden: { opacity: 0 },
  browserSurface: { position: 'absolute', backgroundColor: '#fff', overflow: 'hidden' },
  fullscreenSurface: { ...StyleSheet.absoluteFillObject },
  compactSurface: {
    right: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 18,
  },
  toolbar: { minHeight: 64, paddingHorizontal: 10, paddingBottom: 8, backgroundColor: '#F8FAFC', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#CBD5E1', flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactToolbar: { minHeight: 38, paddingHorizontal: 5, paddingBottom: 6, gap: 3 },
  navButtons: { flexDirection: 'row', gap: 2 },
  navButton: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  navText: { color: '#334155', fontSize: 30, lineHeight: 31 },
  reloadText: { color: '#334155', fontSize: 21 },
  addressWrap: { flex: 1, minWidth: 0, backgroundColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  title: { color: '#0F172A', fontSize: 12, fontWeight: '600' },
  url: { color: '#64748B', fontSize: 10, marginTop: 1 },
  compactTitle: { flex: 1, minWidth: 0, color: '#334155', fontSize: 9, fontWeight: '600' },
  modeButton: { paddingHorizontal: 4, paddingVertical: 8 },
  compactButton: { paddingHorizontal: 2, paddingVertical: 5 },
  modeText: { color: '#334155', fontSize: 12, fontWeight: '600' },
  closeButton: { paddingHorizontal: 4, paddingVertical: 8 },
  compactCloseButton: { paddingHorizontal: 3, paddingVertical: 3 },
  closeText: { color: '#059669', fontSize: 13, fontWeight: '600' },
  webViews: { flex: 1, overflow: 'hidden' },
  webViewLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff' },
  inactiveTab: { opacity: 0 },
  webView: { flex: 1, backgroundColor: '#fff' },
});
