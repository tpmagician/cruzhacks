import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceTracks } from '../frontend/js/delivery-metrics.js';

test('per-second tracks average loudness and preserve real gaps between answers', () => {
  const tracks = voiceTracks([
    { t: 10.2, db: -40, f0: null },
    { t: 0.9, db: -30, f0: 200 },
    { t: 0.1, db: -10, f0: 200 },
    { t: 2.1, db: -26, f0: 200 },
    { t: 2.2, db: -26, f0: 200 },
  ]);
  assert.deepEqual(tracks.loudness, [{ t: 0, v: 0 }, { t: 2, v: -6 }, { t: 10, v: -20 }]);
  assert.deepEqual(tracks.pitch, [{ t: 0, v: 0 }, { t: 2, v: 0 }]);
});

test('relative pitch and loudness are unchanged by a different baseline voice or mic gain', () => {
  const frames = [0, 1, 2].flatMap((t) => [0.1, 0.2].map((offset) => ({ t: t + offset, db: -20 - 5 * t, f0: 100 * 2 ** t })));
  const shifted = frames.map((f) => ({ ...f, db: f.db + 10, f0: f.f0 * 2 }));
  assert.deepEqual(voiceTracks(shifted), voiceTracks(frames));
  assert.deepEqual(voiceTracks(frames).pitch.map((p) => p.v), [-12, 0, 12]);
});

test('single voiced frames are insufficient for pitch and silence remains finite', () => {
  const tracks = voiceTracks([{ t: 0.1, db: -100, f0: null }, { t: 1.1, db: -100, f0: 200 }, { t: 2.1, db: -100, f0: null }]);
  assert.deepEqual(tracks.pitch, []);
  assert.ok(tracks.loudness.every((p) => Number.isFinite(p.v)));
  assert.deepEqual(voiceTracks(null), { loudness: [], pitch: [] });
});
