// Public synthetic corpus only. Never reads private repositories; no network.
// Streaming generators: no million-element arrays are retained by callers.

const MIN_COUNT = 10;
const MAX_COUNT = 1_000_000;

function assertCount(count) {
  if (!Number.isSafeInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new RangeError(`count must be a safe integer in [${MIN_COUNT}, ${MAX_COUNT}], got ${count}`);
  }
}

function pad7(n) {
  return String(n).padStart(7, "0");
}

export function recordId(index) {
  return `r${pad7(index)}`;
}

export function needleTerm(index) {
  return `needle${pad7(index)}`;
}

export const COMMON_KEYWORD = "shared";

export function sourceFor(index) {
  return `src/file${String(index % 10000).padStart(4, "0")}.ts`;
}

export function topicFor(index) {
  return index % 100;
}

// Revision 1 changes only record zero's text to contain "refreshed".
// All other revisions leave every record byte-identical.
export function* recordsFor(count, { revision = 0 } = {}) {
  assertCount(count);
  if (revision !== 0 && revision !== 1) {
    throw new RangeError(`revision must be 0 or 1, got ${revision}`);
  }
  for (let i = 0; i < count; i++) {
    const id = recordId(i);
    const text =
      revision === 1 && i === 0
        ? `refreshed ${COMMON_KEYWORD} topic${topicFor(i)} ${needleTerm(i)} body`
        : `${COMMON_KEYWORD} topic${topicFor(i)} ${needleTerm(i)} body`;
    yield { id, source: sourceFor(i), text };
  }
}

// Exactly 5 outgoing edges per record: i -> i+1 .. i+5 (wrapping).
// With count >= 10 there are no duplicates and no self edges.
export function* edgesFor(count) {
  assertCount(count);
  for (let i = 0; i < count; i++) {
    for (let step = 1; step <= 5; step++) {
      yield { source: recordId(i), target: recordId((i + step) % count), kind: "calls" };
    }
  }
}

export function expectedEdgeTargets(count, index) {
  assertCount(count);
  const out = [];
  for (let step = 1; step <= 5; step++) out.push(recordId((index + step) % count));
  return out;
}

export function expectedNeedleHits(count, index) {
  assertCount(count);
  if (index < 0 || index >= count) throw new RangeError(`index out of range: ${index}`);
  return [recordId(index)];
}

export const CORPUS_LIMITS = Object.freeze({ MIN_COUNT, MAX_COUNT });
