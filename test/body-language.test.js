import test from 'node:test';
import assert from 'node:assert/strict';
import { BodyLanguageAnalyzer, measureFrame } from '../frontend/js/body-language.js';
import { renderBodyLanguageReport, formatDuration } from '../frontend/js/presentation.js';

const neutral = () => ({
  head: { yaw: 0, pitch: 0 },
  shoulders: { x: 0.5, scale: 0.3 },
  wrists: [{ x: -0.5, y: 1 }, { x: 0.5, y: 1 }],
});
function calibrated() {
  const analyzer = new BodyLanguageAnalyzer();
  for (let i = 0; i <= 31; i++) analyzer.calibrate(neutral(), i / 10);
  assert.ok(analyzer.baseline);
  return analyzer;
}
function feed(analyzer, duration, sampleAt = neutral, start = 0) {
  for (let i = 0; i <= duration * 10; i++) analyzer.add(sampleAt(i / 10), start + i / 10);
}

test('calibration needs consecutive visible, steady observations', () => {
  const analyzer = new BodyLanguageAnalyzer();
  for (let i = 0; i < 20; i++) analyzer.calibrate(neutral(), i / 10);
  assert.equal(analyzer.calibrate({ head: null, shoulders: null, wrists: null }, 2), 0);
  for (let i = 21; i < 45; i++) analyzer.calibrate(neutral(), i / 10);
  assert.equal(analyzer.baseline, null);
  analyzer.calibrate({ ...neutral(), head: { yaw: 30, pitch: 0 } }, 4.5);
  for (let i = 46; i <= 76; i++) analyzer.calibrate(neutral(), i / 10);
  assert.ok(analyzer.baseline);
});

test('calibration needs only the face', () => {
  const analyzer = new BodyLanguageAnalyzer();
  const progress = [];
  for (let i = 0; i <= 31; i++) progress.push(analyzer.calibrate({ head: { yaw: 0, pitch: 0 }, shoulders: null, wrists: null }, i / 10));
  assert.ok(progress.includes(1));
  assert.equal(analyzer.baseline.x, null);
  feed(analyzer, 10, () => ({ ...neutral(), shoulders: { x: 0.9, scale: 0.3 } }));
  const report = analyzer.report(10);
  assert.equal(report.metrics.shift.fraction, null);
  assert.equal(report.metrics.head.fraction, 0);
  assert.deepEqual(report.events, []);
});

test('calibration tolerates intermittent shoulder tracking and restarts on drift', () => {
  const analyzer = new BodyLanguageAnalyzer();
  for (let i = 0; i <= 31; i++) analyzer.calibrate(i % 4 ? neutral() : { ...neutral(), shoulders: null }, i / 10);
  assert.equal(analyzer.baseline.x, 0.5);
  const drifting = new BodyLanguageAnalyzer();
  for (let i = 0; i <= 31; i++) drifting.calibrate({ ...neutral(), shoulders: { x: 0.5 + i * 0.01, scale: 0.3 } }, i / 10);
  assert.equal(drifting.baseline, null);
});

test('shift is relative to current shoulder width', () => {
  const analyzer = calibrated();
  feed(analyzer, 10, () => ({ ...neutral(), shoulders: { x: 0.6, scale: 0.3 } }));
  assert.equal(analyzer.report(10).metrics.shift.fraction, 1);
  const closer = calibrated();
  feed(closer, 10, () => ({ ...neutral(), shoulders: { x: 0.6, scale: 0.6 } }));
  assert.equal(closer.report(10).metrics.shift.fraction, 0);
});

test('neutral presentation has a high forward fraction and no gesture activity', () => {
  const analyzer = calibrated();
  feed(analyzer, 10);
  const report = analyzer.report(10);
  assert.ok(report.metrics.head.coverage > 0.99);
  assert.equal(report.metrics.head.fraction, 0);
  assert.equal(report.metrics.shift.fraction, 0);
  assert.equal(report.metrics.gestures.fraction, 0);
  assert.deepEqual(report.events, []);
});

test('sustained head turn and sideways shift create timed events', () => {
  const analyzer = calibrated();
  feed(analyzer, 10, () => ({ ...neutral(), head: { yaw: 40, pitch: 0 }, shoulders: { x: 0.7, scale: 0.3 } }));
  const report = analyzer.report(10);
  assert.equal(report.metrics.head.fraction, 1);
  assert.equal(report.metrics.shift.fraction, 1);
  assert.deepEqual(Object.keys(report.metrics), ['head', 'shift', 'gestures']);
  assert.equal(report.events.length, 2);
  assert.ok(report.events.every((event) => event.start === 0 && event.end === 10));
});

