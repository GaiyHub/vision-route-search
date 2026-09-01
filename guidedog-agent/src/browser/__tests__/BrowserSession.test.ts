import { BrowserSessionController, normalizeBrowserUrl } from '../BrowserSession';
import type { BrowserHostAdapter } from '../BrowserTypes';

function mockHost(): BrowserHostAdapter & {
  show: jest.Mock;
  navigate: jest.Mock;
  evaluate: jest.Mock;
} {
  let selected = 0;
  let tabs = [{ id: 0, selected: true, url: '', title: '', loading: false }];
  return {
    show: jest.fn(),
    hide: jest.fn(),
    navigate: jest.fn(async (url: string) => ({ url, title: 'Example', loading: false })),
    evaluate: jest.fn(async () => ({ ok: true })),
    getMeta: () => ({ url: '', title: '', loading: false }),
    getSelectedTabId: () => selected,
    getViewTag: () => null,
    getViewport: () => null,
    selectTab: jest.fn((id: number) => {
      selected = id;
      return { url: '', title: '', loading: false };
    }),
    newTab: jest.fn(async (url?: string) => {
      const id = tabs.length;
      selected = id;
      tabs = [...tabs.map((tab) => ({ ...tab, selected: false })), { id, selected: true, url: url ?? '', title: '', loading: false }];
      return tabs[tabs.length - 1];
    }),
    closeTab: jest.fn(async (id?: number) => {
      tabs = tabs.filter((tab) => tab.id !== (id ?? selected));
      selected = tabs[0]?.id ?? 0;
      return tabs;
    }),
    listTabs: () => tabs,
    setUserAgent: jest.fn(async () => ({ url: '', title: '', loading: false })),
    setViewport: jest.fn(async () => ({ url: '', title: '', loading: false })),
  };
}

describe('normalizeBrowserUrl', () => {
  it('adds https and accepts public http(s) URLs', () => {
    expect(normalizeBrowserUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://10.0.0.2',
    'http://192.168.1.1',
    'http://172.16.0.1',
  ])('blocks unsafe or private address %s', (url) => {
    expect(() => normalizeBrowserUrl(url)).toThrow();
  });
});

describe('BrowserSessionController', () => {
  it('requires a mounted host', async () => {
    await expect(new BrowserSessionController().execute({ action: 'page_info' }))
      .rejects.toThrow('尚未就绪');
  });

  it('dismisses the browser window while preserving the session', () => {
    const session = new BrowserSessionController();
    const host = mockHost();
    session.attach(host);

    session.dismiss();

    expect(host.hide).toHaveBeenCalledTimes(1);
    expect(host.closeTab).not.toHaveBeenCalled();
  });

  it('navigates and preserves legacy readable aliases', async () => {
    const session = new BrowserSessionController();
    const host = mockHost();
    const detach = session.attach(host);

    await expect(session.execute({ action: 'navigate', url: 'example.com' })).resolves.toMatchObject({
      ok: true,
      data: { action: 'navigate', tab_id: 0 },
    });
    expect(host.navigate).toHaveBeenCalledWith('https://example.com/', 15_000, 0);

    await session.execute({ action: 'read_page' });
    expect(host.evaluate.mock.calls[0][0]).toContain('candidate');
    detach();
  });

  it('requires a discovered ref or selector for interaction', async () => {
    const session = new BrowserSessionController();
    session.attach(mockHost());
    await expect(session.execute({ action: 'click' })).resolves.toMatchObject({ ok: false });
    await expect(session.execute({ action: 'type', ref: 'b1' })).resolves.toMatchObject({ ok: false });
  });

  it('marks page-derived output as untrusted', async () => {
    const session = new BrowserSessionController();
    session.attach(mockHost());
    await expect(session.execute({ action: 'read_page' })).resolves.toMatchObject({
      ok: true,
      data: { contentTrust: 'untrusted_web_content' },
    });
  });

  it('routes canonical actions to an explicit tab and supports tab management', async () => {
    const session = new BrowserSessionController();
    const host = mockHost();
    session.attach(host);

    await session.execute({ action: 'get_backbone', tab_id: 0, max_depth: 4 });
    expect(host.evaluate.mock.calls[0][2]).toBe(0);
    expect(host.evaluate.mock.calls[0][0]).toContain('backbone');

    await expect(session.execute({ action: 'new_tab', url: 'https://example.com' })).resolves.toMatchObject({
      ok: true,
      data: { action: 'new_tab', tab_id: 1 },
    });
    await expect(session.execute({ action: 'list_tabs' })).resolves.toMatchObject({ ok: true });
  });

  it('returns completed scroll metadata from the WebView result', async () => {
    const session = new BrowserSessionController();
    const host = mockHost();
    host.evaluate.mockResolvedValueOnce({ ok: true, before: 0, after: 600, moved: true });
    session.attach(host);
    await expect(session.execute({ action: 'scroll', amount: 600 })).resolves.toMatchObject({
      ok: true,
      data: { result: { before: 0, after: 600, moved: true } },
    });
    expect(host.evaluate.mock.calls[0][0]).toContain('requestAnimationFrame');
  });
});
