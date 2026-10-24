# Faster feedback reports: audit and implementation plan

Reviewed October 24, 2026 against checkout `de9b4f3`, including backend routes,
provider wrappers, prompts/parsing, all browser modules, HTML/CSS, setup script,
package configuration, existing tests, and the feedback/testing documentation.
API keys and real interview recordings were not inspected. No paid API calls
were made. The audit below describes the original baseline; implementation status
has been updated after the progressive report work.

## Progressive report implementation status

Implemented:

- Immediate delivery/track/transcript rendering with separate pending AI slots.
- Evaluation starts without `settle()`; late transcription updates local slots
  after device stop, retaining estimates/provenance when audio is unavailable.
- Filler metrics are excluded from the frozen evaluation snapshot and server
  prompt inputs. No automatic rescore follows count changes.
- Report controller deduplicates entry, cancels superseded requests, unsubscribes
  on exit, and ignores stale success/error/finally callbacks. Interview requests
  also capture their session and cancellation controller.
- 60-second route deadlines include JSON repair; model invocations have a total
  60-second limit, 30-second attempts, cancellable backoff, and at most one
  transient retry per model. Browser requests have a 65-second deadline covering
  response-body consumption; health checks use 10 seconds.
- Server disconnects propagate cancellation to provider requests. Audio requests
  cannot fall back to the interview text model. New session/page exit cancels
  pending transcription; ordinary device stop allows it to finish.
- Browser fixture and deterministic controller/renderer/API/provider/route tests
  cover loading, independent updates, failure, retry, cancellation, and races.

Still deferred: detailed production timing instrumentation, bounded transcription
upload concurrency/queue memory, incremental sensor aggregation, device-startup
ownership hardening, prompt/output size changes, and scoring-contract corrections.
No claim is made that the first-paint performance target below has been measured
across devices. The sequence below remains the design rationale and backlog.

## Current critical path

```text
Interviewer's goodbye finishes
  -> 3-second automatic navigation delay (manual View report bypasses this)
  -> stop devices
  -> compute session tracks/listening summary on the main thread
  -> show report screen and clear its contents
  -> await tracker.settle(): up to 60 seconds for outstanding transcriptions
  -> POST /api/evaluate with all answered questions/code/delivery summaries
  -> high-thinking model generation
  -> potentially retry generation for invalid JSON
  -> normalize and render the entire report
```

Transcriptions already start after each answer, concurrently with the interview;
the 60-second wait is only for remaining requests, not 60 seconds per answer.
The frontend has no evaluation deadline. The default/fallback model has no
application-level generation deadline. The other model has a 60-second deadline
per attempt before falling back. Each `generate()` can make an initial request
and three transient-error retries, with 1/2/4-second sleeps, on each model; JSON
repair can invoke this whole process again. The loading copy promising "up to a
minute" therefore does not describe an actual upper bound.

This checkout contains Phase 1 delivery tracks, with no replay recorder/player.
Unlike an earlier workspace snapshot, there is currently no recording-finalization
wait to remove. Future replay must stay off the report's critical path.

## Findings, ranked by user impact

