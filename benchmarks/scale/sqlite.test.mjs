import test from "node:test";
import assert from "node:assert/strict";
import { ScaleIndex } from "./sqlite.mjs";
import {
  recordsFor,
  edgesFor,
  recordId,
  needleTerm,
  expectedEdgeTargets,
} from "./corpus.mjs";

function makeIndex() {
  const idx = new ScaleIndex(":memory:");
  return idx;
}

test("corpus: deterministic, exactly 5 valid edges per record, no self edges", () => {
  const count = 10;
  const records = [...recordsFor(count)];
  assert.equal(records.length, count);
  assert.equal(records[0].id, recordId(0));
  assert.equal(records[9].id, recordId(9));
  assert.equal(records[0].source, "src/file0000.ts");
  assert.ok(records[0].text.includes(needleTerm(0)));

  const edges = [...edgesFor(count)];
  assert.equal(edges.length, count * 5);
  const ids = new Set(records.map((r) => r.id));
  const seen = new Set();
  for (const e of edges) {
    assert.ok(ids.has(e.source), `unknown source ${e.source}`);
    assert.ok(ids.has(e.target), `unknown target ${e.target}`);
    assert.notEqual(e.source, e.target, "no self edges");
    assert.equal(e.kind, "calls");
    const key = `${e.source}->${e.target}`;
    assert.ok(!seen.has(key), `duplicate edge ${key}`);
    seen.add(key);
  }

  // Wrap-around behaviour for the first record.
  const targets = edges.filter((e) => e.source === recordId(0)).map((e) => e.target).sort();
  assert.deepEqual(targets, expectedEdgeTargets(count, 0).sort());
});

test("generators are deterministic across repeated invocations", () => {
  const a = [...recordsFor(13, { revision: 1 })];
  const b = [...recordsFor(13, { revision: 1 })];
  assert.deepEqual(a, b);
  assert.ok(a[0].text.includes("refreshed"));
  assert.ok(!a[1].text.includes("refreshed"));
  const ea = [...edgesFor(13)];
  const eb = [...edgesFor(13)];
  assert.deepEqual(ea, eb);
});

test("exact lookup, search, and adjacency under scope+generation isolation", () => {
  const idx = makeIndex();
  try {
    const count = 64;
    idx.build("s1", "g1", recordsFor(count), edgesFor(count));
    idx.build("s2", "g1", recordsFor(count), edgesFor(count));

    const id = recordId(7);
    const a = idx.lookup("s1", "g1", id);
    const b = idx.lookup("s2", "g1", id);
    assert.ok(a && b);
    assert.equal(a.id, id);
    assert.equal(b.id, id);

    // Search must only return this scope/generation.
    const s1 = idx.search("s1", "g1", needleTerm(7), 10);
    assert.equal(s1.count, 1);
    assert.equal(s1.results[0].id, id);
    assert.equal(s1.internalWorkMeasured, false);

    const s2 = idx.search("s2", "g1", needleTerm(7), 10);
    assert.equal(s2.count, 1);
    assert.equal(s2.results[0].id, id);

    // Neighbours: five deterministic targets.
    const nb = idx.neighbours("s1", "g1", id, 5);
    assert.equal(nb.count, 5);
    assert.deepEqual(nb.results, expectedEdgeTargets(count, 7).sort());
    assert.equal(nb.internalWorkMeasured, false);

    // Missing id: undefined, not an error.
    assert.equal(idx.lookup("s1", "g1", recordId(999999 - (999999 % 1)) && "r9999999"), undefined);
  } finally {
    idx.close();
  }
});

test("update generation preserves old pinned reads and switches current", () => {
  const idx = makeIndex();
  try {
    const count = 32;
    idx.build("sc", "g1", recordsFor(count, { revision: 0 }), edgesFor(count));
    const before = idx.lookup("sc", "g1", recordId(0));
    assert.ok(before);
    assert.ok(!before.text.includes("refreshed"));

    idx.build("sc", "g2", recordsFor(count, { revision: 1 }), edgesFor(count));
    assert.equal(idx.activeGeneration("sc"), "g2");

    const pinned = idx.lookup("sc", "g1", recordId(0));
    assert.ok(pinned);
    assert.equal(pinned.text, before.text, "old pinned generation must remain readable unchanged");

    const current = idx.lookup("sc", "g2", recordId(0));
    assert.ok(current);
    assert.ok(current.text.includes("refreshed"));
  } finally {
    idx.close();
  }
});

