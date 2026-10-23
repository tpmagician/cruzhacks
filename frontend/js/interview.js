// Interview state machine:
//   intro → behavioral → technical → candidate_questions → wrapup → report
// The app (not the model) owns the structure: which round we're in, how many
// main questions have been asked, and how many follow-ups each question has had.

export const LENGTHS = { short: 3, standard: 5, long: 8 };
export const MAX_FOLLOWUPS = 2;
export const MAX_CANDIDATE_QUESTIONS = 3;

const OPENING_CUE = '(The candidate has joined the video call and is ready to begin.)';
const HINT_REQUEST = "I'm stuck. Could I get a small hint?";
const END_REQUEST = "I'm afraid I need to stop here. Could we wrap up?";

export const STAR_TIP = `Structure your answer with STAR:
• Situation: one or two sentences of context (team, project, stakes).
• Task: what you were responsible for, specifically.
• Action: the steps you personally took. Say "I", not "we", and spend most of your time here.
• Result: the outcome, with numbers if you have them, plus what you learned.
Aim for about 2 minutes. Pick a real example, not a hypothetical.`;

// ---------------------------------------------------------------------------
// Question plans

const CORE_BEHAVIORAL = [
  'leadership or taking ownership',
  'a conflict with a teammate or stakeholder',
  'a failure or mistake and what they learned',
  'teamwork and collaboration',
  'handling ambiguity or unclear requirements',
];
const EXTRA_BEHAVIORAL = [
  'prioritizing under a tight deadline',
  'receiving and acting on difficult feedback',
  'influencing others without formal authority',
];

const TECHNICAL = {
  engineering: {
    special: { type: 'coding', topics: ['arrays, strings, or hash maps', 'trees, graphs, or intervals'] },
    pool: { type: 'conceptual', topics: [
      'data structures and their tradeoffs',
      'designing a scalable service',
      'debugging a production issue',
      'APIs, HTTP, and networking basics',
      'databases, indexing, and consistency',
      'concurrency and race conditions',
      'testing strategy and code quality',
      'performance optimization',
    ] },
  },
  analyst: {
    special: { type: 'sql', topics: ['joins and aggregations', 'window functions'] },
    pool: { type: 'conceptual', topics: [
      'defining success metrics for a feature',
      'A/B testing and statistical significance',
      'diagnosing a sudden drop in a key metric',
      'data quality and cleaning',
      'funnel and cohort analysis',
      'communicating insights to stakeholders',
      'choosing the right visualization',
      'forecasting and trend analysis',
    ] },
  },
  pm: {
    special: null,
    pool: { type: 'product', topics: [
      'product sense: designing a product for a specific user group',
      'prioritizing a roadmap with limited resources',
      'defining metrics for a new feature',
      'diagnosing a drop in engagement',
      'scope versus timeline tradeoffs',
      'planning a go-to-market launch',
      'a market-sizing estimation',
      'working with engineering on a technical tradeoff',
    ] },
  },
  general: {
    special: null,
    pool: { type: 'domain', topics: [
      'core domain knowledge for the role',
      'a realistic day-to-day scenario in the role',
      'tools and methods they use',
      'a problem-solving case',
      'measuring success in the role',
      'a difficult situation specific to the role',
      'staying current in the field',
      'improving an existing process',
    ] },
  },
};

export function roleCategory(role) {
  const r = role.toLowerCase();
  if (/product manager|\bpm\b|product owner|product lead/.test(r)) return 'pm';
  if (/analyst|analytics|business intelligence|\bbi\b/.test(r)) return 'analyst';
  if (/engineer|developer|programmer|\bswe\b|\bsde\b|software|front[- ]?end|back[- ]?end|full[- ]?stack|devops|\bsre\b|machine learning|\bml\b|data scientist|mobile|\bios\b|android|coder/.test(r)) {
    return 'engineering';
  }
  return 'general';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function behavioralPlan(n) {
  const topics = [...shuffle(CORE_BEHAVIORAL), ...EXTRA_BEHAVIORAL];
  return topics.slice(0, n).map((topic) => ({ round: 'behavioral', type: 'behavioral', topic }));
}

function technicalPlan(category, n) {
  const { special, pool } = TECHNICAL[category];
  const slots = special ? (n >= 8 ? [2, 5] : [Math.floor(n / 2)]) : [];
  const poolTopics = shuffle(pool.topics);
  const plan = [];
  let s = 0;
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (slots.includes(i)) plan.push({ round: 'technical', type: special.type, topic: special.topics[s++ % special.topics.length] });
    else plan.push({ round: 'technical', type: pool.type, topic: poolTopics[p++ % poolTopics.length] });
  }
  return plan;
}

