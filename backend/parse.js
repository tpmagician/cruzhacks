// Output cleanup for interviewer replies and defensive JSON parsing for evaluations.

const ACTION_RE = /^[\s*_`"]*ACTION\s*[:\-]\s*[*_`"]*\s*(FOLLOW[_\s-]?UP|NEXT|END|CONTINUE|HINT)\b[*_`".]*\s*/i;
const ACTION_ANYWHERE_RE = /[*_`"]*ACTION\s*:\s*[*_`"]*\s*(FOLLOW[_\s-]?UP|NEXT|END|CONTINUE|HINT)\b[*_`".]*/gi;

/** Splits the hidden ACTION tag from the spoken text and strips non-spoken artifacts. */
export function parseInterviewerReply(raw, interviewerName) {
  let text = String(raw ?? '');

  // Drop any leaked reasoning blocks.
  text = text.replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '');

  // Pull out the on-screen problem before the speech cleanup below mangles it.
  let problem = null;
  const block = text.match(/<problem>([\s\S]*?)(?:<\/problem>|$)/i);
  if (block) {
    problem = parseProblem(block[1]);
    text = text.slice(0, block.index) + text.slice(block.index + block[0].length);
  }

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

  return { text, action, problem };
}

const SECTION_RE = /^(title|difficulty|schema|description|example\s*\d+|constraints|follow[\s-]?up)\s*:\s*(.*)$/i;
const EXAMPLE_KEY_RE = /^(input|output|explanation)\s*:\s*(.*)$/i;

/**
 * Parses a LeetCode-style <problem> block into
 * { title, difficulty, schema, description, examples: [{ input, output, explanation }], constraints: [], followUp, raw }.
 * Returns null if it has no usable description.
 */
export function parseProblem(body) {
  const lines = String(body)
    .replace(/^\s*```[a-z]*\s*$/gim, '')
    .split(/\r?\n/)
    // Models sometimes bold or heading-mark the labels.
    .map((l) => l.replace(/^\s*#{1,6}\s*/, '').replace(/^\s*\*\*([^*]+?):?\*\*:?/, '$1:').replace(/\s+$/, ''));

  const p = { title: '', difficulty: '', schema: '', description: '', examples: [], constraints: [], followUp: '' };
  let section = null;
  let example = null;
  let exampleKey = null;
  const add = (prev, line) => (prev ? `${prev}\n${line}` : line);

  for (const line of lines) {
    const s = line.trim().match(SECTION_RE);
    if (s) {
      const name = s[1].toLowerCase();
      section = name.startsWith('example') ? 'example' : name.startsWith('follow') ? 'followUp' : name;
      exampleKey = null;
      if (section === 'example') {
        example = { input: '', output: '', explanation: '' };
        p.examples.push(example);
      } else if (section === 'constraints') {
        if (s[2].trim()) p.constraints.push(s[2].trim());
      } else if (s[2].trim()) {
        p[section] = s[2].trim();
      }
      continue;
    }
    if (!section) continue;

    if (section === 'example') {
      const k = line.trim().match(EXAMPLE_KEY_RE);
      if (k) {
        exampleKey = k[1].toLowerCase();
        example[exampleKey] = k[2].trim();
      } else if (exampleKey && (line.trim() || exampleKey !== 'explanation')) {
        example[exampleKey] = add(example[exampleKey], line);
      }
    } else if (section === 'constraints') {
      const item = line.trim().replace(/^[-*•]\s*/, '');
      if (item) p.constraints.push(item);
    } else if (section === 'title' || section === 'difficulty') {
      if (line.trim() && !p[section]) p[section] = line.trim();
    } else {
      p[section] = add(p[section], line);
    }
  }

  for (const key of ['schema', 'description', 'followUp']) p[key] = p[key].replace(/^\n+|\n+$/g, '');
  for (const ex of p.examples) for (const key of Object.keys(ex)) ex[key] = ex[key].replace(/^\n+|\n+$/g, '');
  p.examples = p.examples.filter((ex) => ex.input || ex.output);
  const diff = p.difficulty.match(/easy|medium|hard/i)?.[0];
  p.difficulty = diff ? diff[0].toUpperCase() + diff.slice(1).toLowerCase() : '';

  if (!p.description) return null;
  p.raw = problemToText(p);
  return p;
}

/** Plain-text version for the model's history, the evaluator, and retries. */
function problemToText(p) {
  const parts = [`Title: ${p.title || 'Problem'}`];
  if (p.difficulty) parts.push(`Difficulty: ${p.difficulty}`);
  if (p.schema) parts.push(`Schema:\n${p.schema}`);
  parts.push(`Description:\n${p.description}`);
  p.examples.forEach((ex, i) => {
    const lines = [`Example ${i + 1}:`];
    for (const [label, v] of [['Input', ex.input], ['Output', ex.output], ['Explanation', ex.explanation]]) {
      if (v) lines.push(v.includes('\n') ? `${label}:\n${v}` : `${label}: ${v}`);
    }
    parts.push(lines.join('\n'));
  });
  if (p.constraints.length) parts.push(`Constraints:\n${p.constraints.map((c) => `- ${c}`).join('\n')}`);
  if (p.followUp) parts.push(`Follow-up: ${p.followUp}`);
  return `<problem>\n${parts.join('\n')}\n</problem>`;
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
export function normalizeEvaluation(raw, records, hasDelivery = false) {
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
      deliveryNote: str(q.deliveryNote),
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

  const d = raw?.delivery ?? {};
  const delivery = hasDelivery
    ? {
      score: score(d.score),
      summary: str(d.summary),
      face: str(d.face),
      voice: str(d.voice),
      tips: (Array.isArray(d.tips) ? d.tips : []).map((x) => str(x)).filter(Boolean).slice(0, 3),
    }
    : null;

  return {
    overall: { score: score(raw?.overall?.score), summary: str(raw?.overall?.summary) },
    rounds,
    questions,
    topPractice,
    delivery,
  };
}
