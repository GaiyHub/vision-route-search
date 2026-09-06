export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const requestInit = init || Array.from(headers).length > 0 ? { ...init, headers } : undefined;
  const response = requestInit ? await fetch(url, requestInit) : await fetch(url);
  const raw = await response.text();
  if (response.status === 204 || response.status === 205 || (init?.method === 'DELETE' && response.ok && raw.trim() === '')) {
    return undefined as T;
  }
  if (raw.trim() === '') {
    throw new Error(`请求 ${url} 返回空响应（HTTP ${response.status}）`);
  }

  let body: T & { error?: { message?: string } };
  try {
    body = JSON.parse(raw) as T & { error?: { message?: string } };
  } catch {
    throw new Error(`请求 ${url} 返回无效 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(body.error?.message ?? `请求失败：${response.status}`);
  return body;
}
