import { BodyLanguageAnalyzer } from './body-language.js';
import { escapeHtml } from './report.js';

export function formatDuration(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

export function renderBodyLanguageReport(element, report) {
  const definitions = {
    head: {
      title: 'Head direction', label: 'near your forward baseline', invert: true,
      description: 'Head direction estimates where your face points. It does not measure eye contact with an audience.',
      tip: 'Practice glancing at notes between thoughts, then returning your head toward your audience.',
    },
    shift: {
      title: 'Side-to-side movement', label: 'near your starting position', invert: true,
      description: 'Tracks how far your shoulders drift sideways from your calibrated position, including swaying and sideways lean. Moving the camera or your seat also counts.',
      tip: 'Try delivering one point from a steady, centered position, then move deliberately when you change topics.',
    },
    gestures: {
      title: 'Gesture activity', label: 'of tracked time with hand movement', invert: false,
      description: 'Measures wrist movement relative to your shoulders. A higher percentage is not necessarily better.',
      tip: 'Try a deliberate gesture to emphasize one key point, then let your hands rest comfortably.',
    },
  };
  const cards = Object.entries(definitions).map(([key, definition]) => {
    const metric = report.metrics[key];
    const value = metric.fraction == null ? 'Not enough data' : percent(definition.invert ? 1 - metric.fraction : metric.fraction);
    return `<article class="card">
      <h3>${definition.title}</h3><p class="metric-value">${value}</p>
      <p>${metric.fraction == null ? 'At least 5 seconds of usable tracking are needed.' : definition.label}</p>
      <p class="muted small">Tracking coverage: ${percent(metric.coverage)} · ${formatDuration(metric.validSeconds)} usable</p>
      <p class="small">${definition.description}</p>
    </article>`;
  }).join('');
  const suggestions = [];
  if (report.metrics.head.fraction > 0.15) suggestions.push(definitions.head.tip);
  if (report.metrics.shift.fraction > 0.15) suggestions.push(definitions.shift.tip);
  if (report.metrics.gestures.fraction != null && report.metrics.gestures.fraction < 0.1) suggestions.push(definitions.gestures.tip);
  if (Object.values(report.metrics).some((metric) => metric.coverage < 0.6 || metric.fraction == null)) {
    suggestions.push('For more complete feedback, keep your face and both hands in view with even lighting. Try a rehearsal of at least 20 seconds.');
  }
  if (!suggestions.length) suggestions.push('Try another rehearsal with one intentional gesture and a planned glance at your notes. Compare the observations with your speaking goals.');
  const labels = {
    head: 'Your head stayed turned or tilted away from your forward baseline.',
    shift: 'You stayed shifted to one side of your starting position.',
  };
  element.innerHTML = `<div class="report-head"><h2>Body-language feedback</h2><span>${formatDuration(report.activeSeconds)} active practice</span></div>
    <p class="muted">Calibration and pauses are excluded. Percentages use only usable tracking time. These are approximate observations, not a speaking-ability score.</p>
    ${!report.calibrated ? '<p class="notice">Calibration was not completed. Start a new practice to collect feedback.</p>' : ''}
    <div class="summary-grid">${cards}</div>
    <section class="card"><h3>Try in your next rehearsal</h3><ul>${suggestions.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul></section>
    <section class="card"><h3>Observed moments</h3>
      <p class="muted small">Times follow the active practice clock. Only patterns lasting at least 2 seconds are listed; camera movement can affect these observations.</p>
      ${report.events.length ? `<ol class="event-list">${report.events.map((event) => `<li><time>${formatDuration(event.start)}–${formatDuration(event.end)}</time> ${labels[event.type]}</li>`).join('')}</ol>`
        : '<p>No sustained moments were detected in the usable tracking. Brief sessions or limited visibility can also produce an empty timeline.</p>'}
      ${report.events.length >= 200 ? '<p class="muted small">Showing the first 200 observed moments.</p>' : ''}
    </section>`;
  element.hidden = false;
}

export class PresentationPractice {
  constructor() {
    const get = (name) => document.querySelector(`#presentation-${name}`);
    this.els = Object.fromEntries(['video', 'timer', 'status', 'coverage', 'error', 'camera', 'start', 'pause', 'stop', 'report'].map((name) => [name, get(name)]));
    this.placeholder = document.querySelector('#camera-placeholder');
    this.state = 'idle';
    this.epoch = 0;
    this.elapsed = 0;
    this.els.camera.addEventListener('click', () => ['loading', 'ready'].includes(this.state) ? this.leave() : this.openCamera());
    this.els.start.addEventListener('click', () => this.start());
    this.els.pause.addEventListener('click', () => this.state === 'paused' ? this.resume() : this.pause());
    this.els.stop.addEventListener('click', () => this.finish());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'running') this.pause('Practice paused while this tab is hidden. Resume when you are ready.');
      else if (document.hidden && this.state === 'calibrating') {
        this.epoch++;
        this.stopLoop();
        this.state = 'ready';
        this.status('Calibration interrupted. Face forward and calibrate again when you return.');
        this.updateControls();
      }
    });
    window.addEventListener('pagehide', () => this.leave());
  }

  status(text) { this.els.status.textContent = text; }

  updateControls() {
    this.els.camera.disabled = !['idle', 'report', 'loading', 'ready'].includes(this.state);
    this.els.camera.textContent = this.state === 'report' ? 'Enable camera for new practice'
      : this.state === 'loading' ? 'Cancel camera setup'
        : this.state === 'ready' ? 'Turn camera off' : 'Enable camera';
    this.els.start.disabled = this.state !== 'ready';
    this.els.pause.disabled = !['running', 'paused'].includes(this.state);
    this.els.pause.textContent = this.state === 'paused' ? 'Resume' : 'Pause';
    this.els.stop.disabled = !['calibrating', 'running', 'paused'].includes(this.state);
  }

  async openCamera() {
    if (!['idle', 'report'].includes(this.state)) return;
    const epoch = ++this.epoch;
    this.state = 'loading';
    this.els.error.hidden = true;
    this.status('Opening camera and loading body tracking…');
    this.updateControls();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access needs localhost or HTTPS and a browser with webcam support.');
      }
      if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) {
        throw new Error('This browser does not support background body tracking. Try a current version of Chrome or Edge.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
      });
      if (this.epoch !== epoch) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.stream === stream) this.fail(new Error('The camera disconnected. Enable it again to start a new practice.'));
      });
      this.els.video.srcObject = stream;
      await this.els.video.play();
      if (this.epoch !== epoch) return;
      this.placeholder.hidden = true;
      await this.loadWorker();
      if (this.epoch !== epoch) return;
      this.state = 'ready';
      this.status('Camera ready. Face forward with your face and shoulders in view, then calibrate.');
      this.updateControls();
    } catch (error) {
      if (this.epoch !== epoch) return;
      const messages = {
        NotAllowedError: 'Camera permission was denied. Allow camera access in your browser settings, then try again.',
        NotFoundError: 'No camera was found. Connect a camera, then try again.',
        NotReadableError: 'Your camera is unavailable. Close other apps using it, then try again.',
      };
      this.fail(new Error(messages[error.name] || error.message));
    }
  }

  loadWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./presentation-worker.js', import.meta.url));
      this.worker = worker;
      let loading = true;
      const timeout = setTimeout(() => reject(new Error('Body tracking took too long to load. Try enabling the camera again.')), 45000);
      this.cancelLoad = () => { clearTimeout(timeout); reject(new Error('Camera setup cancelled.')); };
      worker.onmessage = ({ data }) => {
        if (worker !== this.worker) return;
        if (data.type === 'ready') {
          loading = false;
          clearTimeout(timeout);
          this.cancelLoad = null;
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timeout);
          if (loading) reject(new Error(data.message));
          else this.fail(new Error(data.message));
        } else if (data.type === 'sample') {
          if (this.flight?.timestamp === data.timestamp) this.clearFlight();
          if (data.epoch !== this.epoch) return;
          this.receive(data);
        }
      };
      worker.onerror = (event) => {
        if (worker !== this.worker) return;
        event.preventDefault();
        const error = new Error('Background body tracking failed. Try enabling the camera again in Chrome or Edge.');
        clearTimeout(timeout);
        if (loading) reject(error);
        else this.fail(error);
      };
      worker.postMessage({ type: 'init' });
    });
  }

  start() {
    if (this.state !== 'ready') return;
    this.epoch++;
    this.analyzer = new BodyLanguageAnalyzer();
    this.elapsed = 0;
    this.els.timer.textContent = '0:00';
    this.els.report.hidden = true;
    this.els.coverage.textContent = '';
    this.els.error.hidden = true;
    this.calibrationStart = performance.now();
    this.state = 'calibrating';
    this.status('Calibration: hold a comfortable forward-facing position for 3 seconds.');
    this.updateControls();
    this.startLoop();
  }

  startLoop() {
    this.stopLoop();
    this.lastVideoTime = -1;
    // One transferable frame in flight; slow devices naturally process fewer frames.
    this.loop = setInterval(() => {
      if (this.state === 'running') this.els.timer.textContent = formatDuration(this.activeSeconds());
      if (this.state === 'calibrating' && performance.now() - this.calibrationStart > 30000) {
        this.epoch++;
        this.stopLoop();
        this.state = 'ready';
        this.status('Calibration could not finish. Improve lighting, keep your face in view, and try again.');
        this.updateControls();
        return;
      }
      this.capture();
    }, 1000 / 12);
  }

  stopLoop() { clearInterval(this.loop); this.loop = null; }

  async capture() {
    const video = this.els.video;
    if (this.flight || !this.worker || video.readyState < 2 || video.currentTime === this.lastVideoTime
      || !['calibrating', 'running'].includes(this.state)) return;
    const timestamp = performance.now();
    const flight = { timestamp, epoch: this.epoch };
    const worker = this.worker;
    const seconds = this.state === 'calibrating' ? (timestamp - this.calibrationStart) / 1000 : this.activeSeconds(timestamp);
    this.flight = flight;
    this.lastVideoTime = video.currentTime;
    try {
      const scale = Math.min(1, 640 / video.videoWidth);
      const bitmap = await createImageBitmap(video, {
        resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
        resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
      });
      if (flight.epoch !== this.epoch || worker !== this.worker) {
        bitmap.close();
        if (this.flight === flight) this.clearFlight();
        return;
      }
      try {
        worker.postMessage({ type: 'frame', bitmap, timestamp, seconds, epoch: flight.epoch }, [bitmap]);
      } catch (error) { bitmap.close(); throw error; }
      flight.timeout = setTimeout(() => {
        if (this.flight === flight) this.fail(new Error('Body tracking stopped responding. Your completed observations are preserved below.'));
      }, 10000);
    } catch (error) {
      if (this.flight === flight) this.clearFlight();
      if (flight.epoch === this.epoch) this.fail(error);
    }
  }

  clearFlight() { clearTimeout(this.flight?.timeout); this.flight = null; }

  receive({ sample, seconds }) {
    if (this.state === 'calibrating') {
      const progress = this.analyzer.calibrate(sample, seconds);
      this.status(!sample.head
        ? 'Calibration: keep your face in view with even lighting.'
        : `Calibration: hold steady… ${Math.floor(progress * 100)}%`);
      if (progress === 1) {
        this.epoch++;
        this.runStart = performance.now();
        this.state = 'running';
        this.status('Practice in progress. Speak out loud; pause whenever you need a break.');
        this.updateControls();
      }
    } else if (this.state === 'running') this.analyzer.add(sample, seconds);
    this.els.coverage.textContent = `Current tracking: face ${sample.head ? 'visible' : 'not visible'} · shoulders ${sample.shoulders ? 'visible' : 'not visible'} · both hands ${sample.wrists ? 'visible' : 'not visible'}`;
  }

  activeSeconds(now = performance.now()) {
    return this.elapsed + (this.state === 'running' ? (now - this.runStart) / 1000 : 0);
  }

  pause(message = 'Practice paused. This time is excluded from your report.') {
    if (this.state !== 'running') return;
    this.elapsed = this.activeSeconds();
    this.state = 'paused';
    this.epoch++;
    this.analyzer.breakSegment();
    this.stopLoop();
    this.status(message);
    this.updateControls();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.epoch++;
    this.runStart = performance.now();
    this.state = 'running';
    this.status('Practice resumed. Speak out loud when you are ready.');
    this.updateControls();
    this.startLoop();
  }

  finish() {
    if (!['calibrating', 'running', 'paused'].includes(this.state)) return;
    this.elapsed = this.activeSeconds();
    this.epoch++;
    this.releaseCamera();
    this.state = 'report';
    this.els.timer.textContent = formatDuration(this.elapsed);
    this.status('Practice complete. Your camera is off. Review your feedback below.');
    this.els.coverage.textContent = '';
    renderBodyLanguageReport(this.els.report, this.analyzer.report(this.elapsed));
    this.els.report.focus();
    this.updateControls();
  }

  fail(error) {
    if (['running', 'paused'].includes(this.state)) this.finish();
    else {
      this.epoch++;
      this.releaseCamera();
      this.state = 'idle';
      this.status('Camera is off. Resolve the issue below, then enable it again.');
      this.updateControls();
    }
    this.els.error.textContent = error.message;
    this.els.error.hidden = false;
  }

  releaseCamera() {
    this.stopLoop();
    this.clearFlight();
    this.cancelLoad?.();
    this.cancelLoad = null;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.els.video.srcObject = null;
    this.placeholder.hidden = false;
  }

  leave() {
    if (['calibrating', 'running', 'paused'].includes(this.state)) this.finish();
    else {
      this.epoch++;
      this.releaseCamera();
      if (this.state !== 'report') {
        this.state = 'idle';
        this.status('Enable your camera to get started.');
      }
      this.updateControls();
    }
  }
}
