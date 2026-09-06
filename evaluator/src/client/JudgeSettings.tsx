import { useEffect, useState } from 'react';
import type { ApiClient } from './types.js';
import './judge.css';

export interface JudgePublicConfig {
  configured: boolean;
  provider: 'OPENAI_COMPATIBLE';
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  supportsImages?: boolean;
  hasApiKey: boolean;
}

export function JudgeSettings({ api, onConfigured }: { api: ApiClient; onConfigured(configured: boolean): void }) {
  const [config, setConfig] = useState<JudgePublicConfig>();
  const [draft, setDraft] = useState({ baseUrl: '', model: '', timeoutMs: 30000, supportsImages: false, apiKey: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<JudgePublicConfig>('/api/judge/config').then((value) => { setConfig(value); setDraft({ baseUrl: value.baseUrl ?? '', model: value.model ?? '', timeoutMs: value.timeoutMs ?? 30000, supportsImages: value.supportsImages ?? false, apiKey: '' }); }); }, []);
  async function save(test: boolean) {
    setBusy(true); setMessage('');
    try {
      const payload = { baseUrl: draft.baseUrl, model: draft.model, timeoutMs: draft.timeoutMs, supportsImages: draft.supportsImages, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) };
      const saved = await api<JudgePublicConfig>('/api/judge/config', { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(saved); onConfigured(saved.configured); setDraft((current) => ({ ...current, apiKey: '' }));
      if (test) await api('/api/judge/test', { method: 'POST' });
      setMessage(test ? '配置已保存，连接测试通过' : '配置已保存');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="settings-workspace">
    <nav className="settings-tabs" aria-label="配置分类"><button className="active">AI 评审模型</button></nav>
    <section className="panel judge-settings"><div className="section-head"><div><span className="config-kicker">LLM-as-Judge</span><h2>AI 评审模型</h2><p>配置用于判断样本执行结果是否满足评分标准的独立模型</p></div><em className={`state ${config?.configured ? 'PASSED' : 'OFFLINE'}`}>{config?.configured ? '已配置' : '未配置'}</em></div>
      <div className="dataset-fields"><label>Base URL<input placeholder="https://example.com/v1" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}/></label><label>模型<input placeholder="judge-model" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}/></label><label>超时（ms）<input type="number" min="1000" max="120000" value={draft.timeoutMs} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })}/></label></div>
      <label>API Key<input type="password" autoComplete="off" placeholder={config?.hasApiKey ? '已配置；留空则保留原值' : '仅传给本地后端，不回显'} value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}/></label><label className="inline-check"><input type="checkbox" checked={draft.supportsImages} onChange={(event) => setDraft({ ...draft, supportsImages: event.target.checked })}/>模型支持图片输入</label>
      {message && <div className={message.includes('通过') || message === '配置已保存' ? 'device' : 'error'}>{message}</div>}<div className="judge-actions"><button disabled={busy} onClick={() => void save(false)}>保存配置</button><button className="primary compact" disabled={busy || !draft.baseUrl || !draft.model} onClick={() => void save(true)}>{busy ? '请求中…' : '保存并测试连接'}</button></div>
    </section>
  </section>;
}
