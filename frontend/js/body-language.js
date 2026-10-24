// Pure geometry and timing rules, shared by the worker and deterministic tests.
// Thresholds are coaching heuristics, not validated measures of speaking ability.
const DEG = 180 / Math.PI;
export const SHIFT_LIMIT = 0.3; // sideways shift, in current shoulder widths
export const GESTURE_SPEED = 0.35; // wrist speed, in shoulder widths per second
const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;
const mean = (values) => values.reduce((sum, n) => sum + n, 0) / values.length;
const angleMean = (values) => Math.atan2(
  mean(values.map((n) => Math.sin(n / DEG))),
  mean(values.map((n) => Math.cos(n / DEG))),
) * DEG;

function visible(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    && (point.visibility ?? 1) >= 0.6 && (point.presence ?? 1) >= 0.6;
}

export function measureFrame(pose, face, width, height) {
  const result = { head: null, shoulders: null, wrists: null };
  const points = pose?.landmarks?.[0];
  const aspect = width / height;
  if (!Number.isFinite(aspect) || aspect <= 0) return result;
  if (points && [11, 12].every((i) => visible(points[i]))) {
    const [left, right] = [points[11], points[12]];
    const shoulderX = (left.x + right.x) * aspect / 2;
    const shoulderY = (left.y + right.y) / 2;
    const scale = Math.hypot((left.x - right.x) * aspect, left.y - right.y);
    if (scale > 0.04) {
      result.shoulders = { x: shoulderX, scale };
      if ([15, 16].every((i) => visible(points[i]))) {
        result.wrists = [15, 16].map((i) => ({
          x: (points[i].x * aspect - shoulderX) / scale,
          y: (points[i].y - shoulderY) / scale,
        }));
      }
    }
  }
  const matrix = face?.facialTransformationMatrixes?.[0]?.data;
  if (face?.faceLandmarks?.[0]?.length && matrix?.length === 16
      && [matrix[8], matrix[9], matrix[10]].every(Number.isFinite)
      && Math.hypot(matrix[8], matrix[9], matrix[10]) > 0.5) {
    // MediaPipe matrices are column-major; the third column is the face normal.
    result.head = {
      yaw: Math.atan2(matrix[8], matrix[10]) * DEG,
      pitch: Math.atan2(-matrix[9], Math.hypot(matrix[8], matrix[10])) * DEG,
    };
  }
  return result;
}

export class BodyLanguageAnalyzer {
  /** `baseline` ({ yaw, pitch, x }) skips calibration, e.g. a usual position measured elsewhere. */
  constructor({ baseline = null } = {}) {
    this.calibration = [];
    this.baseline = baseline;
    this.previous = null;
    this.smooth = {};
    this.stats = Object.fromEntries(['head', 'shift', 'gestures'].map((key) => [key, { valid: 0, flagged: 0 }]));
    this.pending = {};
    this.events = [];
  }

  calibrate(sample, seconds) {
    if (!sample.head) {
      this.calibration = [];
      return 0;
    }
    const first = this.calibration[0];
    const last = this.calibration.at(-1);
    const firstShoulders = this.calibration.find((s) => s.shoulders)?.shoulders;
    if (last && (seconds - last.seconds > 0.5
      || Math.abs(angleDelta(sample.head.yaw, first.head.yaw)) > 8
      || Math.abs(angleDelta(sample.head.pitch, first.head.pitch)) > 8
      || (sample.shoulders && firstShoulders
        && Math.abs(sample.shoulders.x - firstShoulders.x) / firstShoulders.scale > 0.15))) {
      this.calibration = [];
    }
    this.calibration.push({ ...sample, seconds });
    const elapsed = seconds - this.calibration[0].seconds;
    if (elapsed >= 3 && this.calibration.length >= 12) {
      // Shoulders are optional: without them for most of calibration, shift stays unmeasured.
      const shoulders = this.calibration.filter((s) => s.shoulders).map((s) => s.shoulders.x);
      this.baseline = {
        yaw: angleMean(this.calibration.map((s) => s.head.yaw)),
        pitch: angleMean(this.calibration.map((s) => s.head.pitch)),
        x: shoulders.length >= this.calibration.length / 2 ? mean(shoulders) : null,
      };
      this.calibration = [];
      return 1;
    }
    return Math.min(elapsed / 3, 0.99);
  }

  add(sample, seconds) {
    if (!this.baseline) throw new Error('Calibration is required before analysis.');
    const previous = this.previous;
    const dt = previous ? seconds - previous.seconds : 0;
    const continuous = dt > 0 && dt <= 0.5;
    if (!continuous) {
      this.breakSegment();
      this.previous = { ...sample, seconds };
      return;
    }
    const alpha = 1 - Math.exp(-dt / 0.25);
    const smooth = (key, value) => {
      this.smooth[key] = this.smooth[key] == null ? value : this.smooth[key] + alpha * (value - this.smooth[key]);
      return this.smooth[key];
    };
    const flags = { head: null, shift: null, gestures: null };
    if (sample.head && previous.head) {
      const yaw = smooth('yaw', angleDelta(sample.head.yaw, this.baseline.yaw));
      const pitch = smooth('pitch', angleDelta(sample.head.pitch, this.baseline.pitch));
      flags.head = Math.abs(yaw) > 25 || Math.abs(pitch) > 20;
    } else {
      delete this.smooth.yaw;
      delete this.smooth.pitch;
    }
    if (this.baseline.x != null && sample.shoulders && previous.shoulders) {
      // Current width keeps the measure stable when moving toward or away from the camera.
      const shift = smooth('shift', (sample.shoulders.x - this.baseline.x) / sample.shoulders.scale);
      flags.shift = Math.abs(shift) > SHIFT_LIMIT;
    } else delete this.smooth.shift;
    if (sample.wrists && previous.wrists) {
      const speed = mean(sample.wrists.map((wrist, i) => Math.hypot(
        wrist.x - previous.wrists[i].x, wrist.y - previous.wrists[i].y,
      ))) / dt;
      flags.gestures = smooth('speed', speed) > GESTURE_SPEED;
    } else delete this.smooth.speed;

    for (const [key, flagged] of Object.entries(flags)) {
      if (flagged != null) {
        this.stats[key].valid += dt;
        if (flagged) this.stats[key].flagged += dt;
      }
      if (key !== 'gestures') this.updateEvent(key, flagged, seconds, dt);
    }
    this.previous = { ...sample, seconds };
  }

  updateEvent(key, flagged, seconds, dt) {
    if (flagged) {
      this.pending[key] ??= { type: key, start: seconds - dt, end: seconds };
      this.pending[key].end = seconds;
    } else this.finishEvent(key);
  }

  finishEvent(key) {
    const event = this.pending[key];
    if (event && event.end - event.start >= 2 && this.events.length < 200) {
      this.events.push({ ...event });
    }
    delete this.pending[key];
  }

  breakSegment() {
    for (const key of Object.keys(this.pending)) this.finishEvent(key);
    this.previous = null;
    this.smooth = {};
  }

  report(activeSeconds) {
    this.breakSegment();
    return {
      activeSeconds,
      calibrated: Boolean(this.baseline),
      metrics: Object.fromEntries(Object.entries(this.stats).map(([key, stat]) => [key, {
        validSeconds: stat.valid,
        coverage: activeSeconds > 0 ? Math.min(1, stat.valid / activeSeconds) : 0,
        // Missing observations never count as either good or bad behavior.
        fraction: stat.valid >= 5 ? stat.flagged / stat.valid : null,
      }])),
      events: [...this.events].sort((a, b) => a.start - b.start),
    };
  }
}