| Priority | Finding and code | Effect / action |
| --- | --- | --- |
| P1 | `app.js: loadReport` waits for `DeliveryTracker.settle` before evaluating | Up to 60 seconds of avoidable startup delay. Start evaluation immediately; let filler counts finish separately. |
| P1 | `report.js: renderReport` has only completed/failed states | No useful output until remote scoring returns. Add an explicit pending state and independent local/AI sections. Missing pending scores must not read "unable to score". |
| P1 | `gemini.js: generate`, `api.js: post`, and Deepgram fetch have incomplete/no deadlines | The spinner and uploads can outlive the user session. Add cancellation and an end-to-end budget including backoff, fallback, and JSON repair. |
| P1 | `app.js: loadReport` reads global `session` after awaits, without a session/request check | An old transcription wait can score a new session; an old evaluation can overwrite a newer report or touch a null session. Use a captured session and request revision; abort superseded work. |
| P1 | `transcribe.js: viaGemini` shares the general Gemma fallback policy | An audio-model timeout/error can route WAV input to the interview text-model fallback. Give transcription a separate, explicitly compatible fallback policy. This is a routing bug regardless of provider availability. |
| P1 | `delivery.js: _pushPcm` caps audio at 300 seconds, but later overwrites whole-answer counts with that prefix transcript | Incorrect long-answer filler counts. Fixed here: enforce the exact cap and keep full dictated counts for truncated recordings. Later support segmented transcription with explicit coverage. |
| P2 | `summarizeAudio` searches every sounding interval per frame; `phraseEndings` filters the full frame array per phrase | O(A × P) interval matching for A audio frames / P phrases, tending toward quadratic as recordings grow. Fixed here with chronological cursors. Sorting for medians still costs O(A log A) in the overall summary. |
| P2 | `findSpeech` spreads every dB value into `Math.max` | A 150,000-frame synthetic recording reproducibly throws `RangeError`. Fixed here with a reduction. The WAV cap does not cap the prosody frame arrays. |
| P2 | `delivery.js: endSegment` rescans all session face frames and recomputes head/body medians at every answer | With F accumulated frames / Q segments, roughly O(Q × F log F) work in the equal-size worst case, and allocations on Send. Use a segment start index and a defined baseline policy; avoid silently changing measurement semantics while optimizing. |
| P2 | `delivery.js: _startAudioLoop` runs normalized autocorrelation on the main thread every 50 ms | O(N × L) per frame, where N=2048 samples and L is the searched lag range (about 385 at 48 kHz). Can compete with typing, WAV encoding, and rendering on slower devices. Profile on target hardware before moving analysis into a worker/worklet. |
| P2 | Raw face and voice frames grow for the whole session; every segment can launch a transcription | O(F + A) retained sensor data; up to ~9.6 MB of WAV per pending full-size answer, with additional server/base64 copies for Gemini. Bound upload concurrency, cancel old jobs, and later retain aggregates/bounded raw windows. |
| P2 | `delivery.js: _start` requests camera/mic sequentially and awaits camera model startup before setting up audio | A camera prompt/model stall delays mic measurement; cancellation while worker/context startup is pending has incomplete cleanup. Use resource ownership per startup revision and cleanup in `finally`; initialize independent devices concurrently. |
| P2 | `parse.js: tryParseJson` repairs trailing commas with a global regex | Repair could alter quoted feedback/code such as `,}`. Fixed here with string-aware punctuation repair. |
| P2 | `normalizeEvaluation` clamps/coerces scores and falls back to question position | Invalid scores can become valid-looking badges; unknown IDs can attach feedback to the wrong question. Address as a separate scoring-contract fix with tests for invalid integers, booleans, duplicates, and mismatched IDs. The README currently overstates out-of-range handling. |
| P2 | `server.js` clips individual text fields but has no aggregate evaluator token budget | The 2 MB JSON limit bounds HTTP size, not affordable prompt size. Full code can occur in transcript turns and again as final code. Add measured input/output budgets and preserve evidence when reducing duplication. |
| P2 | `interview.js: prepareAnswer` updates `rec.code` only when new code is nonempty | Deleting code after a follow-up can leave stale final code for evaluation. Add a regression and update final editor state separately from unchanged-code suppression. |
| P3 | `settle` left its timer running after an early finish; reset switched pending sets while old jobs referenced `this.pending` | Fixed here: clear the timer and capture the owning pending set, ignoring responses after reset. This does not yet cancel their HTTP requests. |
| P3 | `report.js` finds a model question for each record; `retrySetup` does the same | O(Q²), but only up to 16 questions in normal plans / 30 accepted by the server. Use a Map during report refactoring; this is not the dominant latency source. |
| P3 | SVG report generation is linear in per-second track points | Already downsampled to seconds; avoid rebuilding tracks on each late transcript. No evidence that replacing SVG or adding virtualization is needed at current limits. |
| P3 | `parse.js: parseProblem` appends strings per line; `server.js: toContents` merges adjacent roles | Potential copying for large text, currently bounded by request/text limits. Lower priority than provider waits and repeated sensor scans. |

