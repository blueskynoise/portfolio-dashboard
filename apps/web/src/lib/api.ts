/** Thin client for the first-party API. Same origin only; cookies ride along automatically. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`${status} ${code}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', null);
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body (a proxy error page, say) is reported as a failure, never interpreted.
  }
  if (!response.ok && !(parsed && typeof parsed === 'object' && 'report' in parsed)) {
    const code = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : 'http_error';
    throw new ApiError(response.status, code, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
