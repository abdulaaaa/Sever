// Spotting text that names a blocked person: clean-up and fuzzy matching.
// No imports, so the content script can use it on its own.

export interface WatchTerm {
  person: string;
  id: string;   // block to show on the blocked page
  term: string; // letters only, e.g. "janedoe"
}

// Blocked searches and lookalike profiles are counted against the person,
// not one of their links. This is the name they are saved under.
export const searchTarget = (person: string): string => "search:" + person;

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

// "@Jané_D0e99" -> ["jane", "doe"]
export function watchTokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9@$]+/)
    .map((t) =>
      t
        .replace(/^[@$]+/, "")
        .replace(/[\d@$]+$/, "")
        .replace(/[013457@$]/g, (c) => LEET[c])
        .replace(/[^a-z]/g, "")
    )
    .filter(Boolean);
}

export const watchSquash = (text: string): string => watchTokens(text).join("");

// Typos allowed for a term of this length. Short terms must match exactly.
const slack = (len: number): number => (len < 6 ? 0 : len < 10 ? 1 : 2);

// Is the edit distance between a and b at most k?
function editWithin(a: string, b: string, k: number): boolean {
  if (Math.abs(a.length - b.length) > k) return false;
  if (k === 0) return a === b;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (row[j] < best) best = row[j];
    }
    if (best > k) return false;
    prev = row;
  }
  return prev[b.length] <= k;
}

// The first term this text names, or null. Looks at single words and at runs
// of up to three words joined together, so "jane doe" and "jane_doe" both match "janedoe".
export function watchMatch(text: string, terms: WatchTerm[]): WatchTerm | null {
  if (!terms.length) return null;
  const tokens = watchTokens(text).slice(-40);
  if (!tokens.length) return null;

  const runs = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= 3 && i + n <= tokens.length; n++) runs.add(tokens.slice(i, i + n).join(""));
  }
  const all = tokens.join("");

  for (const t of terms) {
    if (t.term.length >= 5 && all.includes(t.term)) return t;
    const k = slack(t.term.length);
    for (const run of runs) if (editWithin(run, t.term, k)) return t;
  }
  return null;
}