The camera worker already transfers image bitmaps, limits capture to one request
in flight, closes bitmaps, and runs pose on alternate frames. The downloader
already verifies pinned checksums and writes via a temporary file. Keep these
properties. Hint storage and speech chunking are small bounded workloads and are
not report bottlenecks. Speech dictation/recognizer restart races and timeout
waiter cleanup should be covered when hardening media lifecycle; they do not
explain the report's minute-long transcription gate.

## Target behavior and state contract

Open the report with measured delivery chips/tracks and the transcript available.
Show a small "AI feedback is loading" status beside the AI sections. Failed AI
evaluation leaves the local report usable and offers retry for AI feedback only.
Late transcription updates the affected filler counts without hiding the report,
rebuilding charts, resetting expanded answers, or starting another evaluation.

Use independent state rather than one global loading boolean:

```js
{
  sessionId, requestRevision,
  local: { status: 'ready', records, tracks, listening },
  fillers: { status: 'pending' /* ready | partial | unavailable */, pendingCount },
  ai: { status: 'loading' /* ready | error */, requestSnapshot, report, error }
}
```

Per-answer filler metadata must include the source (`dictation`, `verbatim`, or
typed text), status, and audio coverage. Dictation is an estimate; a failed, empty,
cancelled, or truncated transcription must never turn into a falsely confirmed
zero. Some answers may finish successfully while others keep estimates. Preserve
these distinctions in per-question and aggregate presentation. Mixed typed/spoken
answers also need a defined scope: speech filler metrics must not silently swap
between a typed-plus-dictated denominator and a speech-only denominator.

For the first implementation, omit **all filler-derived numbers** (`words`,
`fillers`, `fillerShare`, `fillerWords`) from the AI evaluation snapshot. Render
them locally with provenance. Keep other delivery coaching and content evaluation
in the same existing `/api/evaluate` call. This prevents late transcription from
contradicting AI advice based on earlier numbers. Tell the evaluator not to infer
filler-frequency coaching when measured filler data is absent. Never send zeros
as substitutes for omitted fields. Content scoring continues to use the committed
candidate transcript and code; audio transcription does not rewrite that evidence.

If AI filler coaching is wanted later, add an explicit optional refresh after
counts settle. Version its input snapshot and label its source. Do not silently
rescore the interview on each background transcription completion.

## Implementation sequence

### 1. Instrument the actual critical path

- Add client marks for report navigation, summary start/end, first useful paint,
  evaluation dispatch/response, AI render, and transcription updates.
- Add a request ID and server timings for prompt construction, each provider
  attempt, backoff/fallback, JSON repair, normalization, and total route time.
  Record input/output size and token usage when available, without logging
  transcript contents, audio, keys, or generated feedback.
- Use the offline benchmark below for CPU regressions and browser Performance
  traces for paint/long tasks. Sample short/standard/long sessions, voice off/on,
  delivery off/on, and short/long answers. Report p50/p95 separately for first
  useful content and complete AI feedback; do not conflate them.

### 2. Render local results immediately and start scoring independently

- In `app.js: goToReport`, capture the current session, finalize media once,
  and compute/cache its local summary once. Clear stale `lastReport` on entry.
- Split `report.js` rendering into stable local delivery/track/transcript roots
  and separate AI overview/per-question slots. Add a real pending state, preserving
  the existing failure state for completed unsuccessful evaluations.
- In `index.html`, replace the all-or-nothing loader with an accessible status
  (`role="status"`, polite live updates) for AI feedback. Mark only AI regions
  busy. Remove the unsupported "up to a minute" promise.
