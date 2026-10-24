// Shared by the browser and server. A deadline covers the entire operation,
// including response-body consumption and any retry backoff.
export function deadline(ms, parent) {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent.reason);
  if (parent?.aborted) cancel();
  else parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded.', 'TimeoutError')), ms);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', cancel); },
  };
}

// Also bounds adapters/mocks that do not honor the transport's AbortSignal.
export function abortable(signal, work) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return work();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

export async function delay(ms, signal) {
  let timer;
  try { await abortable(signal, () => new Promise((resolve) => { timer = setTimeout(resolve, ms); })); }
  finally { clearTimeout(timer); }
}
