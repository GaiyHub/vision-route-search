import { useEffect, useState } from 'react';
import { SampleTraceModal } from './SampleTraceModal.js';
import type { ApiClient, EvaluationRun, PlanRunReport, RunAttempt } from './types.js';

const terminalRuns = new Set(['COMPLETED', 'CANCELLED', 'INTERRUPTED']);
const terminalSamples = new Set(['PASSED', 'FAILED', 'INCONCLUSIVE', 'BLOCKED', 'INFRA_ERROR', 'TIMED_OUT', 'CANCELLED']);
const labels: Record<string, string> = { PENDING: '等待中', RUNNING: '执行中', COMPLETED: '已完成', CANCELLED: '已取消', INTERRUPTED: '已中断', PASSED: '通过', FAILED: '未通过', INCONCLUSIVE: '无法判定', BLOCKED: '需人工介入', INFRA_ERROR: '基础设施异常', TIMED_OUT: '超时' };

export function RunConsole({ api, runs, selectedRun, onSelect, onRunUpdated }: {
  api: ApiClient;
  runs: EvaluationRun[];
  selectedRun?: EvaluationRun;
  onSelect(runId: string): void;
  onRunUpdated(run: EvaluationRun): void;
}) {
  const [trace, setTrace] = useState<{ sampleId: string; attemptId?: string }>();
  const [retrying, setRetrying] = useState('');
  const [report, setReport] = useState<PlanRunReport>();
  const [error, setError] = useState('');
  useEffect(() => {
    setReport(undefined);
    if (!selectedRun?.planId || !terminalRuns.has(selectedRun.state)) return;
    void api<PlanRunReport>(`/api/runs/${selectedRun.runId}/report`).then(setReport).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [selectedRun?.runId, selectedRun?.state]);
  const retry = async (sampleId: string) => {
    if (!selectedRun) return;
    setRetrying(sampleId);
    setError('');
    try { onRunUpdated(await api<EvaluationRun>(`/api/runs/${selectedRun.runId}/samples/${sampleId}/retries`, { method: 'POST' })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRetrying(''); }
  };
  const cancel = async () => {
    if (!selectedRun) return;
    onRunUpdated(await api<EvaluationRun>(`/api/runs/${selectedRun.runId}/cancel`, { method: 'POST' }));
  };
  const done = selectedRun?.samples.filter((sample) => terminalSamples.has(sample.state)).length ?? 0;

  return <section className="workspace-grid runs-workspace"><article className="panel plan-list-panel"><div className="section-head"><div><h2>执行记录</h2><p>按计划与运行批次查看历史</p></div></div><div className="plan-list">{runs.length === 0 ? <div className="empty compact-empty"><p>暂无执行记录</p></div> : runs.map((run) => <button key={run.runId} className={`plan-card ${run.runId === selectedRun?.runId ? 'active' : ''}`} onClick={() => onSelect(run.runId)}><strong>{run.planSnapshot?.plan.name ?? run.datasetName ?? '历史评测'}</strong><small>{run.planId ? `计划执行 · ${run.samples.length} 个样本` : '历史评测 · 只读'}</small><em>{run.createdAt ? new Date(run.createdAt).toLocaleString() : run.runId}</em></button>)}</div></article>
    <article className="panel results"><div className="section-head"><div><h2>{selectedRun?.planSnapshot?.plan.name ?? selectedRun?.datasetName ?? '运行详情'}</h2><p>{selectedRun?.planId ? '评测计划执行记录' : '历史评测只读记录'}</p></div>{selectedRun && <span className={`state ${selectedRun.state}`}>{labels[selectedRun.state] ?? selectedRun.state}</span>}</div>{error && <div className="error">{error}</div>}{!selectedRun ? <div className="empty"><span>▶</span><h3>暂无运行</h3><p>从评测计划页启动一次执行</p></div> : <><div className="runhead"><code>{selectedRun.runId}</code><b>{done}/{selectedRun.samples.length}</b></div><div className="progress"><i style={{ width: `${selectedRun.samples.length ? done / selectedRun.samples.length * 100 : 0}%` }}/></div>
      {report && <ReportSummary report={report}/>} {selectedRun.samples.map((sample, index) => <details key={sample.sampleId} open={sample.state === 'RUNNING'}><summary><i>{String(index + 1).padStart(2, '0')}</i><span><strong>{sample.sampleId}</strong><small>{sample.attempts ? `${sample.attempts.length} 次尝试` : sample.phase}</small></span><em className={`state ${sample.state}`}>{labels[sample.state] ?? sample.state}</em></summary><div className="detail">{sample.summary && <p>{sample.summary}</p>}{sample.attempts ? <div className="attempt-list">{sample.attempts.map((attempt) => <AttemptRow key={attempt.attemptId} attempt={attempt} onTrace={() => setTrace({ sampleId: sample.sampleId, attemptId: attempt.attemptId })}/>)}</div> : terminalSamples.has(sample.state) && <button className="trace-open" onClick={() => setTrace({ sampleId: sample.sampleId })}>查看指标与原始轨迹</button>}{sample.attempts && terminalRuns.has(selectedRun.state) && <button className="retry-sample" disabled={Boolean(retrying)} onClick={() => void retry(sample.sampleId)}>{retrying === sample.sampleId ? '重试中…' : '新增一次尝试'}</button>}</div></details>)}{!terminalRuns.has(selectedRun.state) && <button className="cancel" onClick={() => void cancel()}>取消运行</button>}</>}
    </article>{selectedRun && trace && <SampleTraceModal runId={selectedRun.runId} sampleId={trace.sampleId} attemptId={trace.attemptId} onClose={() => setTrace(undefined)}/>}</section>;
}

function AttemptRow({ attempt, onTrace }: { attempt: RunAttempt; onTrace(): void }) {
  return <div className="attempt-row"><span><b>Attempt {attempt.attemptNumber}</b><small>{attempt.durationMs ?? 0}ms · Token {attempt.tokens?.total ?? 0}</small></span><em className={`state ${attempt.state}`}>{labels[attempt.state] ?? attempt.state}</em>{terminalSamples.has(attempt.state) && <button onClick={onTrace}>查看轨迹</button>}</div>;
}

function ReportSummary({ report }: { report: PlanRunReport }) {
  const summary = report.summary;
  return <section className="report-summary"><div className="section-head"><div><h3>整体报告</h3><p>基于每个样本的最新 Attempt</p></div><strong>{(summary.passRate * 100).toFixed(1)}%</strong></div><div className="report-metrics"><span><small>通过</small><b>{summary.passed}/{summary.total}</b></span><span><small>失败/异常</small><b>{summary.failed + summary.infraError + summary.timedOut}</b></span><span><small>总 Token</small><b>{summary.totalTokens ?? '不可用'}</b></span><span><small>总耗时</small><b>{formatDuration(summary.durationMs)}</b></span></div></section>;
}

function formatDuration(value: number): string { return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(2)}s`; }
