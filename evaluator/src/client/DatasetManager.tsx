import { useMemo, useState } from 'react';
import { requestJson } from './api.js';

export interface ManagedSample {
  id: string;
  name?: string;
  instruction: string;
  enabled: boolean;
  timeoutMs?: number;
  assertions: Array<Record<string, unknown>>;
  judge?: { enabled: boolean; rubric: string; threshold: number; evidence: string[] };
  [key: string]: unknown;
}

export interface ManagedDataset {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  defaults: { timeoutMs: number; conversationMode: 'ISOLATED' };
  samples: ManagedSample[];
}

interface DraftSample extends ManagedSample { assertionsText: string; evidenceText: string }
interface Draft extends Omit<ManagedDataset, 'samples'> { samples: DraftSample[] }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(url, init);
}

function toDraft(dataset: ManagedDataset): Draft {
  return {
    ...structuredClone(dataset),
    samples: dataset.samples.map((sample) => ({
      ...structuredClone(sample),
      assertionsText: JSON.stringify(sample.assertions ?? [], null, 2),
      evidenceText: sample.judge?.evidence.join(', ') ?? 'finalResponse, traceSummary',
    })),
  };
}

function emptyDataset(): ManagedDataset {
  return {
    schemaVersion: 1,
    id: 'new-dataset',
    name: '新评测集',
    defaults: { timeoutMs: 180_000, conversationMode: 'ISOLATED' },
    samples: [{
      id: 'sample-1', instruction: '', enabled: true,
      assertions: [{ type: 'outcome', equals: 'complete' }],
    }],
  };
}

