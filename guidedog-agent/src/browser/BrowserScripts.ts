/* Scripts run inside the WebView. Browser content is untrusted; every script
 * returns JSON-safe data and caps the amount sent back to the model. */

const MAX_TEXT = 15_000;
const MAX_ELEMENTS = 80;
const MAX_BACKBONE_NODES = 250;

function literal(value: unknown): string {
  return JSON.stringify(value);
}

const helpers = `
  const clean=v=>String(v==null?'':v).replace(/\\s+/g,' ').trim();
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>=2&&r.height>=2&&s.visibility!=='hidden'&&s.display!=='none';};
  const ensureRef=el=>{let r=el.getAttribute('data-deft-browser-ref');if(!r){window.__deftBrowserRefSeq=(window.__deftBrowserRefSeq||0)+1;r='b'+window.__deftBrowserRefSeq;el.setAttribute('data-deft-browser-ref',r);}return r;};
  const nameOf=el=>clean(el.getAttribute('aria-label')||el.getAttribute('alt')||el.getAttribute('placeholder')||el.innerText||el.value||el.getAttribute('title')||el.getAttribute('name')||'');
  const selectorOf=el=>{if(el.id)return '#'+CSS.escape(el.id);const tid=el.getAttribute('data-testid');if(tid)return '[data-testid="'+CSS.escape(tid)+'"]';const nm=el.getAttribute('name');if(nm)return el.tagName.toLowerCase()+'[name="'+CSS.escape(nm)+'"]';let out=[],n=el;while(n&&n.nodeType===1&&out.length<4){let p=n.tagName.toLowerCase();if(n.parentElement){const same=[...n.parentElement.children].filter(x=>x.tagName===n.tagName);if(same.length>1)p+=':nth-of-type('+(same.indexOf(n)+1)+')';}out.unshift(p);n=n.parentElement;}return out.join(' > ');};
  const infoOf=el=>{const r=el.getBoundingClientRect();return {ref:ensureRef(el),selector:selectorOf(el),tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||'',type:el.getAttribute('type')||'',name:nameOf(el).slice(0,300),text:clean(el.innerText||el.value||'').slice(0,300),placeholder:el.getAttribute('placeholder')||'',id:el.id||'',field_name:el.getAttribute('name')||'',href:el.href||'',checked:'checked'in el?!!el.checked:undefined,disabled:!!el.disabled,bounds:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}};};
`;

export function pageInfoScript(): string {
  return `(() => ({url:location.href,title:document.title||'',readyState:document.readyState,viewport:{width:innerWidth,height:innerHeight},scroll:{x:Math.round(scrollX),y:Math.round(scrollY),width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},nodes:document.getElementsByTagName('*').length}))()`;
}

export function getTextScript(selector?: string): string {
  return `(() => {const el=${selector ? `document.querySelector(${literal(selector)})` : 'document.body'};if(!el)return {ok:false,error:'element_not_found'};const raw=el.innerText||el.textContent||'';const text=raw.slice(0,${MAX_TEXT});return {url:location.href,title:document.title||'',selector:${literal(selector ?? 'body')},text,length:raw.length,truncated:raw.length>${MAX_TEXT}};})()`;
}

export function getReadableScript(): string {
  return `(() => {const candidates=['article','[role="main"]','main','.post-content','.article-body','.entry-content','#content','.content'];let root=null,source='body';for(const s of candidates){const e=document.querySelector(s);if(e&&(e.innerText||'').trim().length>0){root=e;source=s;break;}}root=root||document.body;const raw=(root?.innerText||'').replace(/\\s+/g,' ').trim();return {url:location.href,title:document.title||'',source,content:raw.slice(0,${MAX_TEXT}),length:raw.length,truncated:raw.length>${MAX_TEXT}};})()`;
}

/** Legacy export retained for existing tests and read_page behavior. */
export function readPageScript(): string {
  return getReadableScript();
}

export function findElementsScript(query = '', selector?: string): string {
  return `(() => {${helpers}const q=clean(${literal(query)}).toLowerCase();let all;try{all=[...document.querySelectorAll(${selector ? literal(selector) : literal('a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"],[tabindex]')})];}catch(e){return {ok:false,error:'invalid_selector',message:String(e&&e.message||e)}}const out=[];for(const el of all){if(!visible(el))continue;const i=infoOf(el);const hay=clean([i.name,i.text,i.placeholder,i.id,i.field_name,i.type,i.role,i.href,i.tag].join(' ')).toLowerCase();if(q&&!hay.includes(q))continue;out.push(i);if(out.length>=${MAX_ELEMENTS})break;}return {url:location.href,count:out.length,elements:out,truncated:out.length>=${MAX_ELEMENTS}};})()`;
}

function targetExpression(ref?: string, selector?: string): string {
  if (ref) return `document.querySelector('[data-deft-browser-ref="'+CSS.escape(${literal(ref)})+'"]')`;
  if (selector) return `document.querySelector(${literal(selector)})`;
  return 'null';
}

export function clickScript(ref?: string, selector?: string, x?: number, y?: number): string {
  const target = Number.isFinite(x) && Number.isFinite(y)
    ? `document.elementFromPoint(${Math.round(x as number)},${Math.round(y as number)})`
    : targetExpression(ref, selector);
  return `(() => {${helpers}const el=${target};if(!el)return {ok:false,error:'element_not_found'};el.scrollIntoView?.({block:'center',inline:'center'});el.focus?.();el.click();return {ok:true,element:infoOf(el),url:location.href};})()`;
}

