import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { retrieveView } from '../packages/context/dist/retrieval.js'
import { partitionBenchmarkRecords, measureBenchmarkRetrieval } from './collection-corpus.mjs'

const now = 1_800_000_000
const tokens = text => encode(text).length
const records = count => Array.from({ length: count }, (_, i) => ({
  id: createHash('sha256').update(`record-${i}`).digest('hex'),
  kind: 'evidence', text: i === count - 1 ? 'needle evidence 🌳' : 'unrelated background',
  source: `fixture-${i}.ts`, observedAt: now, author: '1d'.repeat(32), event: '4e'.repeat(32),
}))

for (const count of [128, 129, 256, 4096]) {
  test(`retains all ${count} records exactly once in deterministic bounded collections`, () => {
    const input = records(count)
    const before = structuredClone(input)
    const views = partitionBenchmarkRecords(input, now)
    assert.equal(views.length, Math.ceil(count / 128))
    assert.ok(views.every(view => view.records.length > 0 && view.records.length <= 128))
    assert.equal(new Set(views.map(view => view.id)).size, views.length)
    assert.deepEqual(views.flatMap(view => view.records), before)
    assert.deepEqual(input, before)
    assert.deepEqual(partitionBenchmarkRecords(input, now), views)
  })
}

test('rejects unsupported capacity and invalid identity without silently dropping records', () => {
  assert.throws(() => partitionBenchmarkRecords([], now))
  assert.throws(() => partitionBenchmarkRecords(records(4097), now))
  const [record] = records(1)
  assert.throws(() => partitionBenchmarkRecords([record, record], now))
  assert.throws(() => partitionBenchmarkRecords([{ ...record, id: 'invalid' }], now))
})

test('charges empty responses and finds evidence beyond the first 128 records', () => {
  const views = partitionBenchmarkRecords(records(129), now)
  const seen = []
  const result = measureBenchmarkRetrieval(views, 'needle', text => {
    seen.push(text)
    return tokens(text)
  })
  const expected = views.map(view => JSON.stringify(retrieveView(view, {
    query: 'needle', maxBytes: 8192, maxRecords: 4, includeRelated: false,
  })))
  assert.deepEqual(seen, expected)
  assert.equal(result.retrievalCalls, 2)
  assert.deepEqual(result.returnedSources, ['fixture-128.ts'])
  assert.equal(result.retrievedTokens, expected.reduce((sum, text) => sum + tokens(text), 0))
  assert.equal(result.bytesUsed, expected.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0))
  assert.equal(result.collections[0].returnedRecords, 0)
  assert.ok(result.collections[0].retrievedTokens > 0)
  assert.equal(result.collections[1].returnedRecords, 1)
  assert.ok(result.collections.every(row => row.bytesUsed <= 8192 && row.returnedRecords <= 4))
})

test('one collection retains the original v1 retrieval payload and budget', () => {
  const input = records(10)
  const legacyView = { id: '2e'.repeat(32), owner: '1d'.repeat(32), title: 'Context repository benchmark',
    scope: 'personal', epoch: 1, head: '3f'.repeat(32), revision: 1, updatedAt: now,
    role: 'write', uploaded: false, records: input }
  const payload = retrieveView(legacyView, { query: 'needle', maxBytes: 8192, maxRecords: 4, includeRelated: false })
  const result = measureBenchmarkRetrieval(partitionBenchmarkRecords(input, now), 'needle', tokens)
  assert.equal(result.retrievalCalls, 1)
  assert.equal(result.retrievedTokens, tokens(JSON.stringify(payload)))
  assert.equal(result.bytesUsed, payload.bytesUsed)
})

test('refuses invalid view sets before counting any response', () => {
  const [view] = partitionBenchmarkRecords(records(1), now)
  const counter = () => { assert.fail('invalid view sets must fail before retrieval') }
  for (const views of [[], [view, view], Array.from({ length: 33 }, () => view),
    [{ ...view, records: [] }], [{ ...view, records: records(129) }]]) {
    assert.throws(() => measureBenchmarkRetrieval(views, 'needle', counter))
  }
})
