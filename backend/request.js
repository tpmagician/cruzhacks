import { deadline, abortable } from '../frontend/js/async.js';
import { AppError } from './gemini.js';

export function requestDeadline(handler, ms = 60000) {
  return async (req, res) => {
    const disconnected = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) disconnected.abort(new DOMException('Client disconnected.', 'AbortError'));
    };
    res.on('close', cancel);
    const scope = deadline(ms, disconnected.signal);
    try {
      await abortable(scope.signal, () => handler(req, res, scope.signal));
    } catch (err) {
      if (scope.signal.aborted) {
        if (disconnected.signal.aborted) return;
        throw new AppError(504, 'DEADLINE_EXCEEDED', 'The request took too long. Your local report is still available; please retry.');
      }
      throw err;
    } finally {
      scope.dispose();
      res.off('close', cancel);
    }
  };
}
