import { useEffect, useMemo, useState } from 'react';
import type { ManagedDataset } from './DatasetManager.js';
import type { ApiClient, Device, EvaluationPlan, EvaluationPlanSummary, EvaluationRun } from './types.js';

type PlanDraft = Pick<EvaluationPlan, 'name' | 'description' | 'datasetId' | 'deviceSerial' | 'sampleIds' | 'execution' | 'judge'>;

export function PlanConsole({
  api, devices, datasets, plans, selectedPlanId, judgeConfigured, onSelect, onPlansChanged, onRunStarted,
}: {
  api: ApiClient;
  devices: Device[];
  datasets: ManagedDataset[];
  plans: EvaluationPlanSummary[];
  selectedPlanId: string;
  judgeConfigured: boolean;
  onSelect(planId: string): void;
  onPlansChanged(preferredId?: string): Promise<void>;
  onRunStarted(run: EvaluationRun): void;
}) {
  const selectedSummary = useMemo(() => plans.find((plan) => plan.planId === selectedPlanId), [plans, selectedPlanId]);
  const [selected, setSelected] = useState<EvaluationPlan>();
  const dataset = datasets.find((item) => item.id === selected?.datasetId);
  const device = devices.find((item) => item.serial === selected?.deviceSerial);
  const [draft, setDraft] = useState<PlanDraft>();
  const [editingId, setEditingId] = useState<string>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!selectedPlanId) { setSelected(undefined); return; }
    void api<EvaluationPlan>(`/api/plans/${selectedPlanId}`).then(setSelected).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [selectedPlanId, selectedSummary?.updatedAt]);

  const openCreate = () => {
    const firstDataset = datasets[0];
    setEditingId(undefined);
    setDraft({
      name: '新评测计划',
      datasetId: firstDataset?.id ?? '',
      deviceSerial: devices.find((item) => item.state === 'READY')?.serial ?? devices[0]?.serial ?? '',
      sampleIds: firstDataset?.samples.filter((sample) => sample.enabled).map((sample) => sample.id) ?? [],
      execution: { defaultTimeoutMs: firstDataset?.defaults.timeoutMs ?? 180_000, continueOnFailure: true },
      judge: { enabled: true },
    });
    setError('');
  };
  const openEdit = () => {
    if (!selected) return;
    const { name, description, datasetId, deviceSerial, sampleIds, execution, judge } = selected;
    setEditingId(selected.planId);
    setDraft(structuredClone({ name, description, datasetId, deviceSerial, sampleIds, execution, judge }));
    setError('');
  };
  const changeDataset = (datasetId: string) => {
    const next = datasets.find((item) => item.id === datasetId);
    if (!draft) return;
    setDraft({ ...draft, datasetId, sampleIds: next?.samples.filter((sample) => sample.enabled).map((sample) => sample.id) ?? [] });
  };
  const toggleSample = (sampleId: string) => {
    if (!draft) return;
    setDraft({ ...draft, sampleIds: draft.sampleIds.includes(sampleId) ? draft.sampleIds.filter((id) => id !== sampleId) : [...draft.sampleIds, sampleId] });
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const saved = await api<EvaluationPlan>(editingId ? `/api/plans/${editingId}` : '/api/plans', {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify(draft),
      });
      setSelected(saved);
      setDraft(undefined);
      await onPlansChanged(saved.planId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const start = async () => {
    if (!selected) return;
    setStarting(true);
    setError('');
    try { onRunStarted(await api<EvaluationRun>(`/api/plans/${selected.planId}/runs`, { method: 'POST' })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStarting(false); }
  };
  const draftDataset = datasets.find((item) => item.id === draft?.datasetId);
  const judgeRequired = Boolean(selected?.judge.enabled && selected.sampleIds.some((sampleId) => dataset?.samples.find((sample) => sample.id === sampleId)?.judge?.enabled));

  return <section className="workspace-grid">
    <article className="panel plan-list-panel"><div className="section-head"><div><h2>评测计划</h2><p>复用数据集、设备与执行策略</p></div><button className="primary compact" onClick={openCreate}>新建计划</button></div>
      <div className="plan-list">{plans.length === 0 ? <div className="empty compact-empty"><p>暂无评测计划</p></div> : plans.map((plan) => <button key={plan.planId} className={`plan-card ${plan.planId === selectedPlanId ? 'active' : ''}`} onClick={() => onSelect(plan.planId)}><strong>{plan.name}</strong><small>{plan.datasetId} · {plan.sampleIds.length} 个样本</small><em>{new Date(plan.updatedAt).toLocaleString()}</em></button>)}</div>
    </article>
    <article className="panel plan-detail"><div className="section-head"><div><h2>{selected?.name ?? '选择一个计划'}</h2><p>{selected?.description ?? '计划是发起评测的唯一入口'}</p></div>{selected && <button onClick={openEdit}>编辑配置</button>}</div>
      {!selected ? <div className="empty"><span>＋</span><h3>创建首个评测计划</h3><p>绑定评测集、设备和执行策略后即可运行</p></div> : <>
        <div className="plan-facts"><div><small>评测集</small><strong>{dataset?.name ?? selected.datasetId}</strong></div><div><small>目标设备</small><strong>{device?.model ?? selected.deviceSerial}</strong><em className={`state ${device?.state ?? 'OFFLINE'}`}>{device?.state ?? '离线'}</em></div><div><small>样本范围</small><strong>{selected.sampleIds.length} 条</strong></div><div><small>默认超时</small><strong>{Math.round(selected.execution.defaultTimeoutMs / 1000)} 秒</strong></div></div>
        <div className="samples"><b>执行样本 <i>{selected.sampleIds.length}</i></b>{selected.sampleIds.map((sampleId) => { const sample = dataset?.samples.find((item) => item.id === sampleId); return <div className="sample readonly" key={sampleId}><span><strong>{sample?.name ?? sampleId}</strong><small>{sample?.instruction ?? '样本当前不存在'}</small></span>{sample?.judge?.enabled && selected.judge.enabled && <em>Judge</em>}</div>; })}</div>
        {error && <div className="error">{error}</div>}<button className="primary" disabled={starting || device?.state !== 'READY' || judgeRequired && !judgeConfigured} onClick={() => void start()}>{starting ? '正在启动…' : device?.state !== 'READY' ? '设备未就绪' : judgeRequired && !judgeConfigured ? '请先配置 Judge' : '执行评测计划'}</button>
      </>}
    </article>
    {draft && <div className="modal-backdrop"><section className="dataset-modal" role="dialog" aria-label="评测计划编辑器"><div className="modal-head"><div><h2>{editingId ? '编辑评测计划' : '新建评测计划'}</h2><p>配置仅影响之后创建的执行记录</p></div><button onClick={() => setDraft(undefined)}>关闭</button></div>{error && <div className="error">{error}</div>}
      <div className="dataset-fields"><label>计划名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label><label>评测集<select value={draft.datasetId} onChange={(event) => changeDataset(event.target.value)}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>目标设备<select value={draft.deviceSerial} onChange={(event) => setDraft({ ...draft, deviceSerial: event.target.value })}>{!devices.some((item) => item.serial === draft.deviceSerial) && <option value={draft.deviceSerial}>{draft.deviceSerial}（当前离线）</option>}{devices.map((item) => <option key={item.serial} value={item.serial}>{item.model} · {item.state}</option>)}</select></label></div>
      <label>计划描述<textarea rows={2} value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label><div className="dataset-fields"><label>默认超时（ms）<input type="number" min="10000" max="1800000" value={draft.execution.defaultTimeoutMs} onChange={(event) => setDraft({ ...draft, execution: { ...draft.execution, defaultTimeoutMs: Number(event.target.value) } })}/></label><label className="inline-check"><input type="checkbox" checked={draft.execution.continueOnFailure} onChange={(event) => setDraft({ ...draft, execution: { ...draft.execution, continueOnFailure: event.target.checked } })}/>失败后继续</label><label className="inline-check"><input type="checkbox" checked={draft.judge.enabled} onChange={(event) => setDraft({ ...draft, judge: { enabled: event.target.checked } })}/>启用样本 Judge</label></div>
      <div className="samples plan-sample-picker"><b>选择样本 <i>{draft.sampleIds.length}/{draftDataset?.samples.length ?? 0}</i></b>{draftDataset?.samples.map((sample) => <label className="sample" key={sample.id}><input type="checkbox" checked={draft.sampleIds.includes(sample.id)} disabled={!sample.enabled} onChange={() => toggleSample(sample.id)}/><span><strong>{sample.name ?? sample.id}</strong><small>{sample.instruction}</small></span></label>)}</div><div className="modal-actions"><button onClick={() => setDraft(undefined)}>取消</button><button className="primary compact" disabled={saving || draft.sampleIds.length === 0} onClick={() => void save()}>{saving ? '保存中…' : '保存计划'}</button></div>
    </section></div>}
  </section>;
}
