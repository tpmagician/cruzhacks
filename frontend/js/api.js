export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function post(url, body) {
  let res;
  try {
    // Blobs (audio) go up as-is; everything else as JSON.
    const raw = body instanceof Blob;
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': raw ? body.type : 'application/json' },
      body: raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Is it running? (npm start)', 'NETWORK', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `Request failed (${res.status}).`, data?.error?.code || `HTTP_${res.status}`, res.status);
  }
  return data;
}

export const api = {
  health: () => fetch('/api/health').then((r) => r.json()),
  interview: (body) => post('/api/interview', body),
  evaluate: (body) => post('/api/evaluate', body),
  transcribe: (wav) => post('/api/transcribe', wav),
};
