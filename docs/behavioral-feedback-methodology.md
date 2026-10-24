# Behavioral interview scoring and feedback plan

Draft methodology v1.1, October 24, 2026 (v1.0: October 23, 2026). Intended audience: the Interview Prep Studio product and engineering team. This is an implementation specification; it does not change the running application. [Current build status](#current-build-status-october-24-2026) records what the app measures today and where it departs from this specification. [Comparable products and planned additions](#comparable-products-and-planned-additions) records the competitor review and the next planned metrics.

v1.1 changes: corrected the MACH summary; added the current build's delivery metrics (articulation rate, rising endings, trailing off, think-aloud silence, hedging guidance) and their divergences from this specification; added a verified review of Yoodli, Speeko, and Poised; specified word-choice metrics as the next planned addition.

Build an interview coach that measures the behavioral evidence a candidate communicates, explains each rating, and helps the candidate improve on another question. Report content ratings, speech measurements, and visual observations separately. The headline rating describes the answer given in this practice session; it is not a hiring probability or a diagnosis of the person's underlying ability.

The scoring anchors, aggregation rules, minimum sample sizes, and engineering thresholds below are proposed product decisions. Research supports the general approaches and candidate measurements, but does not validate this particular rubric. The companion [rubric configuration](behavioral-feedback-rubric.v1.json) contains the proposed machine-readable anchors and defaults. The [example report](behavioral-feedback-example.v2.json) demonstrates the proposed output contract with fictional data.

## Research and resulting decisions

This targeted review combines employment-interview studies, speech research, coaching experiments, and measurement research. It is not a systematic review. The additional literature extends the earlier review with narrative elicitation, rater calibration, question accessibility, cross-sample validation, and feedback design. Publisher abstracts were used for Melchers, Bangerter, and Hickman; detailed findings below stay within what those abstracts report. Other sources include full papers or author manuscripts.

| Source and evidence | Finding relevant to this product | Product decision and scope |
| --- | --- | --- |
| [Levashina et al. 2014, The Structured Employment Interview](https://doi.org/10.1111/peps.12052), narrative and quantitative review | Examines structure, bias, rating scales, and probing as distinct interview-design choices. | Define competencies, questions, expected evidence, and anchors together. Structure is a foundation, not proof that an AI evaluator is valid. |
| [Melchers et al. 2011, Is More Structure Really Better](https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.2010.01202.x), factorial experiment with recorded interviews | Both shared-standard rater training and descriptively anchored scales improved accuracy and interrater reliability; combining them further improved accuracy. | Calibrate human raters with sample answers and adjudications. Adapt that principle into model examples and evaluate the adaptation independently. |
| [Bangerter, Corvalan and Cavin 2014, Storytelling in the Selection Interview](https://link.springer.com/article/10.1007/s10869-014-9350-0), 62 real interviews | Distinguishes stories, generic pseudo-stories, examples, opinions, and self-descriptions. Stories and pseudo-stories were associated with hiring recommendations. | Add a specific-episode diagnostic. A persuasive narrative is not necessarily strong behavioral evidence or a truthful account. |
| [Brosy, Bangerter and Ribeiro 2020, Encouraging Narrative Responses](https://libra.unine.ch/entities/publication/60141396-a089-4400-8a9f-b6cdca501a4c), field study and two experiments | Probing increased stories and narrative elements. Information about answer format did not reliably increase story production, although it reduced pseudo-stories. | Track initial and completed answers separately. Use bounded, neutral probes; record what they elicited. STAR instructions alone are insufficient. |
| [Maras et al. 2021, Adapted Employment Interview Questions](https://journals.sagepub.com/doi/10.1177/1362361320981319), initially 50 adults, half autistic | Ratings improved with adapted questions at a second interview, particularly for autistic participants. Interviews were about six months apart. | Offer explicit prompts and an optional guided practice mode. Sequential design and elapsed time limit causal attribution; do not claim the adaptations alone explain every improvement. |
| [Suzuki, Kormos and Uchihara 2021, Utterance and Perceived Fluency](https://onlinelibrary.wiley.com/doi/10.1111/modl.12706), 22-study meta-analysis | Articulation rate correlated with perceived fluency at r=.62, pause frequency at r=-.59, and pause duration at r=-.46. Filled pauses were weaker, r=-.24. | Measure pacing and pauses alongside fillers. These are second-language fluency associations, not optimal SWE-interview ranges or causal effects of changing speed. |
| [Clark and Fox Tree 2002, Using Uh and Um in Spontaneous Speaking](https://web.stanford.edu/~clark/2000s/Clark%2C%20H.H.%20_%20Fox%20Tree%2C%20J.E.%20_Using%20uh%20and%20um%20in%20spontaneous%20speaking_%202002.pdf), corpus research | Filled pauses can communicate upcoming delays and serve conversational functions. | Separate filler observations from quality judgments. Zero fillers is not a product goal. |
| [Martín-Raugh et al. 2023, Speaking Without Words](https://doi.org/10.1002/job.2670), 63 studies, N=4,868; online 2022 | Appearance, eye contact, and head movement were associated with interview ratings, with corrected correlations .62, .45, and .43. Some relationships varied by gender. | Presentation can influence impressions. Associations are not scoring weights, ideal gaze percentages, or validation of a webcam head-pose proxy. |
| [Barrett et al. 2019, Emotional Expressions Reconsidered](https://pmc.ncbi.nlm.nih.gov/articles/PMC6640856/), broad evidence review | Facial movements do not provide a sufficiently general, specific mapping to emotional states for simple emotion inference. | Describe head direction and movement. Do not infer confidence, honesty, anxiety, warmth, or emotional regulation from faces. |
| [Hoque et al. 2013, MACH](https://web.media.mit.edu/~mehoque/Publications/13.Hoque-etal-MACH-UbiComp.pdf), randomized study of 90 MIT undergraduates | Automated feedback plus practice improved counselor-rated performance overall relative to comparison conditions. Effects varied by gender; participants were native English speakers. Sensed cues were smiles, head nods and shakes, pause duration, speaking rate (syllables per minute), weak language (filler words as a share of words), loudness, and pitch variation. Its speech recognition captured a transcript but performed no natural language understanding. It did not sense the user's gaze; gaze appears only as the virtual interviewer's synthesized behavior. | Test repeated practice with feedback. The study does not isolate the effect of each cue or establish long-term hiring outcomes. Do not credit MACH with language analysis or gaze tracking; content understanding is the part this app adds. |
| [Zhao et al. 2017, Semi-Automated and Collaborative Online Training](https://arxiv.org/abs/1704.08735), 56 participants over ten days | Studied combined automated and peer feedback, with peer-only feedback as a comparison. Reports improvements in speaking ratings in the treatment group. | Consider optional coach review later. Improvements from a combined intervention cannot be attributed to a single automatic metric. |
| [Wisniewski, Zierer and Hattie 2020, The Power of Feedback Revisited](https://pmc.ncbi.nlm.nih.gov/articles/PMC6987456/), 435 educational studies | Feedback effects varied substantially; information content mattered. The reported d=.48 estimate excludes extreme effects. | Give evidence, an explanation, and a next action. Educational findings motivate the design; they do not estimate this app's interview-coaching benefit. |
| [Hickman et al. 2022, Automated Video Interview Personality Assessments](https://pubmed.ncbi.nlm.nih.gov/34110849/), three development/validation samples totaling 1,073 plus 99 for retest | Evidence depended on the target labels; observer-trained personality models showed mixed reliability, while self-report-trained models had little reliability or validity evidence. | Validate each target construct and across samples. Prediction of interviewer impressions is distinct from measurement of personality; this app will assess answers rather than personality. |
| [Koenecke et al. 2020, Racial Disparities in Automated Speech Recognition](https://doi.org/10.1073/pnas.1915768117), five systems | Historical mean word error rates were .35 for Black speakers and .19 for white speakers in the studied corpus. | Audit the actual transcription system, allow corrections, and test downstream scoring errors. Historical figures do not describe the selected system today. |
| [Zheng et al. 2023, Judging LLM as a Judge](https://arxiv.org/abs/2306.05685), chatbot evaluation | Documents position, verbosity, and self-enhancement biases. | Stress-test length, answer order, style, and evaluator changes on interview answers. Transfer from chatbot evaluation requires measurement. |
| [Koo and Li 2016, Selecting and Reporting Intraclass Correlation Coefficients](https://pmc.ncbi.nlm.nih.gov/articles/4913118/), measurement guidance | Different ICC forms answer different reliability questions. | Specify absolute agreement, model, single/average rating, and confidence intervals. Reliability alone does not establish validity. |

Additional approaches worth testing are listener comprehension, transfer to unseen questions, and coverage of evidence across several experiences. These are proposed evaluations below, not published standardized interview metrics.

## Content rubric

Rate observable evidence for six dimensions. Use integer levels 1 through 5 and select the best matching complete anchor; do not require every lower anchor cumulatively when they describe alternative patterns. Apply the same entry-level standard to internships, coursework, volunteering, hackathons, and employment. A level 5 does not require prestige, large business impact, a management role, or numerical results. Later career levels need separately reviewed examples.

| Dimension | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| Relevance and organization | Does not address the elicited behavior after clarification. | Related topic, but mostly generic or the relevant event remains unclear. | Relevant episode with a broadly followable sequence; some unnecessary context or missing links. | Directly addresses the behavior with sufficient context and clear progression. | Selects the most relevant details, makes stakes and causal links explicit, and resolves the question clearly. |
| Ownership | Personal role cannot be identified after elicitation. | Names a role but contributions remain vague. | Names personal actions and distinguishes at least part of the team contribution. | Clearly explains responsibilities, personal actions, and relevant boundaries with others. | Also explains an accountable decision within that responsibility and how it affected the team or work. |
| Judgment | No relevant decision or rationale after elicitation. | States what was done without an intelligible reason. | Gives a plausible reason tied to a relevant constraint. | Compares a meaningful alternative or tradeoff and explains the choice. | Also explains how evidence, uncertainty, or new information was used to test or revise the decision. |
| Collaboration | No relevant interpersonal action after elicitation. | Asserts teamwork or disagreement without explaining an interaction. | Describes a concrete communication or coordination action. | Explains another person's concern and an action that addresses it. | Also explains how shared understanding, responsibilities, or a continuing disagreement were managed and checked. |
| Outcome evidence | No outcome or assessment after elicitation. | Vague success or failure claim without an observable supporting detail. | Concrete outcome and at least one observation showing what happened. | Explains how the outcome was checked and connects it to the actions described. | Also distinguishes contribution from other causes, uncertainty, or limits in the outcome assessment. |
| Learning and adaptation | No relevant learning or adjustment after elicitation. | Generic lesson such as communicate better, without a concrete change. | Specific lesson linked to an actionable change. | Describes applying that change in a subsequent situation or a concrete follow-through. | Also evaluates whether that change worked or identifies when to adapt it again. |

Do not score a failed project lower merely because it failed. Outcome evidence measures the quality of the explanation. Do not infer good collaboration from frequent plural pronouns, judgment from jargon, or learning from polished reflective language alone.

### Applicability and evidence status

Each question template declares assessed dimensions before the answer. A core ownership question can omit collaboration if no interaction is elicited. Absence of evidence is a low rating only after a clear opportunity to address that dimension. Classify every planned dimension as:

- `scored`: adequate capture and opportunity; score is an integer 1–5.
- `not_elicited`: no clear opportunity in the question or an appropriate probe; score is null.
- `insufficient_capture`: technical failure prevents judgment; score is null.
- `invalid_evidence`: model citations fail validation; score is null until repaired.
- `judge_disagreement`: a requested independent check cannot resolve a material conflict; score is null.

Unplanned dimensions have `not_applicable`, with null score. An explicit skip can receive a low content score when the recording confirms the choice; missing audio or an unanswered network request cannot. For a genuinely missing element, store an `absence` evidence record that identifies the eliciting prompt and the answer turn inspected. A quote cannot prove an absence by itself.

### Calculation and aggregation

For question q and evidence scope s, `Q(q,s) = sum(dimension scores) / count(planned dimensions)`, only when all planned dimensions have valid scores. Otherwise the question summary is null and available dimension ratings remain visible. Do not drop an unscorable dimension and silently inflate the mean. Show one decimal for averages and integers for anchors.

Calculate `initial` from the first substantive candidate answer and `completed` from that answer plus its neutral follow-ups. The completed answer is the primary question rating. Calculate differences only for dimensions scored in both scopes. A difference describes evidence elicited, not a penalty or a causal estimate of assistance. Do not add these two ratings together.

For dimension d across eligible completed questions, `D(d) = mean(score(q,d))`. A behavioral session summary is the equal-weight mean of D over the dimensions planned for that session. Require at least three fully scored questions and at least one fully scored question covering every planned dimension; otherwise show dimension ratings with “More examples needed for a session summary.” Suppress the session summary if any attempted planned question remains technically unscorable. Label dimensions supported by fewer than two distinct questions “Limited evidence.” These are proposed sampling rules, not established psychometric cutoffs.

Keep technical-round ratings separate. Do not blend the new behavioral mean with the existing model-generated technical score or reproduce the old overall rating as though it used the same methodology. No percentile, pass/fail threshold, hiring recommendation, or visual/audio adjustment in v1.

### STAR and episode diagnostics

Use a diagnostic checklist outside the content mean:

| Element | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Situation | Missing | Broad background | Specific episode and relevant context |
| Task | Missing | Vague goal or responsibility | Clear personal responsibility or objective |
| Action | Missing | General behavior | Concrete personal steps |
| Result | Missing | Unsupported outcome claim | Observable outcome, including a failure or partial result |

`STAR = S + T + A + R`, range 0–8. A single passage may support several elements. Chronological STAR order and explicit section labels are unnecessary. Unknown capture produces null for that element and null total, rather than zero. The checklist identifies missing explanation and receives no additional weight in Q.

Add `episodeType = specific_episode | generic_pattern | hypothetical | unclear`, supported by excerpts and optionally corrected by the user. This is an evidence-format diagnostic, not truth detection. Use a different rubric for an explicitly hypothetical question.

## Question and probe policy

Replace freely generated benchmark questions with a versioned bank. Keep natural wording variants only when they preserve the assessed behavior. Example: “Tell me about a specific disagreement during a project and how you handled it.” Predeclare relevance, ownership, judgment, collaboration, outcome, and learning as intended dimensions. Allow at most two neutral follow-ups from the existing session limit. A dimension not elicited within that limit is reported as not elicited.

Use a fixed missing-evidence priority: specific episode, personal actions, rationale, other person's perspective, outcome assessment, then learning. Ask one question at a time, such as “What did you personally do?” or “How did you determine what happened afterward?” Log the probe target. Do not prescribe the desired answer or award points merely for responding to a probe.

In `guided` practice, ask explicit subquestions in turn, offer planning time, and show the rubric. In `interview` practice, ask a main question and bounded neutral probes. Compare progress within the same mode and version. Guided practice is not a lower-quality achievement; it elicits a different amount of support. Keep preparation time and clarifying questions descriptive.

Suggested bank coverage: conflict, ownership, failure and recovery, ambiguous requirements, prioritization, and receiving feedback. Preserve the question ID, wording, topic, level, intended dimensions, probe policy version, and mode for every attempt. Do not penalize ordinary clarification requests or use number of probes as an independent weakness score.

## Audio measurement specification

Capture explicit candidate answer segments, with a monotonic session clock. Define `Tanswer` as the sum of first-to-last detected candidate speech intervals for each submitted segment, including internal silence and excluding intentional app pauses, interviewer turns, leading preparation time, and model/network latency. Define `Tvoice` as voice-activity time inside those intervals. Count `N` spoken word tokens, including vocalized uh/um but excluding punctuation, using a versioned English tokenizer. Filled multiword expressions contribute their individual words to N and one filler event when context supports that classification.

Retain raw word alignment separately from the corrected semantic transcript. User edits can repair content evaluation but must not fabricate audio timestamps. Invalidate or realign audio-derived word statistics after relevant edits. If recording loss occurs inside a segment, suppress whole-answer rate and report only labeled observed segments; never subtract missing time while keeping its transcript words.

| Metric | Calculation | Display and scoring policy |
| --- | --- | --- |
| Speaking rate | `60 * N / Tanswer` words/minute | Raw value and timeline. No universal ideal range. |
| Speech-only word rate | `60 * N / Tvoice` words/minute | Optional advanced detail, distinct from syllable articulation rate. |
| Articulation rate | Spoken syllables / Tvoice in seconds | Experimental until syllable estimates handle technical terms reliably. |
| Silent pause frequency | `60 * number of internal non-voice gaps >= 0.25 seconds / Tanswer` | Report threshold and locations. The 250 ms analysis threshold is informed by fluency research; it is not a penalty threshold. |
| Pause duration | Median and 90th percentile of eligible internal gaps; null if none | Separate sentence-boundary and within-sentence estimates only when boundary alignment is reliable. Breath and VAD errors remain possible. |
| Pause fraction | `sum(eligible internal gap duration) / Tanswer` | Descriptive fraction, not a fluency score. |
| Filled pause density | `100 * filler events / N` | Start with acoustically retained uh/um; context-check like, so, and multiword expressions. Do not rely on a transcript that deletes fillers. |
| Restarts | `100 * verified restart events / N` | Experimental; each event needs an excerpt and time span. Distinguish deliberate correction of a fact. |
| Answer duration | Tanswer, with each follow-up shown separately | Time spent does not directly lower a score. |
| Initial response latency | First candidate speech time minus prompt completion time | Optional observation only. Prompt completion must be known; button render time is not spoken prompt completion. |
| Clipping | `100 * full-scale samples / valid captured samples`, with full-scale defined as abs(normalized PCM) >= .999 | Recording-quality indicator; microphone and gain settings affect it. |
| Audio coverage | Valid captured candidate-window seconds / expected candidate-window seconds | Data quality, never a candidate score. |

Proposed minimums for whole-answer rates: 30 spoken words, 10 seconds of Tanswer, at least 95% valid capture coverage, and valid word alignment. Below these, show counts or local events labeled limited sample instead of normalized rates. Word-level error flags suppress affected excerpt coaching; a provider's confidence field is not a universal accuracy percentage. Silence-only answers have null rates, not divide-by-zero results. Audio-quality warnings do not lower content ratings unless words needed for that dimension are unavailable, in which case the dimension is unscorable.

For timeline pacing, use non-overlapping 15-second windows inside sufficiently long segments, flag windows with fewer than 10 spoken words as sparse, and display their raw rates without declaring them good or bad. These window sizes and quality gates are engineering defaults to tune on recordings.

A future delivery rating should target listener comprehension or ease of following an explanation, validated against listeners. Do not construct it by placing Gaussian penalties around an assumed 145 WPM optimum. Pitch variability, jitter, shimmer, accent similarity, and fundamental-frequency level are excluded from scored v1 metrics.

## Visual measurement specification

Reuse local MediaPipe processing. Analyze candidate answer windows; exclude interviewer time, calibration, intentional pauses, hidden-tab periods, and interruptions. Join samples by timestamps, not frame count. For a metric m, `coverage(m) = valid observed seconds(m) / expected active candidate seconds`. For a behavior proportion, divide observed behavior seconds by valid seconds for that metric. Report the denominator beside every percentage.

| Metric | Calculation | Display and scoring policy |
| --- | --- | --- |
| Head orientation | Calibrate neutral yaw/pitch. Smooth changes over approximately 250 ms. Observe `abs(delta yaw)>25 degrees OR abs(delta pitch)>20 degrees`. | Percentage of usable time outside the baseline range; list runs lasting at least 2 seconds. These inherited thresholds are coaching heuristics. |
| Sustained head events | Maximal continuous outside-range runs lasting >=2 seconds | Count and timestamps; unknown observations break runs. The percentage above includes all outside-range observations, not only sustained events. |
| Sideways shift | Smoothed `(shoulder center x - calibrated shoulder center x) / current shoulder width`; observe absolute value >0.3 | Optional; null when shoulders were not visible for at least half of calibration. Covers swaying and sideways lean, not forward/back rocking. Body rotation narrows apparent shoulder width and camera or seat movement reads as shift, so this is movement, not fidgeting or defensiveness. |
| Gesture activity | Mean relative wrist speed in shoulder widths/second; active when >0.35 | Optional percentage of usable hand-tracking time. More or less activity is not inherently better. |
| Framing | Clear in-frame face-box seconds / valid image seconds | New metric; separate in-frame detection from unknown detector failures. Validate known out-of-frame events using annotated footage before reporting a negative percentage. |
| Lighting | Fraction of valid face-region pixels near luminance extremes, with luminance normalized to 0–1 | Experimental setup aid. Predeclare candidate thresholds .02/.98, inspect device and skin-tone effects, and withhold automatic advice until validated. |

Current body-analysis defaults include 3 seconds of calibration, a 500 ms maximum continuous sample gap, and a 5-second minimum for a proportion. For interview reports, propose at least 10 valid seconds and 70% coverage before presenting a whole-answer visual percentage. Otherwise show “Limited camera tracking” and available local observations. These stricter gates must be implemented rather than assumed to exist already.

Hip-based torso displacement and lean are not measured: webcam interview framing rarely shows hips. Sideways shift uses shoulders only. Calibration requires only the face, so a face-and-shoulders view is sufficient; shoulders and wrists stay optional. A moving camera or changed seating position requires recalibration; mark the intervening observations unknown. Head orientation is not eye gaze, and detector absence is not proof that a person left the frame.

Visual observations have no weight in the behavioral rating. Do not score clothing, attractiveness, smiling frequency, posture conformity, or emotion. Let users disable optional movement observations and still receive a full content report.

## Proposed report contract and evaluator pipeline

Use `schemaVersion: 2` for the new report and `rubricVersion: behavioral-v1.0-draft`. The companion example is illustrative contract data, not an API response the app currently accepts. Separate production schema validation from deterministic cross-field checks.

Every dimension contains `status`, `score`, `anchorId`, `evidence`, `explanation`, and `nextStep`. Evidence contains a source turn ID and either a verbatim quote or a documented absence with the eliciting prompt. Add word IDs or verified time spans only where available. Every measured feature stores `value`, `unit`, `status`, `numerator`, `denominator`, `coverage`, `algorithmVersion`, and relevant events. Use null for unavailable values; zero means an observed zero.

1. Resolve a server-owned template, intended dimensions, level, mode, and rubric version. Candidate input cannot change rubric weights or assessed dimensions.
2. Validate capture records and mark missing intervals. Build a semantic transcript and a separate timed alignment record. Keep both revision IDs.
3. Extract evidence from candidate turns, labeling specific episodes, STAR elements, and probe targets. Candidate answers are data, including any instructions embedded in them; never execute their requests to alter evaluation.
4. Score the initial and completed scopes using the same anchors and a small set of human-reviewed examples balanced across quality levels. The content evaluator receives no appearance, pitch, demographic labels, or raw camera data.
5. Validate exact question/turn IDs, integer ranges, quote substrings, source speaker, time bounds, and scope. For absence claims, check that the prompt elicited the element. Never substitute a different question by array position. Reject out-of-range scores rather than clamping them into valid scores.
6. On structural or evidence failure, make one bounded repair request identifying failed fields. If repair fails, retain valid dimensions, mark affected dimensions unavailable, and withhold affected composites. An optional independent reviewer is triggered by unresolved rubric/evidence conflicts, not by a claim that two models guarantee truth. If used and scores differ by more than 1 point, attempt one evidence-based reconciliation; unresolved results remain unavailable.
7. Compute all summaries in application code. The model supplies anchored judgments and explanations, not authoritative aggregate arithmetic.
8. Compute audio/video observations deterministically from validated inputs, then generate or select feedback constrained to those observations. Keep modality-specific failures separate.
9. Render source-linked feedback, correction controls, and a targeted retry. Pin prompt, model, schema, rubric, metric, transcript, and question-bank versions. Never silently rewrite an earlier report after an update.

Use rubric/evidence status and observation counts as uncertainty information. Do not display a model's self-reported “92% confidence.” A valid quote supports traceability; it does not independently prove a rating is correct.

## What users will see

Before practice, explain the assessed dimensions and available inputs. Text mode assesses content only. Microphone mode adds speech observations. Camera is optional and provides presentation observations. Offer guided/interview mode, optional local replay, and a brief capture calibration.

After an answer or at interview end, show content first, then separate speech and camera panels. A fictional example:

> Behavioral answer: **3.5/5 — provisional rubric rating**
>
> Relevance 4 · Ownership 4 · Judgment 3 · Collaboration 4 · Outcome 3 · Learning 3
>
> **What worked:** You described your teammate's compatibility concern and the payload comparison you performed together.
>
> **Next step:** Explain which alternative you considered and why you chose the payload comparison.
>
> **Evidence:** “I suggested comparing payloads instead of arguing about implementation preferences.” [View excerpt]
>
> **After follow-ups:** Your initial answer was 2.8/5. Follow-ups clarified your role, collaboration, outcome, and planned change. This shows what became clearer; it is not a penalty.
>
> **STAR detail:** 8/8 elements specific enough to identify. A complete story can still have limited reasoning or learning evidence.
>
> **Speech:** 150 words/minute · 2 filled pauses/100 words · 12 internal pauses. [Explore timeline]
>
> **Camera:** Head outside your calibrated forward range for 8 of 100 usable seconds. Tracking covered 83% of the 120-second answer. [Review observed moments]
>
> **Practice:** Retell the same experience, adding the alternative you considered. Then try a different conflict question.

The companion example separates excerpt-level transcript data from synthetic audio aggregates. Its audio observations are a calculation illustration, not measurements extracted from those excerpts. Without local replay, “View excerpt” opens transcript text; never display a nonfunctional play button. A timestamp navigates media only when matching media is available.

For low coverage: “We captured 42% of this answer's camera window, so a whole-answer movement percentage is unavailable. Your content rating is unaffected.” For an unasked dimension: “Learning was not assessed in this question.” For unclear transcription: “Review this excerpt before we rate your outcome explanation.”

Limit the default report to one evidenced strength and at most two actionable changes. Each change includes an observation, why it matters for understanding, and an exercise. Rank content gaps before optional delivery observations, then allow the user to choose a goal. An audio observation alone cannot justify “you were hard to understand”; require listener evidence before making that claim. Avoid live performance grades during interview mode, which can distract from the answer.

## Current build status (October 24, 2026)

The running app already has a delivery-measurement path that predates milestones 3 and 4 below. Measurement runs in the browser. Only derived numbers and the transcript go to the evaluator. The evaluation prompt asks the model to coach delivery in separate `delivery` fields and not to change content scores because of it. Code: `frontend/js/delivery-metrics.js` (pure functions, tested with synthetic signals in `test/delivery-metrics.test.js`), `delivery.js` (camera and microphone capture), `delivery-worker.js` (face tracking), `voice.js` (browser speech recognition and synthesis), and `DELIVERY_GUIDE` in `backend/prompts.js`.

### Built audio and transcript metrics

| Metric | Built calculation | Coaching threshold in prompt | Origin |
| --- | --- | --- | --- |
| Pauses | Praat-style silence detection: frames quieter than the loudest frame minus 25 dB (floor −60 dB) are silent; minimum silent and sounding intervals 0.5 s. Pause share = pause time / first-to-last sound span. Long pauses ≥2 s. | More than about 30% of speaking time, or several pauses over 2 s | MACH |
| Pace | Words / first-to-last sound span × 60; needs ≥5 words and ≥3 s | About 120–160 words per minute | MACH (MACH counted syllables, not words) |
| Articulation rate | Words / sounding time × 60, pauses excluded; needs ≥5 words and ≥3 s of sound | Above about 190 words per minute sounds rushed | Speeko-style. Word-based, not the syllable-based rate in the audio specification. |
| Pitch variation | Autocorrelation pitch, 100–500 Hz, clarity ≥0.6; standard deviation in semitones around the median | Below about 2 semitones flat; about 3 or more expressive | MACH |
| Rising endings (uptalk) | Phrases are sounding intervals ≥1 s. A phrase rises when the median pitch of its last 0.4 s is ≥2.5 semitones above the rest. Frames more than 12 semitones from the phrase median are ignored as octave errors. Needs ≥3 ending and ≥6 body voiced frames; share reported at ≥3 phrases. | Roughly a third or more of phrases | Speeko-style |
| Trailing off | Mean level of a phrase's last 0.5 s is ≥6 dB below the rest. Needs ≥4 ending and ≥6 body frames; share reported at ≥3 phrases. | Many phrases | Speeko-style |
| Think-aloud silence | Coding questions with voice on. Silences ≥15 s from answer start to end, split into "silent while typing code" (≥5 code-editor input events inside the silence) and silent without typing. | Flag any; recommend narrating intent before and while coding | Added, SWE-specific |
| Time to first word | First sound minus start of the answer window | A few seconds is normal thinking time | Added |
| Fillers | Regex list: um, uh, like, you know, basically, actually, literally, totally, kind of, sort of, I mean, with exclusions for ordinary uses such as "would like" and "do you know". Counted on a verbatim transcript of each spoken answer (`POST /api/transcribe`: Deepgram with `filler_words=true` when configured, otherwise a Gemini audio model) because browser dictation drops most uh/um; falls back to the dictated text if transcription fails. Share reported at ≥10 words. | Above about 3% of words is noticeable | MACH weak language |
| Hedging | Not computed. The prompt asks the model to quote phrases such as "I just", "I guess", "sort of", "kind of", "I think maybe", or "I might be wrong" when they form a pattern. | Pattern only | Model judgment |

### Built camera metrics in interview mode

| Metric | Built calculation | Origin |
| --- | --- | --- |
| Smiles | Mean of MediaPipe `mouthSmileLeft/Right` × 100; smiling at ≥35; needs ≥20 tracked frames | MACH used the SHORE classifier |
| Head nods and shakes | MACH stable/extreme/transient states over ±2 frames on the between-the-eyes point, 2 px rule after rescaling the face to 60 px between outer eye corners; swings over 40 px ignored as posture changes; more than two extremes between stable states | MACH |
| Looking away | Head yaw or pitch more than 20° from the session's median head direction | Added |
| Nods while listening | Nods and shakes outside answer windows, reported when the face was visible ≥10 s while listening | Added |

### Divergences from this specification

Each item needs a decision: change the build, or record the exception here.

1. **Transcript source.** Chrome's speech recognition returns final text segments without word timestamps, so no aligned word record exists. It can also omit vocalized "um" and "uh", which this specification forbids relying on for filler density. Treat built filler counts as lower bounds until checked against recordings.
2. **Pause threshold.** The build uses MACH's 0.5 s minimum and a threshold relative to the loudest frame. This specification proposes 0.25 s internal gaps. Pause counts from the two methods are not comparable.
3. **Normative ranges.** The prompt's ranges (120–160 wpm, 190 wpm, 3% fillers, 2 and 3 semitones, a third of phrases, 30% pauses) conflict with "no universal ideal range". Pitch variation is used for coaching even though this specification excludes pitch variability from scored v1 metrics. Delivery carries no content-score weight, but only because the prompt says so. Application code does not enforce it.
4. **Smile coaching.** The prompt says smiles come across as friendly. The build does not score smiling, but advising more smiling sits close to the limit set by the Barrett et al. row above.
5. **Sample and baseline gates.** Built rates need 5 words and 3 s, below the proposed 30 words, 10 s, and 95% capture coverage. Looking away uses a session-median baseline and 20° on both axes, not an explicit calibration with 25° yaw and 20° pitch.

## Comparable products and planned additions

Reviewed October 24, 2026 from vendor pages, app-store listings, and press coverage. Features are what those sources state. Implementation notes are inferences, because no vendor publishes its architecture.

| Product | Status | Stated features | Likely implementation (inferred) |
| --- | --- | --- | --- |
| [Yoodli](https://yoodli.ai/blog/ai-interview-follow-ups) | Active | Word-choice analytics: repetition, filler words, non-inclusive language, weak words, conciseness, sentence starters. Delivery analytics: eye contact, centering, pauses, smiles, pacing. Follow-up questions generated from the most recent answer. AI rephrasing of an answer. Audience selection (peers, technical, business). Private live nudges to slow down or hit talking points. | Speech-to-text, then word lists and counts on the transcript; an LLM for follow-ups and rewrites; webcam face landmarks for eye contact and centering |
| [Speeko](https://apps.apple.com/app/id1071468459) | Active (iOS and macOS) | Real-time feedback on pace, tone, and fillers. Timed interview sessions from a question library. Exercises matched to speaking style. Daily vocal warm-ups. A pitch-range and intonation exercise. Imported recordings. | Pitch tracking and loudness envelopes; a rules table mapping the weakest metric to a drill |
| [Poised](https://poised.com/) | Acquired by Deepgram in June 2024; its homepage announces shutdown on October 8, 2026 | Real-time private feedback during online meetings. Live speaker notes crossed off as items are covered. Meeting summaries and action items. Scores for speakshare (share of contributions), clarity (filler words), and confidence (hedging words). | A local desktop app capturing only the user's microphone; streaming speech-to-text with fuzzy matching against notes |

Do not present Poised as a live competitor. None of the three products' stated features includes measuring think-aloud silence while the candidate writes code.

### Ideas considered

| Idea | Source | Decision |
| --- | --- | --- |
| Word-choice metrics | Yoodli | **Next to build.** Deterministic, works in typed and spoken modes, unit-testable. Specification below. |
| "Stronger version" rewrite | Yoodli | Already built: the evaluation returns `strongerAnswer` for each behavioral question. |
| Talking-points checklist | Poised | Not planned. |
| Live pace nudge | Yoodli, Poised | Not planned for interview mode, because this specification says to avoid live performance grades there. Possible for presentation practice. |
| Drill after the report | Speeko | Later. Needs a reviewed mapping from each observation to an exercise. |

Out of scope: calendar integration, meeting summaries, audience personas, and non-inclusive-language detection. Non-inclusive-language detection needs a reviewed list and context handling, and has a high false-positive risk.

### Word-choice metrics specification (planned)

Compute per answer, in `frontend/js/delivery-metrics.js`, from the candidate's transcript, typed or dictated. Like other delivery observations, these carry zero weight in content ratings and are shown as observations, not grades. Reuse the audio minimum: below 30 words, show counts only and no rates.

| Metric | Calculation | Display policy |
| --- | --- | --- |
| Repeated phrases | Lowercase and strip punctuation and filler tokens. Count word 3-grams that occur ≥3 times in one answer, excluding 3-grams made only of stop words. | Up to three phrases with counts. No rate. This differs from type-token ratio, which stays deferred. |
| Sentence starters | Units are sentences split on `.`, `?`, `!` for typed answers. For dictated answers, use the final-result segments from `voice.js`, because dictation punctuation is unreliable; keep those segments on the answer record. Take the first word of each unit, lowercased. | Most common starter and its share when there are ≥4 units. Flag when one starter opens ≥40% of units. If segments are unavailable, mark the share as limited. |
| Hedging phrases | Versioned list: "I just", "I guess", "I think maybe", "I might be wrong", "I feel like", "I'm not sure". "Kind of" and "sort of" stay in the filler count so existing numbers do not change and nothing is counted twice. | Count per 100 words, with excerpts, so the user can dismiss legitimate uses such as "I just finished". Gemma still decides whether the pattern is worth quoting. |
| Answer length | Words, plus speaking seconds when voice is on, per main answer. Show the initial answer and the follow-ups separately. | Display only. Length does not lower a score. Conciseness judgments stay with the content evaluator. |

Implementation: add `countWordChoice(text, units)`; extend `combineDeliveries`, `describeDelivery`, and `deliveryChips`; add one line to `DELIVERY_GUIDE`. The server whitelists delivery fields, so add the numeric fields to `DELIVERY_RANGES` in `backend/server.js`. Accept repeated phrases and hedge excerpts only as short strings that occur in that record's transcript, the same way `fillerWords` keys are checked against `FILLER_KEYS`. The 30-word, 3-occurrence, 4-unit, and 40% values are starting heuristics to tune on practice transcripts. Tests should cover repeated 3-gram detection, exclusion of stop-word-only 3-grams, starter share from dictated segments, hedge counting without double-counting fillers, and null rates below 30 words.

## Implementation sequence for this repository

The current app uses typed or dictated interview turns, a model-generated evaluation, and a separate local-camera practice mode. `records.seconds` is question wall-clock time, not candidate speaking time. `cleanRecords` keeps a fixed field whitelist (now including validated `delivery` numbers) and discards other metadata. `normalizeEvaluation` currently permits positional fallback and clamps/coerces scores, and the model supplies overall/round totals. The report renderer expects integer badges and four behavioral criteria. Browser microphone capture with in-browser prosody measurement exists (see [Current build status](#current-build-status-october-24-2026)). No speech-alignment service or timed word record exists, and transcription relies on the browser's speech recognition, plus an unaligned verbatim transcript per spoken answer used only for filler counts.

| Milestone | Files and work | Acceptance condition |
| --- | --- | --- |
| 1. Evidence-backed text scoring | Add server-owned `backend/behavioral-rubric.js`, `backend/behavioral-schema.js`, and `backend/behavioral-score.js`; adapt `backend/prompts.js`, `backend/parse.js`, and `backend/server.js`. Include a benchmark bank and human-reviewed anchor examples. | A typed answer produces dimension anchors, valid excerpts/absence records, STAR detail, and deterministic means. Invalid evidence never becomes a plausible numeric score. |
| 2. Question records and report | Extend `frontend/js/interview.js` and server cleaners for template, rubric, mode, turn IDs, and probe targets; adapt `frontend/js/report.js`, `app.js`, `index.html`, and `styles.css`. Add guided mode and versioned retries. | Initial/completed evidence is distinct, no unasked dimension receives a 1, summaries follow coverage rules, and technical reports remain usable. Legacy and v2 reports have explicit separate render paths. |
| 3. Audio capture and extraction | Add `frontend/js/interview-media.js`, `frontend/js/audio-metrics.js`, an audio worker/worklet, and a bounded `POST /api/transcribe` adapter. Extend `frontend/js/api.js` for audio uploads; version and pin a selected transcription service after comparing candidates on pilot recordings. | Candidate windows exclude interviewer time and request latency; aligned words preserve fillers; permission denial falls back to text; rates pass annotated recording checks. |
| 4. Optional camera integration | Reuse `presentation-worker.js` and `body-language.js`; introduce a shared camera controller with one stream and independent face calibration. Adapt `presentation.js` without assuming its full-body setup fits interview framing. | Existing practice remains usable; no duplicate camera ownership; null shoulder/hand metrics do not block head analysis; every percentage includes coverage. |
| 5. Local replay and progress | Optional in-memory MediaRecorder replay; preserve attempt IDs and explicitly selected report history, with deletion controls. Compare matched modes and rubric versions. | Transcript-only reports work without replay; media is released on exit; reports never imply durable storage or trend history that does not exist. |
| 6. Validation and expansion | Add an offline evaluation harness under `scripts/evaluate-behavioral.mjs`, annotated fixtures, and a consented pilot dataset outside committed application sources. | Publish calibration results and release the supported claim level; expand features only after their evidence passes review. |

Keep `/api/evaluate` for JSON content evaluation. Add a request schema version; support legacy callers explicitly while v2 is introduced. Raw audio belongs in a bounded multipart/binary route, not base64 inside the existing 2 MB JSON body. Proposed upload cap: 25 MiB and 5 minutes per answer segment, with a UI warning near the limit; do not truncate silently. Validate decoded duration, file type, and session association; propagate cancellation and isolate retries so a failed transcription does not duplicate candidate turns.

Process camera frames locally as today and send only derived observations if server feedback needs them. Microphone transcription may require upload; show the chosen provider and actual retention behavior before recording. Keep temporary server audio in per-request storage and delete after processing, including failure paths. Local replay is opt-in and held only for the active session unless explicitly saved. The existing presentation privacy copy must stay accurate for its mode; interview microphone/replay copy needs its own explanation. Never log raw interview content or media by default.

Dependencies: milestones 1–2 establish the content MVP. Milestone 3 supplies real speech timing; milestone 4 can then join observations to answer windows. Milestone 5 is optional for first release. Calibration and fixture design begin with milestone 1; milestone 6 is a release gate, not a postponed polish task. The selected speech service, representative dataset access, and number of available raters remain implementation inputs; no provider-specific quality claim or schedule estimate is assumed.

## Verification and validation

For implementation, add meaningful deterministic tests: dimension applicability, scoring scopes, composite withholding, exact question IDs, failed quote checks, missing capture, explicit skips, zero denominators, duplicate events, dropped frames, pauses, transcript revisions, and mode/version comparisons. A score outside 1–5 must fail validation. Assert unrounded arithmetic, with rounding only at rendering. Retain and extend the existing synthetic landmark tests for geometry; synthetic tests cannot establish camera accuracy across people.

Use two complementary evaluation sets. A natural-answer set estimates performance with realistic student responses. A controlled set holds meaning constant while changing verbosity, name, grammar polish, answer order, filler spelling, or irrelevant prestige cues. Include irrelevant but eloquent answers, failed projects with strong reflection, short but specific responses, reused stories, ambiguous attribution, technical jargon, and instructions to ignore the rubric. Controlled examples reveal sensitivity; they do not replace natural recordings.

Begin a calibration pilot with about 40–60 participants answering four questions each, yielding 160–240 answers. Use three independent raters: at least one experienced SWE interviewer and one communication/career coach, all trained on the same anchors. These are planning quantities, not a powered fairness study. Keep all recordings, retries, and variants from the same participant in one data split. Separate calibration examples from the final holdout and include unseen question variants in transfer evaluation. Strip avoidable identifying metadata from content raters' materials.

Measure agreement before adjudication; then create documented reference judgments. Report the full score distribution and disagreements, not just a pooled accuracy number. Rater agreement is an attainable reference, not a guarantee that human impressions are unbiased.

| Evaluation | Calculation or design | Proposed release decision |
| --- | --- | --- |
| Human rubric agreement | Per-dimension weighted kappa; report pairwise distributions and prevalence. Use absolute-agreement ICC for aggregate ratings with the selected form and 95% interval. | Revise confusing anchors before training the evaluator. Report single-rater and averaged-rater reliability separately. |
| Model rating error | Mean absolute error against adjudicated references, signed mean error, exact agreement, within-one agreement, and errors >=2 points, by dimension. Bootstrap intervals by participant. | Initial pilot target: MAE <=0.6 and >=90% within one point for each dimension. These are proposed product targets; an inconclusive interval or small subgroup is not proof of success. |
| Citation integrity | Valid source spans / all cited spans; separate a human audit of whether spans support the explanation. | Zero invalid citations in served reports because invalid fields are rejected. Audit semantic support rather than claiming substring matching establishes it. |
| Repeatability | Re-evaluate a frozen subset three times; report exact anchor agreement and absolute changes, keeping model settings fixed. | Investigate >=2-point shifts; pin versions. Repeatability does not establish correct judgment. |
| Speech extraction | WER=(substitutions+deletions+insertions)/reference words; filler precision/recall/F1; pause and boundary errors against annotated recordings. | Proposed pilot targets: filler F1 >=.85 and median pause-duration absolute error <=.10 seconds. Report device/accent breakdown and suppress unsupported metrics. |
| Visual extraction | Valid-time coverage, annotated head-event precision/recall, and proportion error against human-coded footage; known tracking failures labeled unknown. | Proposed event precision >=.85 before automatic event-specific suggestions. Report recall as well; missing events cannot be reported as absence of behavior. |
| Listener comprehension | Independent listeners answer four factual questions about role, action, reason, and outcome using a human-reviewed answer key. Score each 0/1; report 0–4 recall and a separate 1–5 ease-of-following rating. | Research metric to test whether feedback improves understanding. Match content and counterbalance variants; do not use the same LLM as both sole scorer and evidence of benefit. |
| Added modality value | Compare transcript-only feedback, transcript plus audio, and transcript plus audio plus optional camera on held-out recordings and learning outcomes. | Retain extra modalities only when they add useful, sufficiently accurate coaching; report missingness and subgroup errors. |
| Learning transfer | Randomize participants to practice alone, content feedback, or content plus speech feedback; keep time equal. Blind raters assess equivalent new questions and a later retention session. | Choose a meaningful target improvement and power the experiment from pilot variance. Analyze participant-level changes and baseline-adjusted group differences, with intervals. Same-story retries show rehearsal, not general skill transfer. |

Audit voluntarily supplied language background, speech differences, accessibility needs, skin tone, glasses, lighting, and device conditions as appropriate to each modality. Do not infer these attributes from faces or voices. Compare downstream error conditional on reference-rated answer quality, capture quality, and question; equal group means are not a fairness criterion. Report sample sizes and uncertainty and expand recruitment where estimates are too imprecise.

Before displaying long-term growth claims, estimate within-person variation across questions and occasions. Show the number of distinct examples behind each dimension and require at least two before a competency trend. If sufficient reliability data exist, estimate measurement error for matched forms and display uncertainty around changes; do not declare a 0.1-point rise meaningful. Improvements on different rubric versions require rescoring both attempts or an explicit non-comparability label.

## Release scope and deferred metrics

The first useful release is text scoring with six anchored dimensions, evidence inspection, STAR detail, specific-episode detection, and targeted retries. Audio rates and pauses follow capture validation. Camera metrics remain optional observations. A delivery score, normative percentiles, or new fusion weights requires separate evidence that the target is meaningful and measured reliably.

Defer embedding cosine similarity as an answer-quality score, technical-term density, type-token ratio, pronoun ratios, emotion classification, micro-expression authenticity, vocal stress inference, universal gaze quotas, and penalties for movement. A typical value in a cohort is not automatically an ideal value; z-score normalization cannot establish that it is desirable. More modalities and more precise-looking numbers do not by themselves make the methodology more comprehensive or accurate.
