import {
  backboneScript,
  clickScript,
  collectItemsScript,
  executeJavaScriptScript,
  fetchResourceScript,
  findElementsScript,
  getReadableScript,
  getTextScript,
  hoverScript,
  pageInfoScript,
  scrollScript,
  stabilityFingerprintScript,
  typeScript,
} from './BrowserScripts';
import {
  BROWSER_ACTIONS,
  canonicalBrowserAction,
  type BrowserCookie,
  type BrowserHostAdapter,
  type BrowserObservationResult,
  type BrowserResultData,
  type BrowserToolArgs,
  type CanonicalBrowserAction,
} from './BrowserTypes';
import type { ScreenshotImage } from '../device-agent/types';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_FULL_PAGE_HEIGHT = 32_768;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeBrowserUrl(raw: string): string {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('无效网址'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('浏览器仅允许 http/https 地址');
  const host = url.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host === '::1' || host === '0.0.0.0' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost) throw new Error('为保护本地网络，不能访问回环或私有地址');
  return url.toString();
}

function timeoutOf(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(500, Math.min(MAX_TIMEOUT_MS, Math.round(value as number)));
}

function keywordList(value?: string[] | string): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return typeof value === 'string' ? value.split(/\s+/).map((v) => v.trim()).filter(Boolean) : [];
}

function parseCookies(value?: BrowserCookie[] | string): BrowserCookie[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as BrowserCookie[] : [];
  } catch { return []; }
}

function safeFilename(url: string, mime: string): string {
  const pathName = new URL(url).pathname.split('/').pop() || 'resource';
  const cleaned = pathName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'resource';
  if (cleaned.includes('.')) return cleaned;
  const ext = mime.includes('json') ? '.json' : mime.includes('html') ? '.html' :
    mime.includes('png') ? '.png' : mime.includes('jpeg') ? '.jpg' : '.bin';
  return `${cleaned}${ext}`;
}

