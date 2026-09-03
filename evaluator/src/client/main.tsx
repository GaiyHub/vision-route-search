import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DatasetManager, type ManagedDataset } from './DatasetManager.js';
import { PlanConsole } from './PlanConsole.js';
import { RunConsole } from './RunConsole.js';
import { JudgeSettings, type JudgePublicConfig } from './JudgeSettings.js';
import type { ApiClient, Device, EvaluationPlanSummary, EvaluationRun } from './types.js';
import './styles.css';
import './theme.css';

type Page = 'plans' | 'datasets' | 'judge';
type PlanView = 'overview' | 'runs';
const terminalRuns = new Set(['COMPLETED', 'CANCELLED', 'INTERRUPTED']);
const pageMeta: Record<Page, { label: string; description: string; icon: string }> = {
  plans: { label: '评测计划', description: '组织评测集、设备与执行策略', icon: '▣' },
  datasets: { label: '评测集', description: '管理样本、断言与 Judge 标准', icon: '▤' },
  judge: { label: 'Judge', description: '配置 LLM-as-Judge 评测能力', icon: '✦' },
};

const api: ApiClient = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `请求失败：${response.status}`);
  return body;
};

export function App() {
  const [page, setPage] = useState<Page>('plans');
  const [planView, setPlanView] = useState<PlanView>('overview');
  const [devices, setDevices] = useState<Device[]>([]);
  const [datasets, setDatasets] = useState<ManagedDataset[]>([]);
  const [plans, setPlans] = useState<EvaluationPlanSummary[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [judgeConfigured, setJudgeConfigured] = useState(false);
  const selectedPlanRuns = useMemo(() => runs.filter((run) => run.planId === selectedPlanId || run.planSnapshot?.plan.planId === selectedPlanId), [runs, selectedPlanId]);
  const selectedRun = useMemo(() => selectedPlanRuns.find((run) => run.runId === selectedRunId) ?? selectedPlanRuns[0], [selectedPlanRuns, selectedRunId]);
  const runtimeLabel = devices.some((device) => !device.mock) ? 'ADB 真机' : 'Mock';

  useEffect(() => {
    void Promise.all([
      api<{ devices: Device[] }>('/api/devices'),
      api<{ datasets: ManagedDataset[] }>('/api/datasets'),
      api<{ plans: EvaluationPlanSummary[] }>('/api/plans?limit=100'),
      api<{ runs: EvaluationRun[] }>('/api/runs'),
      api<JudgePublicConfig>('/api/judge/config'),
    ]).then(([deviceResult, datasetResult, planResult, runResult, judgeResult]) => {
      setDevices(deviceResult.devices);
      setDatasets(datasetResult.datasets);
      setPlans(planResult.plans);
      setRuns(runResult.runs);
      const firstPlanId = planResult.plans[0]?.planId ?? '';
      setSelectedPlanId(firstPlanId);
      setSelectedRunId(runResult.runs.find((run) => run.planId === firstPlanId || run.planSnapshot?.plan.planId === firstPlanId)?.runId ?? '');
      setSelectedDatasetId(datasetResult.datasets[0]?.id ?? '');
      setJudgeConfigured(judgeResult.configured);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedRun || terminalRuns.has(selectedRun.state)) return;
    const timer = setInterval(() => {
      void api<EvaluationRun>(`/api/runs/${selectedRun.runId}`).then(updateRun).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    }, 500);
    return () => clearInterval(timer);
  }, [selectedRun?.runId, selectedRun?.state]);

  const updateRun = (run: EvaluationRun) => {
    setRuns((current) => [run, ...current.filter((item) => item.runId !== run.runId)]);
    setSelectedRunId(run.runId);
  };
  const reloadPlans = async (preferredId?: string) => {
    const result = await api<{ plans: EvaluationPlanSummary[] }>('/api/plans?limit=100');
    setPlans(result.plans);
    setSelectedPlanId(preferredId ?? result.plans[0]?.planId ?? '');
  };
  const reloadDatasets = async (preferredId?: string) => {
    const result = await api<{ datasets: ManagedDataset[] }>('/api/datasets');
    setDatasets(result.datasets);
    setSelectedDatasetId(preferredId ?? result.datasets[0]?.id ?? '');
  };
  const onRunStarted = (run: EvaluationRun) => {
    updateRun(run);
    setPage('plans');
    setPlanView('runs');
  };
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId);

  return <main className="shell">
    <header className="app-topbar">
      <div className="brand"><span className="brand-mark">D</span><strong>豆泡评测</strong></div>
      <div className="workspace-switcher"><small>工作区</small><strong>移动智能体评测台</strong><span>⌄</span></div>
      <span className="badge">● {runtimeLabel}</span>
    </header>
    <div className="app-layout">
      <aside className="app-sidebar">
        <p className="sidebar-label">工作区</p>
        <nav className="top-nav" aria-label="评测台导航">
          {(Object.keys(pageMeta) as Page[]).map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => { setPage(item); if (item === 'plans') setPlanView('overview'); }}><span aria-hidden="true">{pageMeta[item].icon}</span><span className="nav-label">{pageMeta[item].label}</span></button>)}
        </nav>
        <div className="sidebar-footer"><span>DOUPAO</span><small>Evaluation Console</small></div>
      </aside>
      <section className="workspace-stage">
        <div className="workspace-bar"><div><span>工作区&nbsp; / &nbsp;</span><strong>{pageMeta[page].label}</strong></div><p>{page === 'plans' && planView === 'runs' ? '查看当前计划的运行批次、指标与轨迹' : pageMeta[page].description}</p></div>
        <div className="workspace-content">
          {error && <div className="error">{error}</div>}{loading ? <div className="panel empty"><p>加载中…</p></div> : page === 'plans' ? <><nav className="plan-subnav" aria-label="评测计划详情导航"><button className={planView === 'overview' ? 'active' : ''} onClick={() => setPlanView('overview')}>计划概览</button><button className={planView === 'runs' ? 'active' : ''} onClick={() => setPlanView('runs')}>执行记录<span>{selectedPlanRuns.length}</span></button></nav>{planView === 'overview' ? <PlanConsole api={api} devices={devices} datasets={datasets} plans={plans} selectedPlanId={selectedPlanId} judgeConfigured={judgeConfigured} onSelect={setSelectedPlanId} onPlansChanged={reloadPlans} onRunStarted={onRunStarted}/> : <RunConsole api={api} runs={selectedPlanRuns} selectedRun={selectedRun} onSelect={setSelectedRunId} onRunUpdated={updateRun}/>}</> : page === 'judge' ? <JudgeSettings api={api} onConfigured={setJudgeConfigured}/> : <section className="dataset-workspace"><article className="panel"><div className="section-head"><div><h2>评测集管理</h2><p>维护样本、断言与 Judge 标准，不在此发起执行</p></div></div><label>当前评测集<select value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><DatasetManager datasets={datasets} selectedId={selectedDatasetId} onChanged={reloadDatasets}/>{selectedDataset && <div className="dataset-overview"><strong>{selectedDataset.name}</strong><p>{selectedDataset.description}</p>{selectedDataset.samples.map((sample) => <div className="sample readonly" key={sample.id}><span><strong>{sample.name ?? sample.id}</strong><small>{sample.instruction}</small></span>{sample.judge?.enabled && <em>Judge</em>}</div>)}</div>}</article></section>}
        </div>
      </section>
    </div>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 容器');
const runtime = globalThis as typeof globalThis & { __doupaoEvaluatorRoot?: ReturnType<typeof createRoot> };
runtime.__doupaoEvaluatorRoot ??= createRoot(root);
runtime.__doupaoEvaluatorRoot.render(<StrictMode><App/></StrictMode>);