function buildPlans(setup) {
  const plans = {};
  if (setup.retry?.length) {
    for (const item of setup.retry) (plans[item.round] ??= []).push({ ...item });
  } else {
    const n = LENGTHS[setup.length] ?? LENGTHS.standard;
    if (setup.rounds.includes('behavioral')) plans.behavioral = behavioralPlan(n);
    if (setup.rounds.includes('technical')) plans.technical = technicalPlan(roleCategory(setup.role), n);
  }
  const rounds = ['behavioral', 'technical'].filter((r) => plans[r]?.length);
  return { rounds, plans };
}

// ---------------------------------------------------------------------------

const ROUND_TITLE = { behavioral: 'Behavioral', technical: 'Technical' };

export class InterviewSession {
  constructor(setup) {
    this.setup = setup;
    const { rounds, plans } = buildPlans(setup);
    this.rounds = rounds;
    this.plans = plans;

    this.stage = 'intro';
    this.roundIdx = -1;
    this.qIdx = -1;
    this.followups = 0;
    this.lastKind = null; // 'question' | 'followup' | 'hint' | 'cq' | 'close'
    this.cqCount = 0;
    this.done = false;

    this.history = []; // [{ role: 'user' | 'model', text }]
    this.records = []; // one per main question, see _advance()
    this._lastCode = '';
  }

  get round() {
    return this.rounds[this.roundIdx];
  }

  get inRound() {
    return this.stage === 'behavioral' || this.stage === 'technical';
  }

  get planItem() {
    return this.inRound ? this.plans[this.round][this.qIdx] : null;
  }

  get record() {
    return this.inRound ? this.records.at(-1) : null;
  }

  isCodingQuestion() {
    return this.inRound && ['coding', 'sql'].includes(this.planItem?.type);
  }

  progressLabel() {
    switch (this.stage) {
      case 'intro':
        return 'Introduction';
      case 'behavioral':
      case 'technical': {
        const total = this.plans[this.round].length;
        let label = `${ROUND_TITLE[this.round]} · Question ${this.qIdx + 1} of ${total}`;
        if (this.lastKind === 'followup') label += ` · Follow-up ${this.followups} of ${MAX_FOLLOWUPS}`;
        if (this.lastKind === 'hint') label += ' · Hint';
        return label;
      }
      case 'candidate_questions':
        return 'Your questions for the interviewer';
      case 'wrapup':
        return 'Interview complete';
      default:
        return '';
    }
  }

  /** Seconds spent on the current main question, or null outside a round. */
  questionSeconds() {
    const rec = this.record;
    return rec ? Math.floor((Date.now() - rec.startedAt) / 1000) : null;
  }

  // ---- structure ---------------------------------------------------------

  /** What comes after the current main question. */
  _upcoming() {
    const plan = this.plans[this.round] ?? [];
    if (this.roundIdx >= 0 && this.qIdx + 1 < plan.length) return this._ref('new_question', this.round, this.qIdx + 1);
    if (this.roundIdx + 1 < this.rounds.length) {
      return this._ref(this.roundIdx < 0 ? 'new_question' : 'switch_round', this.rounds[this.roundIdx + 1], 0);
    }
    return { action: 'candidate_questions' };
  }

  _ref(action, round, idx) {
    const item = this.plans[round][idx];
    return { action, round, number: idx + 1, total: this.plans[round].length, type: item.type, topic: item.topic, retryText: item.retryText };
  }

  _advance(next, interviewerText) {
    this._closeRecord();
    this._lastCode = '';
    this.followups = 0;
    if (next.action === 'candidate_questions') {
      this.stage = 'candidate_questions';
      this.lastKind = 'cq';
      return;
    }
    if (next.round !== this.round) {
      this.roundIdx++;
      this.qIdx = 0;
    } else {
      this.qIdx++;
    }
    this.stage = next.round;
    this.lastKind = 'question';
    this.records.push({
      id: `${next.round[0]}${next.number}`,
      round: next.round,
      type: next.type,
      topic: next.topic,
      question: interviewerText,
      turns: [{ speaker: 'interviewer', text: interviewerText }],
      code: '',
      explanation: '',
      hintsUsed: 0,
      startedAt: Date.now(),
      seconds: 0,
      closed: false,
    });
  }

  _closeRecord() {
    const rec = this.records.at(-1);
    if (rec && !rec.closed) {
      rec.seconds = Math.floor((Date.now() - rec.startedAt) / 1000);
      rec.closed = true;
    }
  }

  _finish() {
    this._closeRecord();
    this.stage = 'wrapup';
    this.lastKind = 'close';
    this.done = true;
  }

  _push(userText, modelText) {
    this.history.push({ role: 'user', text: userText }, { role: 'model', text: modelText });
  }

