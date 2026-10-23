// Output cleanup for interviewer replies and defensive JSON parsing for evaluations.

const ACTION_RE = /^[\s*_`"]*ACTION\s*[:\-]\s*[*_`"]*\s*(FOLLOW[_\s-]?UP|NEXT|END|CONTINUE)\b[*_`".]*\s*/i;
const ACTION_ANYWHERE_RE = /[*_`"]*ACTION\s*:\s*[*_`"]*\s*(FOLLOW[_\s-]?UP|NEXT|END|CONTINUE)\b[*_`".]*/gi;

/** Splits the hidden ACTION tag from the spoken text and strips non-spoken artifacts. */
export function parseInterviewerReply(raw, interviewerName) {
  let text = String(raw ?? '');

  // Drop any leaked reasoning blocks.
  text = text.replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '');

  let action = null;
  const m = text.match(ACTION_RE);
  if (m) {
    action = normalizeAction(m[1]);
    text = text.slice(m[0].length);
  }
  text = text.replace(ACTION_ANYWHERE_RE, (_, a) => {
    action ??= normalizeAction(a);
    return '';
  });

  // Speaker labels like "Jordan:" or "Interviewer:" at the start.
  const label = new RegExp(`^\\s*\\**\\s*(${escapeRe(interviewerName)}|Interviewer)\\s*\\**\\s*:\\s*`, 'i');
  text = text.replace(label, '');

  // Stage directions at the start of a line: *smiles*, [pauses], (nods)
  text = text.replace(/^[ \t]*\*[^*\n]{1,60}\*[ \t]*/gm, '');
  text = text.replace(/^[ \t]*\[[^\]\n]{1,60}\][ \t]*/gm, '');
  text = text.replace(/^[ \t]*\((?:smiles|nods|pauses|laughs|chuckles)[^)\n]{0,40}\)[ \t]*/gim, '');

  // Bold markers and leftover whitespace.
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return { text, action };
}

function normalizeAction(a) {
  const up = a.toUpperCase().replace(/[\s-]/g, '_');
  return up === 'FOLLOWUP' ? 'FOLLOW_UP' : up;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns the parsed object, or null if no valid JSON object could be extracted. */
export function tryParseJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  text = text.replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '');

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1];

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);

  for (const candidate of [slice, slice.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export const CRITERIA = {
  behavioral: ['star', 'specificity', 'relevance', 'clarity'],
  technical: ['correctness', 'approach', 'communication', 'efficiency'],
};

function score(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Coerces the model's evaluation into a fixed shape; missing values become null ("unable to score"). */
export function normalizeEvaluation(raw, records) {
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  const byId = new Map(list.filter((q) => q && q.id != null).map((q) => [String(q.id).trim().toLowerCase(), q]));

  const questions = records.map((r, i) => {
    const q = byId.get(r.id.toLowerCase()) ?? (list.length === records.length ? list[i] : null) ?? {};
    const s = q.scores ?? {};
    const scores = Object.fromEntries(CRITERIA[r.round].map((c) => [c, score(s[c])]));
    return {
      id: r.id,
      round: r.round,
      scores,
      wentWell: str(q.wentWell),
      improve: str(q.improve),
      strongerAnswer: r.round === 'behavioral' ? str(q.strongerAnswer) : null,
      modelApproach: r.round === 'technical' ? str(q.modelApproach) : null,
    };
  });

  const rounds = {};
  for (const round of new Set(records.map((r) => r.round))) {
    const rr = raw?.rounds?.[round] ?? {};
    rounds[round] = { score: score(rr.score), summary: str(rr.summary) };
  }

  const topPractice = (Array.isArray(raw?.topPractice) ? raw.topPractice : [])
    .map((x) => (typeof x === 'string' ? x.trim() : str(x?.item ?? x?.text)))
    .filter(Boolean)
    .slice(0, 3);

  return {
    overall: { score: score(raw?.overall?.score), summary: str(raw?.overall?.summary) },
    rounds,
    questions,
    topPractice,
  };
}