export function DatasetManager({
  datasets,
  selectedId,
  onChanged,
}: {
  datasets: ManagedDataset[];
  selectedId: string;
  onChanged(datasetId?: string): Promise<void>;
}) {
  const selected = useMemo(() => datasets.find((dataset) => dataset.id === selectedId), [datasets, selectedId]);
  const [draft, setDraft] = useState<Draft>();
  const [originalId, setOriginalId] = useState<string>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const open = (dataset: ManagedDataset, mode: 'edit' | 'create') => {
    setDraft(toDraft(dataset));
    setOriginalId(mode === 'edit' ? dataset.id : undefined);
    setError('');
  };
  const duplicate = () => {
    if (!selected) return;
    open({ ...structuredClone(selected), id: `${selected.id}-copy`, name: `${selected.name}（副本）` }, 'create');
  };
  const updateSample = (index: number, patch: Partial<DraftSample>) => setDraft((current) => current && ({
    ...current,
    samples: current.samples.map((sample, position) => position === index ? { ...sample, ...patch } : sample),
  }));
  const addSample = () => setDraft((current) => current && ({
    ...current,
    samples: [...current.samples, {
      id: `sample-${current.samples.length + 1}`, instruction: '', enabled: true,
      assertions: [], assertionsText: JSON.stringify([{ type: 'outcome', equals: 'complete' }], null, 2),
      evidenceText: 'finalResponse, traceSummary',
    }],
  }));
  const removeSample = (index: number) => setDraft((current) => current && ({
    ...current, samples: current.samples.filter((_, position) => position !== index),
  }));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const samples = draft.samples.map(({ assertionsText, evidenceText, ...sample }, index) => {
        let assertions: unknown;
        try { assertions = JSON.parse(assertionsText); } catch { throw new Error(`样本 ${index + 1} 的断言不是合法 JSON`); }
        if (!Array.isArray(assertions)) throw new Error(`样本 ${index + 1} 的断言必须是数组`);
        const judge = sample.judge?.enabled ? {
          ...sample.judge,
          evidence: evidenceText.split(',').map((value) => value.trim()).filter(Boolean),
        } : undefined;
        return { ...sample, assertions, ...(judge ? { judge } : {}) };
      });
      const body = { ...draft, id: draft.id.trim(), name: draft.name.trim(), samples };
      const saved = originalId
        ? await request<ManagedDataset>(`/api/datasets/${originalId}`, { method: 'PUT', body: JSON.stringify(body) })
        : await request<ManagedDataset>('/api/datasets', { method: 'POST', body: JSON.stringify(body) });
      setDraft(undefined);
      await onChanged(saved.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`确定删除评测集“${selected.name}”吗？`)) return;
    try {
      await request<void>(`/api/datasets/${selected.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <>
    <div className="dataset-actions">
      <button onClick={() => open(emptyDataset(), 'create')}>新建</button>
      <button disabled={!selected} onClick={() => selected && open(selected, 'edit')}>编辑</button>
      <button disabled={!selected} onClick={duplicate}>复制</button>
      <button className="danger" disabled={!selected} onClick={() => void remove()}>删除</button>
    </div>
    {draft && <div className="modal-backdrop"><section className="dataset-modal" role="dialog" aria-label="评测集编辑器">
      <div className="modal-head"><div><h2>{originalId ? '编辑评测集' : '新建评测集'}</h2><p>配置样本输入、确定性断言与 AI 评分标准</p></div><button onClick={() => setDraft(undefined)}>关闭</button></div>
      {error && <div className="error">{error}</div>}
      <div className="dataset-fields">
        <label>评测集 ID<input value={draft.id} disabled={Boolean(originalId)} onChange={(event) => setDraft({ ...draft, id: event.target.value })}/></label>
        <label>评测集名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>
        <label>默认超时（ms）<input type="number" value={draft.defaults.timeoutMs} onChange={(event) => setDraft({ ...draft, defaults: { ...draft.defaults, timeoutMs: Number(event.target.value) } })}/></label>
      </div>
      <label>描述<textarea rows={2} value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
      <div className="sample-editor-title"><h3>样本（{draft.samples.length}）</h3><button onClick={addSample}>新增样本</button></div>
      {draft.samples.map((sample, index) => <article className="sample-editor" key={`${index}-${sample.id}`}>
        <div className="sample-editor-head"><strong>#{index + 1}</strong><label className="inline-check"><input type="checkbox" checked={sample.enabled} onChange={(event) => updateSample(index, { enabled: event.target.checked })}/>启用</label><button className="danger" onClick={() => removeSample(index)}>移除</button></div>
        <div className="dataset-fields">
          <label>样本 ID<input value={sample.id} onChange={(event) => updateSample(index, { id: event.target.value })}/></label>
          <label>样本名称<input value={sample.name ?? ''} onChange={(event) => updateSample(index, { name: event.target.value })}/></label>
          <label>超时（ms）<input type="number" placeholder={String(draft.defaults.timeoutMs)} value={sample.timeoutMs ?? ''} onChange={(event) => updateSample(index, { timeoutMs: event.target.value ? Number(event.target.value) : undefined })}/></label>
        </div>
        <label>输入指令<textarea rows={3} value={sample.instruction} onChange={(event) => updateSample(index, { instruction: event.target.value })}/></label>
        <label>断言（JSON 数组）<textarea className="code-editor" rows={6} value={sample.assertionsText} onChange={(event) => updateSample(index, { assertionsText: event.target.value })}/></label>
        <label className="inline-check"><input type="checkbox" checked={sample.judge?.enabled ?? false} onChange={(event) => updateSample(index, { judge: event.target.checked ? (sample.judge ?? { enabled: true, rubric: '', threshold: .8, evidence: ['finalResponse'] }) : undefined })}/>启用 AI 结果评审</label>
        {sample.judge?.enabled && <div className="judge-fields"><label>评分标准<textarea rows={2} value={sample.judge.rubric} onChange={(event) => updateSample(index, { judge: { ...sample.judge!, rubric: event.target.value } })}/></label><label>通过阈值<input type="number" min="0" max="1" step="0.05" value={sample.judge.threshold} onChange={(event) => updateSample(index, { judge: { ...sample.judge!, threshold: Number(event.target.value) } })}/></label><label>证据（逗号分隔）<input value={sample.evidenceText} onChange={(event) => updateSample(index, { evidenceText: event.target.value })}/></label></div>}
      </article>)}
      <div className="modal-actions"><button onClick={() => setDraft(undefined)}>取消</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存评测集'}</button></div>
    </section></div>}
  </>;
}