  _payload(kind, extras, userText) {
    const { role, level, companyType, model } = this.setup;
    return {
      setup: { role, level, companyType, model },
      turn: {
        kind,
        stage: this.stage,
        questionNumber: this.qIdx + 1,
        totalQuestions: this.plans[this.round]?.length ?? 0,
        followupsUsed: this.followups,
        maxFollowups: MAX_FOLLOWUPS,
        current: this.planItem ? { type: this.planItem.type, topic: this.planItem.topic } : null,
        ...extras,
      },
      history: [...this.history, { role: 'user', text: userText }],
    };
  }

  // ---- turns -------------------------------------------------------------
  // Each prepare*() returns { payload, commit(response), display? }.
  // Nothing changes until commit() runs, so a failed request can be retried as-is.

  prepareOpen() {
    const next = this._upcoming();
    const roundsPlanned = this.rounds.map((r) => ({ round: r, count: this.plans[r].length }));
    return {
      payload: this._payload('open', { next, roundsPlanned }, OPENING_CUE),
      commit: (res) => {
        this._push(OPENING_CUE, res.text);
        this._advance(next, res.text);
      },
    };
  }

  prepareAnswer({ text = '', code = '', explanation = '' }) {
    const coding = this.isCodingQuestion();
    let userText = text.trim();
    let includesCode = false;
    if (coding) {
      includesCode = Boolean(code.trim()) && code !== this._lastCode;
      userText = [explanation.trim(), includesCode ? `My code:\n\`\`\`\n${code}\n\`\`\`` : ''].filter(Boolean).join('\n\n');
      if (!userText) userText = '(No changes to my code.)';
    }
    const display = { text: coding ? explanation.trim() : userText, code: includesCode ? code : '' };

    if (this.stage === 'candidate_questions') {
      const final = this.cqCount + 1 >= MAX_CANDIDATE_QUESTIONS;
      return {
        display,
        payload: this._payload('candidate_questions', { final }, userText),
        commit: (res) => {
          this._push(userText, res.text);
          this.cqCount++;
          if (final || res.action === 'END') this._finish();
        },
      };
    }

    const forced = this.followups >= MAX_FOLLOWUPS;
    const next = this._upcoming();
    return {
      display,
      payload: this._payload('answer', { forced, next, includesCode }, userText),
      commit: (res) => {
        this._push(userText, res.text);
        const rec = this.record;
        rec.turns.push({ speaker: 'candidate', text: userText });
        if (coding) {
          if (code.trim()) rec.code = code;
          if (explanation.trim()) rec.explanation = explanation.trim();
          this._lastCode = code;
        }
        // A missing tag is treated as a follow-up; the follow-up cap keeps things moving.
        if (!forced && res.action !== 'NEXT') {
          this.followups++;
          this.lastKind = 'followup';
          rec.turns.push({ speaker: 'interviewer', text: res.text });
        } else {
          this._advance(next, res.text);
        }
      },
    };
  }

  prepareHint() {
    return {
      display: { text: HINT_REQUEST },
      payload: this._payload('hint', {}, HINT_REQUEST),
      commit: (res) => {
        this._push(HINT_REQUEST, res.text);
        const rec = this.record;
        rec.hintsUsed++;
        rec.turns.push({ speaker: 'candidate', text: HINT_REQUEST }, { speaker: 'interviewer', text: `(Hint) ${res.text}` });
        this.lastKind = 'hint';
      },
    };
  }

  prepareEnd() {
    return {
      display: { text: END_REQUEST },
      payload: this._payload('close', {}, END_REQUEST),
      commit: (res) => {
        this._push(END_REQUEST, res.text);
        this._finish();
      },
    };
  }

  // ---- report ------------------------------------------------------------

  answeredRecords() {
    return this.records.filter((r) => r.turns.some((t) => t.speaker === 'candidate'));
  }

  evaluationPayload() {
    const { role, level, companyType, model } = this.setup;
    return {
      setup: { role, level, companyType, model },
      records: this.answeredRecords().map(({ id, round, type, topic, turns, code, hintsUsed, seconds }) => ({
        id, round, type, topic, turns, code, hintsUsed, seconds,
      })),
    };
  }

  /** Setup for a new interview containing only the weakest questions. */
  retrySetup(report) {
    const scored = this.answeredRecords().map((rec) => {
      const q = report?.questions?.find((x) => x.id === rec.id);
      const vals = Object.values(q?.scores ?? {}).filter((v) => v != null);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return { rec, avg };
    });
    let weak = scored.filter((s) => s.avg == null || s.avg < 3);
    if (!weak.length) weak = [...scored].sort((a, b) => a.avg - b.avg).slice(0, 2);
    if (!weak.length) return null;
    return {
      ...this.setup,
      retry: weak.map(({ rec }) => ({ round: rec.round, type: rec.type, topic: rec.topic, retryText: rec.question })),
    };
  }
}