function cookieDomainAllowed(host: string, domain?: string): boolean {
  if (!domain) return true;
  const normalized = domain.replace(/^\./, '').toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

type NativeBrowserState = {
  getBrowserCookies?: (url: string) => Promise<string>;
  setBrowserCookies?: (url: string, cookies: BrowserCookie[]) => Promise<number>;
  captureBrowserView?: (reactTag: number) => Promise<ScreenshotImage>;
};

function nativeBrowserState(): NativeBrowserState {
  try {
    return (require('react-native') as { NativeModules?: { DeftAgentModule?: NativeBrowserState } })
      .NativeModules?.DeftAgentModule ?? {};
  } catch { return {}; }
}

function fileSystem(): typeof import('expo-file-system/legacy') {
  return require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
}

export class BrowserSessionController {
  private adapter: BrowserHostAdapter | null = null;

  attach(adapter: BrowserHostAdapter): () => void {
    this.adapter = adapter;
    return () => { if (this.adapter === adapter) this.adapter = null; };
  }

  /** Hide the in-app browser window without discarding tabs or page state. */
  dismiss(): void {
    this.adapter?.hide();
  }

  private host(): BrowserHostAdapter {
    if (!this.adapter) throw new Error('内置浏览器尚未就绪，请稍后重试');
    return this.adapter;
  }

  private result(
    action: CanonicalBrowserAction,
    tabId: number,
    payload: Record<string, unknown> = {},
  ): BrowserObservationResult {
    const host = this.host();
    const meta = host.getMeta(tabId);
    return {
      ok: true,
      data: { action, tab_id: tabId, pageURL: meta.url, ...payload },
    };
  }

  private fromEvaluation(
    action: CanonicalBrowserAction,
    tabId: number,
    evaluated: unknown,
    untrusted = true,
  ): BrowserObservationResult {
    if (evaluated && typeof evaluated === 'object' && (evaluated as { ok?: unknown }).ok === false) {
      const error = evaluated as { error?: string; message?: string };
      return {
        ok: false,
        error: error.message || error.error || '网页操作失败',
        hint: error.error === 'element_not_found' ? '重新调用 find_elements 或 get_backbone 获取当前元素引用。' : undefined,
      };
    }
    return this.result(action, tabId, {
      ...(untrusted ? { contentTrust: 'untrusted_web_content' } : {}),
      result: evaluated,
    });
  }

  async execute(args: Record<string, unknown>): Promise<BrowserObservationResult> {
    const input = args as unknown as BrowserToolArgs;
    if (!BROWSER_ACTIONS.includes(input.action)) return { ok: false, error: '不支持的浏览器操作' };
    const action = canonicalBrowserAction(input.action);
    const host = this.host();
    const timeoutMs = timeoutOf(input.timeoutMs ?? input.timeout);
    const tabId = input.tab_id ?? host.getSelectedTabId();

    try {
      switch (action) {
        case 'navigate': {
          if (!input.url?.trim()) return { ok: false, error: 'navigate 需要 url' };
          const page = await host.navigate(normalizeBrowserUrl(input.url), timeoutMs, tabId);
          return this.result(action, tabId, { page });
        }
        case 'get_page_info':
          return this.fromEvaluation(action, tabId, await host.evaluate(pageInfoScript(), timeoutMs, tabId));
        case 'get_text':
          return this.fromEvaluation(action, tabId, await host.evaluate(getTextScript(input.selector), timeoutMs, tabId));
        case 'get_readable':
          return this.fromEvaluation(action, tabId, await host.evaluate(getReadableScript(), timeoutMs, tabId));
        case 'find_elements':
          return this.fromEvaluation(action, tabId, await host.evaluate(findElementsScript(input.query, input.selector), timeoutMs, tabId));
        case 'get_backbone':
          return this.fromEvaluation(action, tabId, await host.evaluate(backboneScript(input.max_depth), timeoutMs, tabId));
        case 'click': {
          if (!input.ref && !input.selector && (!Number.isFinite(input.coordinate_x) || !Number.isFinite(input.coordinate_y))) {
            return { ok: false, error: 'click 需要 ref、selector 或 coordinate_x/coordinate_y' };
          }
          return this.fromEvaluation(action, tabId, await host.evaluate(
            clickScript(input.ref, input.selector, input.coordinate_x, input.coordinate_y), timeoutMs, tabId,
          ));
        }
        case 'type': {
          if (!input.ref && !input.selector) return { ok: false, error: 'type 需要 ref 或 selector' };
          if (typeof input.text !== 'string') return { ok: false, error: 'type 需要 text' };
          return this.fromEvaluation(action, tabId, await host.evaluate(typeScript(input.text, input.ref, input.selector), timeoutMs, tabId));
        }
        case 'hover': {
          if (!input.ref && !input.selector) return { ok: false, error: 'hover 需要 ref 或 selector' };
          return this.fromEvaluation(action, tabId, await host.evaluate(hoverScript(input.ref, input.selector), timeoutMs, tabId));
        }
        case 'scroll': {
          const amount = Math.max(100, Math.min(4000, Math.round(input.amount ?? 500)));
          return this.fromEvaluation(action, tabId, await host.evaluate(
            scrollScript(input.direction ?? 'down', amount, input.selector), timeoutMs, tabId,
          ));
        }
        case 'scroll_and_collect':
          return await this.scrollAndCollect(input, tabId, timeoutMs);
        case 'wait_for_dom_stable':
          return await this.waitForStable(tabId, timeoutMs);
        case 'execute_js': {
          if (!input.script?.trim()) return { ok: false, error: 'execute_js 需要 script' };
          return this.fromEvaluation(action, tabId, await host.evaluate(executeJavaScriptScript(input.script), timeoutMs, tabId));
        }
        case 'screenshot':
          return await this.captureScreenshot(tabId, input.full_page === true);
        case 'new_tab': {
          const tab = await host.newTab(input.url ? normalizeBrowserUrl(input.url) : undefined, timeoutMs);
          return this.result(action, tab.id, { tab, tabs: host.listTabs() });
        }
        case 'close_tab': {
          const tabs = await host.closeTab(input.tab_id);
          const selected = host.getSelectedTabId();
          return this.result(action, selected, { tabs });
        }
        case 'list_tabs': {
          const selected = host.getSelectedTabId();
          return this.result(action, selected, { tabs: host.listTabs() });
        }
        case 'set_user_agent': {
          if (!input.user_agent) return { ok: false, error: 'set_user_agent 需要 user_agent' };
          const page = await host.setUserAgent(input.user_agent, tabId);
          return this.result(action, tabId, { user_agent: input.user_agent, page });
        }
        case 'set_viewport': {
          if (input.reset) {
            const page = await host.setViewport(null, tabId);
            return this.result(action, tabId, { reset: true, page });
          }
          if (!Number.isFinite(input.viewport_width) || !Number.isFinite(input.viewport_height)) {
            return { ok: false, error: 'set_viewport 需要 viewport_width 和 viewport_height，或 reset=true' };
          }
          const viewport = {
            width: Math.max(320, Math.min(3840, Math.round(input.viewport_width as number))),
            height: Math.max(320, Math.min(3840, Math.round(input.viewport_height as number))),
          };
          const page = await host.setViewport(viewport, tabId);
          return this.result(action, tabId, { viewport, page });
        }
        case 'fetch':
          return await this.fetchResource(input.url, tabId, timeoutMs);
        case 'get_cookies':
          return await this.getCookies(input, tabId);
        case 'set_cookies':
          return await this.setCookies(input, tabId);
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async waitForStable(tabId: number, timeoutMs: number): Promise<BrowserObservationResult> {
    const host = this.host();
    const started = Date.now();
    let previous = '';
    let stableCount = 0;
    let latest: unknown = null;
    while (Date.now() - started < timeoutMs) {
      latest = await host.evaluate(stabilityFingerprintScript(), Math.min(timeoutMs, 5_000), tabId);
      const fingerprint = JSON.stringify(latest);
      stableCount = fingerprint === previous ? stableCount + 1 : 0;
      if (stableCount >= 2) return this.result('wait_for_dom_stable', tabId, { stable: true, elapsedMs: Date.now() - started, state: latest });
      previous = fingerprint;
      await delay(350);
    }
    return { ok: false, error: '页面在超时前仍未稳定', hint: `最后状态: ${JSON.stringify(latest).slice(0, 500)}` };
  }

  private async scrollAndCollect(input: BrowserToolArgs, tabId: number, timeoutMs: number): Promise<BrowserObservationResult> {
    if (!input.item_selector?.trim()) return { ok: false, error: 'scroll_and_collect 需要 item_selector' };
    const host = this.host();
    const count = Math.max(1, Math.min(20, Math.round(input.scroll_count ?? 10)));
    const amount = Math.max(100, Math.min(4000, Math.round(input.amount ?? 600)));
    const unique = new Map<string, { text: string; html: string }>();
    let lastScroll: unknown = null;
    for (let i = 0; i <= count; i++) {
      const collected = await host.evaluate(
        collectItemsScript(input.item_selector, keywordList(input.keywords)), timeoutMs, tabId,
      ) as { ok?: boolean; items?: Array<{ text: string; html: string }>; error?: string };
      if (collected.ok === false) return { ok: false, error: collected.error ?? '采集失败' };
      for (const item of collected.items ?? []) unique.set(item.text, item);
      if (i === count) break;
      lastScroll = await host.evaluate(scrollScript(input.direction ?? 'down', amount, input.selector), timeoutMs, tabId);
      if (lastScroll && typeof lastScroll === 'object' && (lastScroll as { moved?: boolean }).moved === false) break;
      await delay(200);
    }
    return this.result('scroll_and_collect', tabId, {
      contentTrust: 'untrusted_web_content',
      count: unique.size,
      items: [...unique.values()].slice(0, 200),
      lastScroll,
    });
  }

  private async captureScreenshot(tabId: number, fullPage: boolean): Promise<BrowserObservationResult> {
    const host = this.host();
    host.selectTab(tabId);
    host.show();
    await delay(150);
    const originalViewport = host.getViewport(tabId);
    let fullPageMeta: Record<string, unknown> = {};
    let stretched = false;
    try {
      if (fullPage) {
        const dimensions = await host.evaluate(`(() => ({
          width: Math.max(320, Math.ceil(window.innerWidth || document.documentElement.clientWidth || 0)),
          height: Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0),
        }))()`, 5_000, tabId) as { width?: number; height?: number };
        const originalHeight = Math.max(0, Math.round(Number(dimensions?.height) || 0));
        if (originalHeight > 0) {
          const height = Math.min(MAX_FULL_PAGE_HEIGHT, originalHeight);
          const width = Math.max(320, Math.min(3840, Math.round(Number(dimensions?.width) || 0)));
          await host.evaluate(`(() => { document.querySelectorAll('img[loading="lazy"]').forEach((img) => img.loading='eager'); return true; })()`, 5_000, tabId).catch(() => null);
          await host.setViewport({ width, height }, tabId);
          stretched = true;
          await delay(100);
          fullPageMeta = { originalHeight, truncated: originalHeight > height };
        }
      }
      const native = nativeBrowserState();
      const viewTag = host.getViewTag(tabId);
      let capturedArea = 'screen_viewport';
      let shot = viewTag != null && native.captureBrowserView
        ? await native.captureBrowserView(viewTag).catch(() => null)
        : null;
      if (shot) capturedArea = 'webview';
      if (!shot) {
        const controller = require('react-native-accessibility-controller') as {
          takeScreenshot?: () => Promise<ScreenshotImage>;
        };
        shot = await controller.takeScreenshot?.() ?? null;
      }
      if (!shot?.path && !shot?.base64) return { ok: false, error: '浏览器截图失败' };
      return {
        ...this.result('screenshot', tabId, {
          path: shot.path,
          mimeType: shot.mimeType ?? 'image/png',
          requestedFullPage: fullPage,
          capturedArea: stretched ? 'full_page_webview' : capturedArea,
          ...fullPageMeta,
        }),
        observationImage: { ...shot, mimeType: shot.mimeType ?? 'image/png' },
      };
    } catch (error) {
      return { ok: false, error: `浏览器截图失败：${error instanceof Error ? error.message : String(error)}` };
    } finally {
      if (stretched) await host.setViewport(originalViewport, tabId).catch(() => undefined);
    }
  }

  private async fetchResource(urlValue: string | undefined, tabId: number, timeoutMs: number): Promise<BrowserObservationResult> {
    if (!urlValue?.trim()) return { ok: false, error: 'fetch 需要 url' };
    const url = normalizeBrowserUrl(urlValue);
    const fetched = await this.host().evaluate(fetchResourceScript(url, MAX_FETCH_BYTES), timeoutMs, tabId) as {
      ok?: boolean; error?: string; message?: string; base64?: string; mime?: string; size?: number; status?: number; url?: string;
    };
    if (fetched.ok === false || !fetched.base64) return { ok: false, error: fetched.message || fetched.error || '资源获取失败' };
    const fs = fileSystem();
    const dir = `${fs.cacheDirectory ?? ''}browser-downloads/`;
    await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const name = `${Date.now()}-${safeFilename(fetched.url ?? url, fetched.mime ?? '')}`;
    const path = `${dir}${name}`;
    await fs.writeAsStringAsync(path, fetched.base64, { encoding: fs.EncodingType.Base64 });
    return this.result('fetch', tabId, {
      status: fetched.status,
      url: fetched.url ?? url,
      mime: fetched.mime,
      size: fetched.size,
      path,
    });
  }

  private async getCookies(input: BrowserToolArgs, tabId: number): Promise<BrowserObservationResult> {
    const meta = this.host().getMeta(tabId);
    if (!meta.url) return { ok: false, error: '当前标签页尚未打开站点' };
    const native = nativeBrowserState();
    const raw = native.getBrowserCookies
      ? await native.getBrowserCookies(meta.url)
      : String(await this.host().evaluate('document.cookie||""', 5_000, tabId));
    const words = keywordList(input.keywords).map((v) => v.toLowerCase());
    const fuzzy = input.fuzzy !== false;
    const cookies = raw.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=');
      return { name: index >= 0 ? part.slice(0, index) : part, value: index >= 0 ? part.slice(index + 1) : '' };
    }).filter(({ name }) => words.length === 0 || (fuzzy
      ? words.every((word) => name.toLowerCase().includes(word))
      : words.some((word) => name.toLowerCase() === word)));
    return { ...this.result('get_cookies', tabId, { count: cookies.length, cookies }), sensitive: true };
  }

  private async setCookies(input: BrowserToolArgs, tabId: number): Promise<BrowserObservationResult> {
    const cookies = parseCookies(input.cookies);
    if (cookies.length === 0) return { ok: false, error: 'set_cookies 需要 cookies 数组' };
    const meta = this.host().getMeta(tabId);
    if (!meta.url) return { ok: false, error: '当前标签页尚未打开站点' };
    const hostName = new URL(meta.url).hostname.toLowerCase();
    if (cookies.some((cookie) => !cookie.name || typeof cookie.value !== 'string' || !cookieDomainAllowed(hostName, cookie.domain))) {
      return { ok: false, error: 'Cookie 缺少 name/value 或 domain 不属于当前站点' };
    }
    const native = nativeBrowserState();
    let count = 0;
    if (native.setBrowserCookies) {
      count = await native.setBrowserCookies(meta.url, cookies);
    } else {
      for (const cookie of cookies) {
        const pieces = [`${cookie.name}=${cookie.value}`, `path=${cookie.path ?? '/'}`];
        if (cookie.domain) pieces.push(`domain=${cookie.domain}`);
        if (cookie.secure) pieces.push('secure');
        if (cookie.expires) pieces.push(`expires=${new Date(cookie.expires * 1000).toUTCString()}`);
        await this.host().evaluate(`document.cookie=${JSON.stringify(pieces.join('; '))}`, 5_000, tabId);
        count++;
      }
    }
    return { ...this.result('set_cookies', tabId, { written: count }), sensitive: true };
  }
}

export const browserSession = new BrowserSessionController();
