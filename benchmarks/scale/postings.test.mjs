/**
 * postings.test.mjs
 * Tests for the synthetic posting-index prototype. Node 24 ESM, node:test.
 * No external dependencies or network access.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostingIndex } from './postings.mjs';

// 13 records; each text contains the token "shared", "needle", and a number.
function makeRecords(n = 13) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: 'r' + String(i).padStart(7, '0'),
      text: 'shared needle' + i,
    });
  }
  return out;
}

// Collect pages until complete. Because a full page is never marked complete,
// the terminating page is the FIRST page with fewer than cap rows (possibly
// empty). We assert that final page's shape; callers can inspect earlier pages.
function collectAll(idx, scope, generation, term, { limit, maxPostings }) {
  const collected = [];
  const cap = Math.min(limit, maxPostings);
  let page = idx.search(scope, generation, term, { limit, maxPostings });
  assert.ok(page.ids.length <= cap, 'page respects cap');
  collected.push(...page.ids);
  let pageCount = 1;
  while (!page.complete) {
    assert.ok(page.cursor && typeof page.cursor === 'object', 'incomplete page has cursor');
    page = idx.search(scope, generation, term, {
      limit,
      maxPostings,
      cursor: page.cursor,
    });
    pageCount++;
    assert.ok(page.ids.length <= cap, 'page respects cap');
    collected.push(...page.ids);
  }
  // Complete page has no cursor and fewer than `cap` rows.
  assert.strictEqual(page.cursor, undefined, 'complete page has no cursor');
  assert.ok(page.ids.length < cap, 'complete page is not full');
  return { collected, pageCount, lastPage: page };
}

test('pagination over 13 shared records with limit5/maxPostings3', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g', makeRecords(13));
    const { collected, lastPage, pageCount } = collectAll(idx, 's', 'g', 'shared', {
      limit: 5,
      maxPostings: 3,
    });
    assert.strictEqual(collected.length, 13, 'all 13 ids collected');
    // 13 = 4 full pages of 3 + one final page of 1.
    assert.strictEqual(pageCount, 5, 'four full pages + one row');
    assert.strictEqual(lastPage.ids.length, 1, 'final page has ONE row');
    assert.strictEqual(lastPage.complete, true, 'short final page is complete');
    // Sorted ascending (string compare on zero-padded ids).
    const sorted = [...collected].sort();
    assert.deepEqual(collected, sorted, 'ids are in ascending order');
  } finally {
    idx.close();
  }
});

test('exact 3-row end requires empty continuation', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g', [
      { id: 'r0000001', text: 'alpha one' },
      { id: 'r0000002', text: 'alpha two' },
      { id: 'r0000003', text: 'alpha three' },
    ]);
    // Inspect the FIRST page directly: exactly cap rows -> incomplete.
    const first = idx.search('s', 'g', 'alpha', { limit: 3, maxPostings: 3 });
    assert.strictEqual(first.ids.length, 3, 'first page is full');
    assert.strictEqual(first.complete, false, 'exactly-full page not complete');
    assert.ok(first.cursor, 'incomplete page has cursor');
    // Continuation is empty and complete.
    const cont = idx.search('s', 'g', 'alpha', {
      limit: 3,
      maxPostings: 3,
      cursor: first.cursor,
    });
    assert.deepStrictEqual(cont.ids, [], 'continuation empty');
    assert.strictEqual(cont.postingsRead, 0, 'zero rows read');
    assert.strictEqual(cont.complete, true, 'empty page complete');
    assert.strictEqual(cont.cursor, undefined, 'empty page no cursor');
  } finally {
    idx.close();
  }
});

test('empty generation is tracked and searchable as empty', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g-empty', []);
    const page = idx.search('s', 'g-empty', 'shared', { limit: 5, maxPostings: 3 });
    assert.deepStrictEqual(page.ids, []);
    assert.strictEqual(page.postingsRead, 0);
    assert.strictEqual(page.complete, true);
    assert.strictEqual(page.cursor, undefined);
    assert.throws(() => idx.search('s', 'nope', 'shared'), /unknown generation/);
  } finally {
    idx.close();
  }
});

test('duplicate empty generation is rejected', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g-empty', []);
    assert.throws(() => idx.build('s', 'g-empty', []), /duplicate generation/);
  } finally {
    idx.close();
  }
});

test('scope isolation: same IDs, different tokens; missing token both ways', () => {
  const idx = new PostingIndex();
  try {
    // Same ids, DIFFERENT tokens per scope.
    idx.build('scope-a', 'g', [
      { id: 'r0000001', text: 'alpha shared' },
      { id: 'r0000002', text: 'alpha shared' },
    ]);
    idx.build('scope-b', 'g', [
      { id: 'r0000001', text: 'beta shared' },
      { id: 'r0000002', text: 'beta shared' },
    ]);
    const aShared = idx.search('scope-a', 'g', 'shared', { limit: 100, maxPostings: 100 });
    const bShared = idx.search('scope-b', 'g', 'shared', { limit: 100, maxPostings: 100 });
    assert.deepEqual(aShared.ids, ['r0000001', 'r0000002']);
    assert.deepEqual(bShared.ids, ['r0000001', 'r0000002']);
    // "alpha" only exists in scope-a; "beta" only exists in scope-b.
    const aAlpha = idx.search('scope-a', 'g', 'alpha', { limit: 100, maxPostings: 100 });
    const aBeta = idx.search('scope-a', 'g', 'beta', { limit: 100, maxPostings: 100 });
    const bAlpha = idx.search('scope-b', 'g', 'alpha', { limit: 100, maxPostings: 100 });
    const bBeta = idx.search('scope-b', 'g', 'beta', { limit: 100, maxPostings: 100 });
    assert.deepEqual(aAlpha.ids, ['r0000001', 'r0000002']);
    assert.deepEqual(aBeta.ids, [], 'beta must NOT appear in scope-a');
    assert.deepEqual(bAlpha.ids, [], 'alpha must NOT appear in scope-b');
    assert.deepEqual(bBeta.ids, ['r0000001', 'r0000002']);
  } finally {
    idx.close();
  }
});

test('pinned generation remains after newer build', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g1', makeRecords(5));
    idx.build('s', 'g2', makeRecords(8));
    const g1 = idx.search('s', 'g1', 'shared', { limit: 100, maxPostings: 100 });
    const g2 = idx.search('s', 'g2', 'shared', { limit: 100, maxPostings: 100 });
    assert.strictEqual(g1.ids.length, 5);
    assert.strictEqual(g2.ids.length, 8);
    const g1again = idx.search('s', 'g1', 'shared', { limit: 100, maxPostings: 100 });
    assert.strictEqual(g1again.ids.length, 5);
  } finally {
    idx.close();
  }
});

test('invalid and mismatched cursors are rejected (before any SQL)', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g', makeRecords(13));
    idx.build('s2', 'g2', makeRecords(3));
    const p = idx.search('s', 'g', 'shared', { limit: 3, maxPostings: 3 });
    const cur = p.cursor;
    assert.ok(cur, 'first page returns a cursor');

    // Mismatched scope: query existing scope 's2'.
    assert.throws(
      () => idx.search('s2', 'g2', 'shared', { limit: 3, maxPostings: 3, cursor: cur }),
      /cursor\.scope mismatch/
    );
    // Mismatched generation: query existing generation 'g2' under 's'.
    assert.throws(
      () => idx.search('s', 'g2', 'shared', { limit: 3, maxPostings: 3, cursor: cur }),
      /cursor\.generation mismatch/
    );
    // Mismatched term.
    assert.throws(
      () => idx.search('s', 'g', 'needle', { limit: 3, maxPostings: 3, cursor: cur }),
      /cursor\.term mismatch/
    );
    // Wrong version.
    assert.throws(
      () =>
        idx.search('s', 'g', 'shared', {
          limit: 3,
          maxPostings: 3,
          cursor: { version: 2, scope: 's', generation: 'g', term: 'shared', after: 'r0000001' },
        }),
      /cursor\.version/
    );
    // Invalid after id.
    assert.throws(
      () =>
        idx.search('s', 'g', 'shared', {
          limit: 3,
          maxPostings: 3,
          cursor: { version: 1, scope: 's', generation: 'g', term: 'shared', after: 'bad' },
        }),
      /cursor\.after/
    );
    // Non-object cursor.
    assert.throws(
      () => idx.search('s', 'g', 'shared', { limit: 3, maxPostings: 3, cursor: 'x' }),
      /cursor must be a plain object/
    );
    // Plain null cursor is invalid (not the same as "no cursor").
    assert.throws(
      () => idx.search('s', 'g', 'shared', { limit: 3, maxPostings: 3, cursor: null }),
      /cursor must be a plain object/
    );
  } finally {
    idx.close();
  }
});

test('invalid term / limits / maxPostings are rejected', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g', makeRecords(3));
    assert.throws(() => idx.search('s', 'g', 123), /term must be a string/);
    assert.throws(() => idx.search('s', 'g', 'Shared'), /single lowercase ASCII token/);
    assert.throws(() => idx.search('s', 'g', 'shared x'), /single lowercase ASCII token/);
    assert.throws(() => idx.search('s', 'g', ''), /term length/);
    assert.throws(() => idx.search('s', 'g', 'a'.repeat(129)), /term length/);
    assert.throws(() => idx.search('s', 'g', 'shared', { limit: 0 }), /limit/);
    assert.throws(() => idx.search('s', 'g', 'shared', { limit: 101 }), /limit/);
    assert.throws(() => idx.search('s', 'g', 'shared', { limit: 1.5 }), /limit/);
    assert.throws(() => idx.search('s', 'g', 'shared', { maxPostings: 0 }), /maxPostings/);
    assert.throws(() => idx.search('s', 'g', 'shared', { maxPostings: 10001 }), /maxPostings/);
  } finally {
    idx.close();
  }
});

test('throwing iterator rolls back, closes iterator, and allows retry', () => {
  const idx = new PostingIndex();
  try {
    let returned = false;
    function* throwingGenerator() {
      try {
        yield { id: 'r0000001', text: 'shared one' };
        throw new Error('boom mid-stream');
      } finally {
        returned = true;
      }
    }
    assert.throws(() => idx.build('s', 'g', throwingGenerator()), /boom mid-stream/);
    assert.strictEqual(returned, true, 'iterator return() was invoked on error');
    // Rolled back; retry allowed.
    assert.throws(() => idx.search('s', 'g', 'shared'), /unknown generation/);
    idx.build('s', 'g', makeRecords(4));
    const page = idx.search('s', 'g', 'shared', { limit: 100, maxPostings: 100 });
    assert.strictEqual(page.ids.length, 4);
  } finally {
    idx.close();
  }
});

test('duplicate record id in a generation rolls back', () => {
  const idx = new PostingIndex();
  try {
    const records = [
      { id: 'r0000001', text: 'shared one' },
      { id: 'r0000001', text: 'shared two' },
    ];
    assert.throws(
      () => idx.build('s', 'g', records),
      /SQLITE_CONSTRAINT|constraint|PRIMARY/i
    );
    assert.throws(() => idx.search('s', 'g', 'shared'), /unknown generation/);
    idx.build('s', 'g', [
      { id: 'r0000001', text: 'shared one' },
      { id: 'r0000002', text: 'shared two' },
    ]);
    const page = idx.search('s', 'g', 'shared', { limit: 100, maxPostings: 100 });
    assert.deepEqual(page.ids, ['r0000001', 'r0000002']);
  } finally {
    idx.close();
  }
});

test('repeated token appears once per record', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g', [
      { id: 'r0000001', text: 'shared shared shared' },
      { id: 'r0000002', text: 'shared needle' },
    ]);
    const page = idx.search('s', 'g', 'shared', { limit: 100, maxPostings: 100 });
    assert.deepEqual(page.ids, ['r0000001', 'r0000002']);
    assert.strictEqual(page.ids.length, 2, 'token deduped per record');
  } finally {
    idx.close();
  }
});

test('overlong token is rejected, never truncated', () => {
  const idx = new PostingIndex();
  try {
    const longToken = 'a'.repeat(129);
    assert.throws(
      () => idx.build('s', 'g', [{ id: 'r0000001', text: longToken }]),
      /token exceeds 128/
    );
    assert.throws(() => idx.search('s', 'g', 'a'.repeat(128)), /unknown generation/);
  } finally {
    idx.close();
  }
});

test('reopen temp file: cursor captured before close works after reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'postings-'));
  const path = join(dir, 'index.sqlite');
  let idx2;
  try {
    const idx = new PostingIndex(path);
    idx.build('s', 'g', makeRecords(13));
    idx.build('s', 'g2', makeRecords(7));
    // Capture the cursor BEFORE closing.
    const first = idx.search('s', 'g', 'shared', { limit: 3, maxPostings: 3 });
    assert.strictEqual(first.ids.length, 3);
    assert.strictEqual(first.complete, false);
    const captured = first.cursor;
    assert.ok(captured, 'cursor captured before close');
    idx.close();

    idx2 = new PostingIndex(path);
    // Generation preserved.
    const p2 = idx2.search('s', 'g2', 'shared', { limit: 100, maxPostings: 100 });
    assert.strictEqual(p2.ids.length, 7);
    // Captured cursor still advances after reopen.
    const next = idx2.search('s', 'g', 'shared', {
      limit: 3,
      maxPostings: 3,
      cursor: captured,
    });
    assert.strictEqual(next.ids.length, 3, 'cursor advanced with full page');
    assert.deepEqual(next.ids, ['r0000003', 'r0000004', 'r0000005']);
    // Full pagination still works after reopen.
    const { collected } = collectAll(idx2, 's', 'g', 'shared', { limit: 3, maxPostings: 3 });
    assert.strictEqual(collected.length, 13);
  } finally {
    if (idx2) idx2.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('explainSearchPlan: PK index SEARCH, no SCAN, no temp sort', () => {
  const idx = new PostingIndex();
  try {
    idx.build('s', 'g', makeRecords(13));
    const details = idx.explainSearchPlan('s', 'g', 'shared');
    assert.ok(Array.isArray(details) && details.length > 0, 'has detail strings');
    for (const d of details) assert.strictEqual(typeof d, 'string');
    const joined = details.join('\n');
    assert.match(joined, /SEARCH/, 'uses an indexed SEARCH');
    assert.match(joined, /PRIMARY KEY/, 'uses the composite PRIMARY KEY index');
    assert.doesNotMatch(joined, /\bSCAN\b/, 'no full table SCAN');
    assert.doesNotMatch(joined, /TEMP B-TREE/i, 'no temp b-tree (sort)');
    assert.doesNotMatch(joined, /USE TEMP/i, 'no temp structure for sort');
    // Input validation.
    assert.throws(() => idx.explainSearchPlan('s', 'g', 'Bad'), /lowercase ASCII token/);
    assert.throws(() => idx.explainSearchPlan('s', 'nope', 'shared'), /unknown generation/);
  } finally {
    idx.close();
  }
});
