// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatasetManager, type ManagedDataset } from '../../src/client/DatasetManager.js';

const dataset: ManagedDataset = {
  schemaVersion: 1,
  id: 'smoke',
  name: '冒烟评测',
  defaults: { timeoutMs: 30_000, conversationMode: 'ISOLATED' },
  samples: [{
    id: 'answer', name: '普通问答', instruction: '现在几点？', enabled: true,
    assertions: [{ type: 'outcome', equals: 'complete' }],
  }],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('评测集管理器', () => {
  it('编辑样本与评测集后通过 PUT 保存并刷新选择', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(
      init?.body as string,
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => undefined);
    render(<DatasetManager datasets={[dataset]} selectedId="smoke" onChanged={onChanged}/>);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('评测集名称'), { target: { value: '更新后的评测集' } });
    fireEvent.change(screen.getByLabelText('输入指令'), { target: { value: '请告诉我现在的时间' } });
    fireEvent.click(screen.getByRole('button', { name: '保存评测集' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/datasets/smoke');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ name: '更新后的评测集', samples: [{ instruction: '请告诉我现在的时间' }] });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('smoke'));
  });

  it('在断言 JSON 非法时阻止保存', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<DatasetManager datasets={[dataset]} selectedId="smoke" onChanged={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('断言（JSON 数组）'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: '保存评测集' }));
    expect(await screen.findByText('样本 1 的断言不是合法 JSON')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
