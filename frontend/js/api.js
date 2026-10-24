import { deadline, abortable } from './async.js';

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(url, init, { signal, timeoutMs = 65000 } = {}) {
  const scope = deadline(timeoutMs, signal);
  try {
    return await abortable(scope.signal, async () => {
      const res = await fetch(url, { ...init, signal: scope.signal });
      let data;
      try { data = await res.json(); } catch (err) {
        if (scope.signal.aborted) throw err;
        if (res.ok) throw new ApiError('The server returned an invalid response. Please retry.', 'INVALID_RESPONSE', res.status);
      }
      if (!res.ok) throw new ApiError(data?.error?.message || `Request failed (${res.status}).`, data?.error?.code || `HTTP_${res.status}`, res.status);
      return data;
    });
  } catch (err) {
    if (scope.signal.aborted) {
      const timedOut = scope.signal.reason?.name === 'TimeoutError';
      throw new ApiError(timedOut ? 'The request took too long. You can try again.' : 'Request cancelled.', timedOut ? 'DEADLINE_EXCEEDED' : 'CANCELLED', 0);
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError('Could not reach the server. Is it running? (npm start)', 'NETWORK', 0);
  } finally {
    scope.dispose();
  }
}

function post(url, body, options) {
  const raw = body instanceof Blob;
  return request(url, {
    method: 'POST', headers: { 'Content-Type': raw ? body.type : 'application/json' },
    body: raw ? body : JSON.stringify(body),
  }, options);
}

export const api = {
  health: () => request('/api/health', {}, { timeoutMs: 10000 }),
  interview: (body, options) => post('/api/interview', body, options),
  // Slightly longer than the server's 95 s evaluation budget, so its error arrives first.
  evaluate: (body, options) => post('/api/evaluate', body, { timeoutMs: 100000, ...options }),
  transcribe: (wav, options) => post('/api/transcribe', wav, options),
};
