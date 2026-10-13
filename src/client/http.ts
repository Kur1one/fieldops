// Запросы к API. NetworkError — нет связи (повторим позже), ApiError — ответ сервера с ошибкой.

export class NetworkError extends Error {}
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown>) {
    super(message);
  }
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new NetworkError('Нет связи с сервером');
  }
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    // 5xx и шлюзы считаем временной проблемой связи
    if (res.status >= 500 || res.status === 0) throw new NetworkError((body as { error?: string }).error || `Сервер недоступен (${res.status})`);
    throw new ApiError(res.status, (body as { error?: string }).error || `Ошибка ${res.status}`, body as Record<string, unknown>);
  }
  return body as T;
}

export function postJson<T>(url: string, data: unknown, method = 'POST') {
  return request<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