export function typeScript(text: string, ref?: string, selector?: string): string {
  return `(() => {${helpers}const el=${targetExpression(ref, selector)};if(!el)return {ok:false,error:'element_not_found'};if(!('value'in el)&&!el.isContentEditable)return {ok:false,error:'element_not_editable'};el.scrollIntoView?.({block:'center'});el.focus();const value=${literal(text)};if(el.isContentEditable){el.textContent=value;}else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?setter.call(el,value):(el.value=value);}el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:clean('value'in el?el.value:el.textContent||'').slice(0,500),element:infoOf(el),url:location.href};})()`;
}

export function hoverScript(ref?: string, selector?: string): string {
  return `(() => {${helpers}const el=${targetExpression(ref, selector)};if(!el)return {ok:false,error:'element_not_found'};el.scrollIntoView?.({block:'center'});for(const t of ['pointerover','mouseover','mouseenter'])el.dispatchEvent(new MouseEvent(t,{bubbles:true,view:window}));return {ok:true,element:infoOf(el),url:location.href};})()`;
}

export function scrollScript(direction: 'up' | 'down', amount: number, selector?: string): string {
  const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
  return `(async()=>{let target=${selector ? `document.querySelector(${literal(selector)})` : 'document.scrollingElement||document.documentElement'};if(!target)return {ok:false,error:'element_not_found'};const before=target===document.scrollingElement||target===document.documentElement?window.scrollY:target.scrollTop;target.scrollBy({top:${delta},left:0,behavior:'auto'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const after=target===document.scrollingElement||target===document.documentElement?window.scrollY:target.scrollTop;return {ok:true,direction:${literal(direction)},amount:${Math.abs(delta)},before:Math.round(before),after:Math.round(after),moved:Math.round(after)!==Math.round(before),height:target.scrollHeight,viewport:target===document.scrollingElement||target===document.documentElement?innerHeight:target.clientHeight,url:location.href};})()`;
}

export function collectItemsScript(itemSelector: string, keywords: string[] = []): string {
  return `(() => {const words=${literal(keywords.map((v) => v.toLowerCase()))};let els;try{els=[...document.querySelectorAll(${literal(itemSelector)})];}catch(e){return {ok:false,error:'invalid_selector',message:String(e&&e.message||e)}}const items=[];for(const el of els){const text=(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();if(!text)continue;const low=text.toLowerCase();if(words.length&&!words.every(w=>low.includes(w)))continue;items.push({text:text.slice(0,2000),html:(el.outerHTML||'').slice(0,1000)});if(items.length>=100)break;}return {ok:true,items};})()`;
}

export function backboneScript(maxDepth = 5): string {
  const depth = Math.max(1, Math.min(10, Math.round(maxDepth)));
  return `(() => {${helpers}let count=0;const interactive='a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]';const walk=(el,d)=>{if(count>=${MAX_BACKBONE_NODES}||d>${depth}||!visible(el))return null;const isInteractive=el.matches?.(interactive);const name=nameOf(el);const children=[];for(const child of el.children||[]){const n=walk(child,d+1);if(n)children.push(n);if(count>=${MAX_BACKBONE_NODES})break;}if(!isInteractive&&!name&&children.length===0)return null;count++;const out={tag:el.tagName.toLowerCase()};if(isInteractive){const i=infoOf(el);out.ref=i.ref;out.selector=i.selector;out.role=i.role;out.type=i.type;out.name=i.name;out.disabled=i.disabled;if(i.checked!==undefined)out.checked=i.checked;}else if(name)out.text=name.slice(0,240);if(children.length)out.children=children;return out;};const roots=[];for(const el of document.body?.children||[]){const n=walk(el,1);if(n)roots.push(n);if(count>=${MAX_BACKBONE_NODES})break;}return {url:location.href,title:document.title||'',nodeCount:count,depth:${depth},truncated:count>=${MAX_BACKBONE_NODES},backbone:roots};})()`;
}

export function executeJavaScriptScript(script: string): string {
  return `(async()=>{try{const value=await (async()=>{${script}\n})();let output=value;if(typeof value==='object'&&value!==null){try{output=JSON.parse(JSON.stringify(value));}catch{output=String(value);}}if(typeof output==='string'&&output.length>20000)output=output.slice(0,20000);return {ok:true,value:output,url:location.href};}catch(e){return {ok:false,error:'javascript_error',message:String(e&&e.message||e)}}})()`;
}

export function fetchResourceScript(url: string, maxBytes: number): string {
  return `(async()=>{try{const r=await fetch(${literal(url)},{credentials:'include'});const b=await r.blob();if(b.size>${maxBytes})return {ok:false,error:'resource_too_large',size:b.size};const data=await new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||''));fr.onerror=()=>reject(fr.error||new Error('read failed'));fr.readAsDataURL(b);});const comma=data.indexOf(',');return {ok:r.ok,status:r.status,url:r.url||${literal(url)},mime:b.type||r.headers.get('content-type')||'application/octet-stream',size:b.size,base64:comma>=0?data.slice(comma+1):''};}catch(e){return {ok:false,error:'fetch_failed',message:String(e&&e.message||e)}}})()`;
}

export function stabilityFingerprintScript(): string {
  return `(() => ({readyState:document.readyState,nodes:document.getElementsByTagName('*').length,textLength:(document.body?.innerText||'').length,height:document.documentElement.scrollHeight,url:location.href}))()`;
}