- Dispatch `api.evaluate` immediately from a frozen payload. Remove
  `await tracker.settle()` from this path. Do not simply delete the await and
  leave the rest unchanged: otherwise counts/coaching become stale and no local
  content appears until AI completion.
- Add a `DeliveryTracker` subscription for per-answer transcription status/count
  changes. Keep updates enabled after `stop()` so pending audio can finish for
  this report; unsubscribe/cancel on reset/new interview/page exit. Batch updates
  to the filler UI per frame; do not regenerate the SVG.
- Mask filler numbers in a report-specific evaluation payload option and in the
  server cleaner/prompt contract. Do not mutate the live delivery objects to do
  this. Include provenance in the local view model, not in content scores.
- Keep delivery-disabled and permission-denied interviews useful: show their
  committed transcript while feedback loads and do not invent sensor data.
- Keep New interview available. Enable Retry weak questions only for the active
  completed result; an explicit unscored retry can remain a separate fallback.

Tests: hold transcription unresolved indefinitely and verify that evaluation is
dispatched and local content is visible; hold evaluation unresolved and verify
metrics/transcript remain usable. Exercise successful/failed/mixed transcription,
empty speech, typed answers, no answered questions, and an AI failure after a late
filler update. Assert late filler counts never trigger a second evaluation or
alter already-generated content scores. Preserve escaped HTML and existing tracks.

### 3. Bound and isolate all asynchronous work

- Introduce a small report controller with a captured session and monotonically
  increasing evaluation revision. Ignore stale success, error, and `finally`
  callbacks. Capture before *any* await. Repeated View report clicks should reuse
  the in-flight request; explicit retry supersedes it. Keep cache reuse in memory
  and limited to the exact session/payload revision.
- Add AbortSignal support and distinguish cancellation, deadline, and network
  errors in `api.js`. Abort superseded evaluation/transcription requests on new
  session or page exit. Browser cancellation alone is insufficient: propagate
  connection-close cancellation through the Express route to the provider.
- Give evaluation one server deadline shared by the initial generation and JSON
  repair, with bounded attempts/backoff inside it. Proposed starting values:
  60 seconds total and at most one transient retry; tune from measurements.
  The client deadline should slightly exceed the server's so it can display the
  structured failure. Per-attempt timeouts must cover response-body consumption.
- Apply deadlines to the default model too. On expiry, return a specific retryable
  error and retain the local report. Keep interviewer and transcription policies
  separately configurable so evaluation changes do not unexpectedly alter turns.
- Separate audio fallback from text fallback. Do not route audio to the Gemma
  interview fallback. Deepgram needs its own timeout/cancel handling. A timeout
  on optional transcription should retain labeled estimates.
- Limit optional transcription uploads to two in flight, enqueue the rest, and
  cancel queued work from an old session. Keep core evaluation outside that queue.
  Bound queue memory and surface fallback status when dropping old audio.

Tests: use deferred promises and fake clocks for default-model hangs, cancellation
mid-body, JSON repair consuming the same budget, retry backoff cancellation, audio
fallback policy, maximum upload concurrency, duplicate clicks, out-of-order
responses, New interview, and retry. Late jobs must not mutate counts/DOM/button
state for another session. Extract provider/route construction for offline tests;
current `server.js` starts listening on import and the existing suite does not
exercise the real Express/provider retry paths.

### 4. Reduce AI generation work after measuring it

- Record prompt/output sizes and latency before changing quality settings.
- Remove repeated final-code copies only with a representation that preserves
  earlier attempts, follow-up evidence, and the final editor state.
- Enforce an aggregate prompt budget with an explicit user-facing limit or an
  evidence-preserving summary strategy; avoid silent clipping of candidate work.
- First return concise scores, reasons, and practice priorities. Move 4–6 sentence
  stronger STAR rewrites / 3–6 sentence model approaches behind on-demand actions
  if output generation is a measured bottleneck. Update schema and renderer
  together; do not mistake deliberately omitted fields for failed scoring.
