// Owns one report lifecycle. Local measurements are live; AI uses a fixed snapshot.
export class ReportController {
  constructor({ tracker, evaluate, view }) {
    Object.assign(this, { tracker, evaluate, view });
  }

  open(session, delivery) {
    if (this.active?.session === session) return this.active.promise;
    this.clear();
    const job = { session, delivery, controller: null, promise: null };
    this.active = job;
    this.view.mount(session, delivery);
    job.unsubscribe = this.tracker.subscribe(() => {
      if (this.active === job) this.view.delivery(session, delivery);
    });
    return this.retry();
  }

  retry() {
    const job = this.active;
    if (!job) return Promise.resolve();
    job.controller?.abort();
    const controller = new AbortController();
    job.controller = controller;
    const current = () => this.active === job && job.controller === controller;
    this.view.loading();
    // Start now, with no dependency on tracker.pending or settle(). Copy records
    // as well as metrics so a later session/edit cannot change the request.
    job.promise = (async () => {
      try {
        const payload = structuredClone(job.session.evaluationPayload(job.delivery, { includeFillers: false }));
        if (!payload.records.length) {
          throw Object.assign(new Error('There are no answered questions to score yet.'), { code: 'NOTHING_TO_SCORE' });
        }
        const result = await this.evaluate(payload, { signal: controller.signal });
        if (!current()) return;
        if (typeof result?.ok !== 'boolean') throw new Error('The server returned invalid AI feedback. Please retry.');
        this.view.result(job.session, result);
      } catch (err) {
        if (!current()) return;
        this.view.result(job.session, { ok: false, message: err.message, error: err.code });
      } finally {
        if (current()) this.view.finished();
      }
    })();
    return job.promise;
  }

  clear() {
    const job = this.active;
    this.active = null;
    job?.unsubscribe?.();
    job?.controller?.abort();
  }
}