test('a brief glance is not a sustained event', () => {
  const analyzer = calibrated();
  feed(analyzer, 10, (s) => ({ ...neutral(), head: { yaw: s > 3 && s < 3.7 ? 40 : 0, pitch: 0 } }));
  assert.equal(analyzer.report(10).events.length, 0);
});

test('missing landmarks reduce coverage rather than count as good posture or no gestures', () => {
  const analyzer = calibrated();
  feed(analyzer, 10, (s) => s < 3 ? neutral() : { head: null, shoulders: null, wrists: null });
  const report = analyzer.report(10);
  for (const metric of Object.values(report.metrics)) {
    assert.ok(metric.coverage < 0.3);
    assert.equal(metric.fraction, null);
  }
});

test('pauses separate events and do not bridge into gesture speed', () => {
  const analyzer = calibrated();
  const turn = () => ({ ...neutral(), head: { yaw: 40, pitch: 0 } });
  feed(analyzer, 1, turn);
  analyzer.breakSegment();
  feed(analyzer, 1, turn, 1);
  const report = analyzer.report(2);
  assert.equal(report.events.length, 0);
  assert.ok(Math.abs(report.metrics.head.validSeconds - 2) < 1e-8);
});

test('long processing gaps do not add usable time or join brief events', () => {
  const analyzer = calibrated();
  const turn = () => ({ ...neutral(), head: { yaw: 40, pitch: 0 } });
  feed(analyzer, 1, turn);
  feed(analyzer, 1, turn, 9);
  const report = analyzer.report(10);
  assert.equal(report.events.length, 0);
  assert.ok(report.metrics.head.coverage < 0.21);
});

test('wrist movement is measured relative to the shoulders', () => {
  const analyzer = calibrated();
  feed(analyzer, 10, (s) => ({ ...neutral(), wrists: [{ x: s, y: 1 }, { x: 0.5, y: 1 }] }));
  assert.equal(analyzer.report(10).metrics.gestures.fraction, 1);
});

test('calibration handles angle wraparound', () => {
  const analyzer = new BodyLanguageAnalyzer();
  for (let i = 0; i <= 31; i++) analyzer.calibrate({ ...neutral(), head: { yaw: i % 2 ? -179 : 179, pitch: 0 } }, i / 10);
  feed(analyzer, 10, () => ({ ...neutral(), head: { yaw: -179, pitch: 0 } }));
  assert.equal(analyzer.report(10).metrics.head.fraction, 0);
});

function poseFixture() {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [i, x, y] of [[11, 0.4, 0.3], [12, 0.6, 0.3], [23, 0.4, 0.7], [24, 0.6, 0.7], [15, 0.3, 0.5], [16, 0.7, 0.5]]) {
    points[i] = { x, y, visibility: 0.9, presence: 0.9 };
  }
  return { landmarks: [points] };
}

test('geometry respects aspect ratio and rejects invisible or cropped landmarks', () => {
  const pose = poseFixture();
  const sample = measureFrame(pose, {}, 640, 480);
  assert.ok(Math.abs(sample.wrists[0].x + 1) < 1e-8);
  assert.ok(Math.abs(sample.shoulders.scale - 0.2 * 640 / 480) < 1e-8);
  assert.ok(Math.abs(sample.shoulders.x - 0.5 * 640 / 480) < 1e-8);
  pose.landmarks[0][23].y = 1.1;
  assert.ok(measureFrame(pose, {}, 640, 480).wrists, 'hips out of frame do not affect wrists');
  pose.landmarks[0][15].visibility = 0.2;
  assert.equal(measureFrame(pose, {}, 640, 480).wrists, null);
});

test('face orientation comes from the transformation normal', () => {
  const yaw = Math.PI / 6;
  const data = [Math.cos(yaw), 0, -Math.sin(yaw), 0, 0, 1, 0, 0, Math.sin(yaw), 0, Math.cos(yaw), 0, 0, 0, -30, 1];
  const face = { faceLandmarks: [[{}]], facialTransformationMatrixes: [{ data }] };
  const sample = measureFrame({}, face, 640, 480);
  assert.ok(Math.abs(sample.head.yaw - 30) < 1e-8);
  assert.equal(sample.head.pitch, -0);
  data[8] = NaN;
  assert.equal(measureFrame({}, face, 640, 480).head, null);
});

test('report displays unavailable measurements honestly and uses active clock timestamps', () => {
  const analyzer = calibrated();
  feed(analyzer, 3);
  const element = { innerHTML: '', hidden: true };
  renderBodyLanguageReport(element, analyzer.report(3));
  assert.match(element.innerHTML, /Not enough data/);
  assert.match(element.innerHTML, /0:03 active practice/);
  assert.equal(element.hidden, false);
  assert.equal(formatDuration(125.8), '2:05');
});