- Benchmark lower thinking separately on a fixed set of behavioral and code
  answers before adopting it. Do not assume that reducing thinking preserves
  scoring quality. Keep strict JSON validation and bounded repair.
- Consider per-question parallelism or streaming only if still needed. Cap
  concurrency, retain deterministic aggregation, and account for rate limits
  before splitting one evaluation into many provider calls.

### 5. Improve long-session CPU, memory, and correctness

- Add a face-frame start index per segment, avoiding full-history filtering on
  every Send. Establish the intended baseline policy before caching medians:
  changing from all-history to fixed/approximate baselines changes measurements.
- Use incremental second buckets for voice tracks and bounded raw frame windows.
  Keep the statistical weighting of median pitch explicit when downsampling.
- Move pitch/WAV processing off the main thread if target-device traces show
  long tasks or missed audio callbacks. Feature-detect AudioWorklet/worker support
  and preserve typed interviews when audio analysis is unavailable.
- Replace the O(silences × typing-events) silent-coding scan with a chronological
  cursor if long coding answers show material cost.
- Harden camera/mic startup ownership and cleanup. Awaiting a terminated worker
  should not hold a new interview's microphone hostage for the 45-second timeout.
- Fix strict score validation/ID matching and final-code deletion separately,
  using explicit contract tests. Also distinguish genuine candidate answers from
  hint-only requests when deciding whether a question can be scored.

## Acceptance targets and rollout

1. On the reference demo laptop, local results should appear within 250 ms of
   manual report entry for a synthetic 30-minute / 16-question session. This is a
   target, not an already measured browser guarantee. Track >50 ms main-thread
   tasks and expand hardware coverage before setting a production SLO.
2. Evaluation dispatch has no dependency on an audio-transcription promise.
3. An AI failure/deadline never removes existing metrics or transcript content.
4. Late transcription can refine labeled local counts with no automatic AI call,
   chart replacement, lost expanded sections, or session crossover.
5. Every external request has an application deadline/cancellation policy, and
   every evaluation attempt/repair fits within its shared budget.
6. Start with one evaluator request. Change model settings/output shape only
   after timing and quality comparisons justify it. No claimed provider speedup
   until real requests have been measured with the user's configured provider.

Ship phases 1–3 together as the first progressive-report release; phases 4–5 can
follow independently. Test offline orchestration first, then browser smoke checks
for actual paint, focus/scroll, permission changes, and a long voice session.

## Supporting fixes implemented with this audit

- Chronological interval cursors replace repeated full-array speech/phrase scans.
- Large speech/track maxima use reductions rather than variadic calls.
- JSON trailing-comma repair preserves strings and escaped quotes.
- WAV collection honors the exact five-minute cap and avoids replacing full
  answer counts with a prefix transcript.
- `settle()` clears its timer; old transcription results after reset are ignored
  and removed from the owning pending set. Normal stop still allows updates.
- Eight new deterministic regressions cover these cases, including timestamp
  access-count bounds rather than machine-dependent speed assertions.

Offline benchmark: `node scripts/benchmark-report.mjs`. On this host, Node
v22.22.1, seven measured repetitions after two warmups, synthetic 20 Hz frames
with two seconds of speech / one second of silence:

| Answer length | Original audio summary median | Updated median |
| --- | ---: | ---: |
| 1 minute / 1,200 frames | 1.71 ms | 1.39 ms |
| 5 minutes / 6,000 frames | 14.48 ms | 5.27 ms |
| 30 minutes / 36,000 frames | 171.97 ms | 34.50 ms |

The same benchmark measured updated 30-minute voice-track construction at 5.59 ms,
report HTML generation at 1.53 ms, and one 2048-sample pitch frame at 1.62 ms.
These are synthetic local CPU timings, not browser layout/paint or network/model
latency; different runs and devices vary. The 30-minute fixture stresses a single
long segment; normal interviews split that work across answers. The broader
report-loading/transcription gate has since been removed as described above.