test("failed generator mid-build rolls back new generation and retains prior head", () => {
  const idx = makeIndex();
  try {
    const count = 24;
    idx.build("rb", "g1", recordsFor(count), edgesFor(count));
    assert.equal(idx.activeGeneration("rb"), "g1");

    function* brokenRecords() {
      let i = 0;
      for (const r of recordsFor(count)) {
        if (i === 5) throw new Error("injected record failure");
        i++;
        yield r;
      }
    }

    assert.throws(() => idx.build("rb", "g2", brokenRecords(), edgesFor(count)), /injected record failure/);
    assert.equal(idx.activeGeneration("rb"), "g1");
    assert.equal(idx.lookup("rb", "g2", recordId(0)), undefined);
    assert.ok(idx.lookup("rb", "g1", recordId(0)));
  } finally {
    idx.close();
  }
});

test("dangling edge rolls back new generation and retains prior head", () => {
  const idx = makeIndex();
  try {
    const count = 24;
    idx.build("dg", "g1", recordsFor(count), edgesFor(count));
    assert.equal(idx.activeGeneration("dg"), "g1");

    function* badEdges() {
      yield { source: recordId(0), target: recordId(1), kind: "calls" };
      yield { source: recordId(0), target: "r9999999", kind: "calls" };
    }

    assert.throws(() => idx.build("dg", "g2", recordsFor(count), badEdges()), /dangling edge/);
    assert.equal(idx.activeGeneration("dg"), "g1");
    assert.equal(idx.lookup("dg", "g2", recordId(0)), undefined);
  } finally {
    idx.close();
  }
});

test("hostile FTS query is treated as literal, no SQL injection or cross-scope leakage", () => {
  const idx = makeIndex();
  try {
    const count = 16;
    idx.build("hx", "g1", recordsFor(count), edgesFor(count));
    idx.build("hy", "g1", recordsFor(count), edgesFor(count));

    const hostile = ['needle0000004" OR "1"=="1', "needle0000004' OR '1'='1", "*", '"'];
    for (const term of hostile) {
      const r = idx.search("hx", "g1", term, 10);
      assert.equal(r.count, 0, `hostile term matched unexpectedly: ${term}`);
    }

    // A literal quote inside a real match still works as literal phrase.
    const quoted = idx.search("hx", "g1", needleTerm(4), 10);
    assert.equal(quoted.count, 1);
    assert.equal(quoted.results[0].id, recordId(4));

    // No cross-scope leakage: search for hx needle under hy returns nothing.
    const cross = idx.search("hy", "g1", "definitely-not-in-corpus", 10);
    assert.equal(cross.count, 0);
  } finally {
    idx.close();
  }
});

test("invalid limits and duplicate generation rejection", () => {
  const idx = makeIndex();
  try {
    const count = 16;
    idx.build("li", "g1", recordsFor(count), edgesFor(count));
    assert.throws(() => idx.search("li", "g1", "shared", 0), RangeError);
    assert.throws(() => idx.search("li", "g1", "shared", 101), RangeError);
    assert.throws(() => idx.neighbours("li", "g1", recordId(0), -1), RangeError);
    assert.throws(() => idx.lookup("li", "g1", "not-an-id"), TypeError);

    assert.throws(
      () => idx.build("li", "g1", recordsFor(count), edgesFor(count)),
      /generation already present/
    );

    assert.throws(() => idx.build("", "gx", recordsFor(count), edgesFor(count)), TypeError);
    assert.throws(() => idx.build("li", "", recordsFor(count), edgesFor(count)), TypeError);
  } finally {
    idx.close();
  }
});
