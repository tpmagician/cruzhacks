// Daily hint allowance for technical questions, shared across every interview
// in this browser. Resets at local midnight. Stored in localStorage, so it is a
// practice limit rather than an enforced one (clearing site data resets it).

export const HINTS_PER_DAY = 3;
const KEY = 'ips-hints';

let memory = { date: '', used: 0 }; // fallback when storage is unavailable

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved.used === 'number') memory = saved;
  } catch {
    // storage unavailable; keep the in-memory count
  }
  return memory.date === today() ? memory.used : 0;
}

export function hintsLeftToday() {
  return Math.max(0, HINTS_PER_DAY - load());
}

export function useHint() {
  memory = { date: today(), used: load() + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // ignore
  }
}
