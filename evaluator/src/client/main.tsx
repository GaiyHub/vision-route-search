import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

interface Device { serial:string; model:string; androidVersion:string; state:string; doupaoVersion?:string; evaluationApiVersion?:number }
interface Sample { id:string; name?:string; instruction:string; enabled:boolean; judge?:{enabled:boolean} }
interface Dataset { id:string; name:string; samples:Sample[] }
interface RunSample { sampleId:string; state:string; phase:string; summary?:string; durationMs?:number; tokens?:{total:number;cached?:number} }
interface Run { runId:string; state:string; samples:RunSample[] }
async function api<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{...init,headers:{'content-type':'application/json',...init?.headers}});const body=await response.json() as T&{error?:{message:string}};if(!response.ok)throw new Error(body.error?.message??`请求失败：${response.status}`);return body}
const terminal=new Set(['COMPLETED','CANCELLED','INTERRUPTED']);
const labels:Record<string,string>={PENDING:'等待中',RUNNING:'执行中',COMPLETED:'已完成',CANCELLED:'已取消',PASSED:'通过',FAILED:'未通过',BLOCKED:'需人工介入',INFRA_ERROR:'基础设施异常',TIMED_OUT:'超时'};

export function App(){
  const[devices,setDevices]=useState<Device[]>([]),[datasets,setDatasets]=useState<Dataset[]>([]),[serial,setSerial]=useState(''),[datasetId,setDatasetId]=useState(''),[selected,setSelected]=useState<string[]>([]),[run,setRun]=useState<Run>(),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const dataset=useMemo(()=>datasets.find(d=>d.id===datasetId),[datasets,datasetId]),ready=devices.find(d=>d.serial===serial&&d.state==='READY'),canStart=Boolean(ready&&dataset&&selected.length&&(!run||terminal.has(run.state)));
  useEffect(()=>{void Promise.all([api<{devices:Device[]}>('/api/devices'),api<{datasets:Dataset[]}>('/api/datasets')]).then(([a,b])=>{setDevices(a.devices);setDatasets(b.datasets);setSerial(a.devices.find(d=>d.state==='READY')?.serial??'');setDatasetId(b.datasets[0]?.id??'')}).catch(e=>setError(String(e))).finally(()=>setLoading(false))},[]);
  useEffect(()=>setSelected(dataset?.samples.filter(s=>s.enabled).map(s=>s.id)??[]),[dataset]);
  useEffect(()=>{if(!run||terminal.has(run.state))return;const timer=setInterval(()=>void api<Run>(`/api/runs/${run.runId}`).then(setRun).catch(e=>setError(String(e))),500);return()=>clearInterval(timer)},[run?.runId,run?.state]);
  async function start(){if(!dataset)return;setError('');try{setRun(await api<Run>('/api/runs',{method:'POST',body:JSON.stringify({datasetId:dataset.id,deviceSerial:serial,sampleIds:selected})}))}catch(e){setError(String(e))}}
  async function cancel(){if(run)setRun(await api<Run>(`/api/runs/${run.runId}/cancel`,{method:'POST'}))}
  const done=run?.samples.filter(s=>!['PENDING','RUNNING'].includes(s.state)).length??0;
  return <main className="shell"><header><div><p className="eyebrow">DOUPAO EVALUATION</p><h1>移动智能体评测台</h1><p>配置评测集，批量执行并观察智能体结果。</p></div><span className="badge">● Mock 模式</span></header>{error&&<div className="error">{error}</div>}<section className="grid"><article className="panel"><Title n="01" title="运行配置" sub="选择评测集和目标设备"/>{loading?<p>加载中…</p>:<><label>评测集<select value={datasetId} onChange={e=>setDatasetId(e.target.value)}>{datasets.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>目标设备<select value={serial} onChange={e=>setSerial(e.target.value)}>{devices.map(d=><option key={d.serial} value={d.serial}>{d.model} · {d.state}</option>)}</select></label>{ready&&<div className="device"><strong>{ready.model}</strong><code>{ready.serial}</code><div><span>Android {ready.androidVersion}</span><span>豆泡 {ready.doupaoVersion}</span><span>API v{ready.evaluationApiVersion}</span></div></div>}<div className="samples"><b>执行样本 <i>{selected.length}/{dataset?.samples.length??0}</i></b>{dataset?.samples.map(s=><label className="sample" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={()=>setSelected(v=>v.includes(s.id)?v.filter(id=>id!==s.id):[...v,s.id])}/><span><strong>{s.name??s.id}</strong><small>{s.instruction}</small></span>{s.judge?.enabled&&<em>Judge</em>}</label>)}</div><button className="primary" disabled={!canStart} onClick={()=>void start()}>{run&&!terminal.has(run.state)?'评测执行中':'开始评测'}</button></>}</article><article className="panel results"><Title n="02" title="运行进度" sub="Mock 数据同样经过后端持久化"/>{!run?<div className="empty"><span>▶</span><h3>尚未开始评测</h3><p>完成左侧配置后启动一个 Run</p></div>:<><div className="runhead"><span className={`state ${run.state}`}>{labels[run.state]??run.state}</span><code>{run.runId}</code><b>{done}/{run.samples.length}</b></div><div className="progress"><i style={{width:`${run.samples.length?done/run.samples.length*100:0}%`}}/></div>{run.samples.map((s,i)=><details key={s.sampleId} open={s.state==='RUNNING'}><summary><i>{String(i+1).padStart(2,'0')}</i><span><strong>{s.sampleId}</strong><small>{s.phase}</small></span><em className={`state ${s.state}`}>{labels[s.state]??s.state}</em></summary>{s.summary&&<div className="detail"><p>{s.summary}</p><small>{s.durationMs??0}ms · Token {s.tokens?.total??0} · Cache {s.tokens?.cached??0}</small></div>}</details>)}{!terminal.has(run.state)&&<button className="cancel" onClick={()=>void cancel()}>取消运行</button>}</>}</article></section></main>;
}
function Title({n,title,sub}:{n:string;title:string;sub:string}){return <div className="title"><span>{n}</span><div><h2>{title}</h2><p>{sub}</p></div></div>}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 容器');
createRoot(root).render(<StrictMode><App /></StrictMode>);
