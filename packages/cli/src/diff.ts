/**
 * A unified diff of two texts, line by line, in the format of `diff -u`. `generate --check`
 * prints it for drifted files. The common prefix and suffix are trimmed first, so the LCS
 * table only covers the lines that changed.
 */

interface Op {
  kind: ' ' | '-' | '+';
  line: string;
  /** How many lines of each side come before this op. */
  a: number;
  b: number;
}

/** Lines without their newline. A missing final newline is marked the way diff marks it. */
function lines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  const last = parts.pop() ?? '';
  if (last !== '') parts.push(`${last}\n\\ No newline at end of file`);
  return parts;
}

function editScript(a: readonly string[], b: readonly string[]): Op[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const ops: Op[] = [];
  for (let k = 0; k < prefix; k++) ops.push({ kind: ' ', line: a[k] ?? '', a: k, b: k });

  const endA = a.length - suffix;
  const endB = b.length - suffix;
  const width = endB - prefix + 1;
  // lcs(i, j): length of the longest common subsequence of a[i..endA) and b[j..endB).
  const table = new Uint32Array((endA - prefix + 1) * width);
  const lcs = (i: number, j: number) => table[(i - prefix) * width + (j - prefix)] ?? 0;
  for (let i = endA - 1; i >= prefix; i--) {
    for (let j = endB - 1; j >= prefix; j--) {
      table[(i - prefix) * width + (j - prefix)] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  let i = prefix;
  let j = prefix;
  while (i < endA || j < endB) {
    const left = i < endA ? a[i] : undefined;
    const right = j < endB ? b[j] : undefined;
    if (left !== undefined && left === right) {
      ops.push({ kind: ' ', line: left, a: i, b: j });
      i++;
      j++;
    } else if (left !== undefined && (right === undefined || lcs(i + 1, j) >= lcs(i, j + 1))) {
      // Ties go to deletions, so a changed line prints its - before its +.
      ops.push({ kind: '-', line: left, a: i, b: j });
      i++;
    } else {
      ops.push({ kind: '+', line: right ?? '', a: i, b: j });
      j++;
    }
  }

  for (let k = 0; k < suffix; k++) {
    ops.push({ kind: ' ', line: a[endA + k] ?? '', a: endA + k, b: endB + k });
  }
  return ops;
}

/** `start,length` as diff prints it: an empty range names the line before it. */
function range(before: number, length: number): string {
  const start = length === 0 ? before : before + 1;
  return length === 1 ? `${start}` : `${start},${length}`;
}

/** The diff from `before` to `after`, or '' when they are equal. */
export function unifiedDiff(
  before: string,
  after: string,
  labels: { from: string; to: string },
  context = 3,
): string {
  if (before === after) return '';
  const ops = editScript(lines(before), lines(after));

  // Each change keeps `context` ops on either side; hunks that touch are merged.
  const hunks: [start: number, end: number][] = [];
  for (const [k, op] of ops.entries()) {
    if (op.kind === ' ') continue;
    const start = Math.max(0, k - context);
    const end = Math.min(ops.length - 1, k + context);
    const last = hunks.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  const out = [`--- ${labels.from}`, `+++ ${labels.to}`];
  for (const [start, end] of hunks) {
    const hunk = ops.slice(start, end + 1);
    const first = hunk[0];
    if (!first) continue;
    const lengthA = hunk.filter((op) => op.kind !== '+').length;
    const lengthB = hunk.filter((op) => op.kind !== '-').length;
    out.push(`@@ -${range(first.a, lengthA)} +${range(first.b, lengthB)} @@`);
    for (const op of hunk) out.push(`${op.kind}${op.line}`);
  }
  return `${out.join('\n')}\n`;
}
