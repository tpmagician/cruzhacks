# MACH feedback-side implementation plan

The sensing side of MACH (Hoque et al., UbiComp 2013) is built: smile intensity,
Praat-style pauses, pitch, pace, and filler
words, plus extras MACH never measured. What is missing is the feedback side. In
the paper, only the group that got video replay *plus* feedback improved; video
alone did not help. This plan closes that gap, in build order.

Checked against `back` at `db366f8`. Status of the earlier review's items:

| Item | Status |
|---|---|
| Smile track 0–100 with question markers | Built (`smileBuckets` → `smileTimeline()`) |
| Nods/shakes, MACH algorithm | Built, then removed from the app |
| Interviewer voice | Built (`Speaker` in `voice.js`) |
| MediaPipe and models served locally | Built (`npm run setup:models`, no CDN) |
| Pitch and loudness tracks | Built in Phase 1 |
| Listening face for the interviewer | Missing: static "J" circle |
| Video replay | Missing (methodology milestone 5) |
| Session comparison | Missing |
| Webcam snapshots to Gemma | Missing; conflicts with the methodology (see Phase 6) |
| Deepgram word timings | Missing: `viaDeepgram` keeps only the transcript text |

## Phase 1: Pitch and loudness tracks (~45 min)

**Status: done.** `voiceTracks()` in `delivery-metrics.js`, three-lane chart in `report.js`, smile wording in `DELIVERY_GUIDE`, tests in `test/delivery-metrics.test.js`.

Everything after this depends on it.

- `delivery.js`: while a segment is open, `_startAudioLoop` adds each frame to a
  per-second `audioBuckets` map (`{ dbSum, n, f0s }`), like `smileBuckets`.
  `sessionSummary()` returns `tracks: { smile, loudness, pitch }`, one point per
  second. Loudness is dB relative to the session's loudest second; pitch is
  semitones relative to the session median, so different voices are comparable.
- `delivery-metrics.js`: a pure helper for the per-second tracks, so they are testable.
- `report.js`: generalize `smileTimeline()` into one SVG with three stacked lanes
  that share `x(t)` and the question markers. Keep breaking lines at gaps over 2 s.
- Tests: per-second averaging, gaps between answers, null pitch on unvoiced seconds.
- Prompt (5 min): reword the smile line in `DELIVERY_GUIDE` so smiling is something
  to explore, not a target. MACH itself warns about penalizing people for smiling less.

## Phase 2: Video replay with synced tracks (~2 h; cut-down ~1 h)

The time base already exists: `tracker.now()` drives every track, so
`video.currentTime + recStart` maps playback to track time.

1. **Record (30 min, `delivery.js`).** After both streams open in `_start()`, create
   `new MediaRecorder(new MediaStream([...videoTracks, ...audioTracks]), { mimeType, videoBitsPerSecond: 500_000 })`
   and `start(1000)`; store `recStart = this.now()`. Pick the type with
   `isTypeSupported`: `video/webm;codecs=vp9,opus`, then `video/webm`, then
   `video/mp4`; if none, skip recording. In `stop()`, stop the recorder *before*
   the tracks. Expose `tracker.recording()` → `Promise<{ blob, recStart }>`.
2. **Report (30 min, `app.js`/`report.js`).** In `goToReport`, await the recording,
   create a `blob:` URL, and pass `replay: { url, recStart }` with the session
   delivery. Render `<video controls>` above the tracks, plus "Jump to B1 / T1…"
   buttons from `marks`.
3. **Synced playhead (40 min, full version only).** One `<line>` across all lanes,
   moved on `timeupdate`. Clicking a lane seeks to `tAt(clickX) - recStart`. Chrome
   WebM duration is `Infinity`: on `loadedmetadata`, set `currentTime = 1e9`, then
   reset to 0 on `durationchange`.
4. **Privacy (20 min).** Opt-in "Record video for replay (kept in this tab only)"
   checkbox, off by default. Update `index.html`, the README, and the methodology,
   which currently say video is never recorded. `URL.revokeObjectURL` on new
   interview or retry.

Known limitation: the interviewer is silent in the replay, because echo cancellation
removes the synthesized voice from the mic. The jump buttons make this a minor issue.

Memory: about 4 MB per minute at 500 kbps, so a 30-minute interview is about 120 MB in memory.

## Phase 3: "How do you think you came across?" (~30 min)

Before the replay, a short self-rating (1–5 sliders for pace, smiling, filler words,
pauses). After submitting, show the guesses next to the measured values, then reveal
the video. In memory only. Optional, with a "Skip" link. MACH borrowed this step from
social-anxiety therapy.

## Phase 4: Listening interviewer (~45 min)

- A small SVG/CSS face for Jordan in the coach bar. While `floorOpen && !speaking`
  and the mic level is above the speech threshold, it nods on a random 3–5 s
  interval (MACH's counselors averaged 4.12 s).
- `onTick` also passes the current smile value; Jordan smiles back when it is above 50.
- Respect `prefers-reduced-motion`.

## Phase 5: Session comparison (~1 h)

- An explicit **Save this session for comparison** button on the report (the
  methodology requires explicitly selected history with deletion controls, so no
  automatic saving). Store in `localStorage['ips-history']`, at most 10 entries:
  date, role, a downsampled smile track, and pace, pause share, filler share, and
  pitch variation.
- A "Compared with your last saved session" panel: four paired bars, with past smile
  tracks drawn in muted colors on the same chart.
- A **Clear history** button and a note that history stays in this browser.

## Phase 6 (optional): Webcam snapshot to Gemma (~45 min)

Asking a model about posture in real interview frames conflicts with the
methodology: it rules out scoring posture conformity or appearance, and it treats
framing and lighting as experimental with no automatic advice until validated. It
would also break the "video never leaves the device" promise.

A version that stays within those limits, for the multimodal angle:

- An opt-in **camera check** before the interview. One 320 px JPEG goes to Gemma
  with a prompt limited to framing, lighting, and camera height.
- Not stored, not sent to the evaluator, and no effect on scoring.
- First confirm that the Gemma 4 model in use accepts image input through `generate()`.

## Phase 7 (later): Deepgram word timings (~20 min)

Keep `words[].start/end` from the Deepgram response. This fixes the methodology's
"no timed word record" gap and enables MACH's word strip (width = duration,
height = loudness). Only works when Deepgram is configured; the Gemini fallback
has no timings.

For the pitch: transcription runs on Gemini or Deepgram, not Gemma.

## Order by time available

| Time | Build |
|---|---|
| 3 h or more | 1 → 2 (full) → 4 → 3 |
| About 2 h | 1 → 2 (cut-down: video and jump buttons, no playhead) |
| Under 1 h | 1 only, plus the smile wording fix |

After those, Phase 5 adds the most. Phase 6 only if the multimodal prize matters,
and only in the limited form above.

Demo risks: recording, face tracking, and pose tracking together load the CPU, so
test a 10-minute interview on the demo laptop. Make sure a denied camera or mic
permission still leaves a typed interview with content feedback.
