import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measure, parseEvents, segments, classify, innerScript } from './metrics.mjs'

const wrap = event => JSON.stringify({ event })
const packet = (sources, extra = {}) => wrap({
  type: 'item.completed',
  item: {
    type: 'mcp_tool_call', server: 'z1p-repository', tool: 'repository_packet', status: 'completed', error: null,
    result: { content: [{ type: 'text', text: ['packet build  generation g  revision r', ...sources.map(([p, a, b]) => `source ${p}:${a}-${b}  sha256 abc  ${b - a + 1} lines`)].join('\n') }] },
    ...extra,
  },
})
const shell = (command, extra = {}) => wrap({ type: 'item.completed', item: { type: 'command_execution', command, aggregated_output: '', exit_code: 0, status: 'completed', ...extra } })
const run = (...lines) => measure(parseEvents(lines.join('\n')), { root: '/w' })

test('packet then a whole-file read of the same file counts as a re-read', () => {
  const m = run(packet([['src/a.ts', 1, 40]]), shell("bash -lc 'cat src/a.ts'"))
  assert.equal(m.packetCoveredFiles, 1)
  assert.deepEqual(m.rereadFiles, ['src/a.ts'])
  assert.equal(m.readsAfterPacket, 1)
})

test('a non-overlapping sed range is not a re-read', () => {
  const m = run(packet([['src/a.ts', 1, 40]]), shell("bash -lc \"sed -n '41,80p' src/a.ts\""))
  assert.equal(m.readsAfterPacket, 0)
})

test('an overlapping sed range and an absolute path inside the root are re-reads', () => {
  const m = run(packet([['src/a.ts', 10, 20]]), shell("sed -n '15,30p' /w/src/a.ts"))
  assert.deepEqual(m.rereadFiles, ['src/a.ts'])
})

test('a packet range running to end of file still overlaps a later tail read', () => {
  const m = run(packet([['src/a.ts', 5, 812]]), shell('tail -n 20 src/a.ts'))
  assert.equal(m.readsAfterPacket, 1)
})

test('head covers only its first lines', () => {
  assert.equal(run(packet([['src/a.ts', 50, 60]]), shell('head -20 src/a.ts')).readsAfterPacket, 0)
  assert.equal(run(packet([['src/a.ts', 5, 60]]), shell('head -n 20 src/a.ts')).readsAfterPacket, 1)
  assert.equal(run(packet([['src/a.ts', 11, 60]]), shell('head src/a.ts')).readsAfterPacket, 0)
})

test('a read before any packet does not count, and is reported as outside packets', () => {
  const m = run(shell('cat src/a.ts'), packet([['src/a.ts', 1, 40]]))
  assert.equal(m.readsAfterPacket, 0)
  assert.equal(m.readsOutsidePackets, 1)
})

test('searches after a packet are counted separately and do not raise the ratio', () => {
  const m = run(packet([['src/a.ts', 1, 40]]), shell("rg -n 'foo' src/a.ts"), shell('git grep foo'))
  assert.equal(m.readsAfterPacket, 0)
  assert.equal(m.searchesAfterPacket, 2)
})

test('the JSON packet form is read as well as the text form', () => {
  const json = wrap({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'z1p-repository', tool: 'repository_packet', status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify({ packet: { sources: [{ path: 'src/b.ts', startLine: 1, endLine: 9 }] } }) }] } } })
  assert.deepEqual(run(json, shell('cat src/b.ts')).rereadFiles, ['src/b.ts'])
})

test('packets from another server or a failed packet give no coverage', () => {
  assert.equal(run(packet([['src/a.ts', 1, 40]], { server: 'other' }), shell('cat src/a.ts')).packetCoveredFiles, 0)
  assert.equal(run(packet([['src/a.ts', 1, 40]], { status: 'failed', error: 'stale' }), shell('cat src/a.ts')).packetCoveredFiles, 0)
})

test('no packet-covered files gives a null ratio, not zero', () => {
  assert.equal(run(shell('cat src/a.ts')).readsAfterPacket, null)
})

test('tool errors come from failed MCP calls, isError results and commands that did not run', () => {
  const m = run(
    packet([['src/a.ts', 1, 4]], { status: 'failed', error: 'x' }),
    wrap({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'z1p-repository', tool: 'repository_search', status: 'completed', result: { isError: true, content: [] } } }),
    shell('ls', { status: 'declined', exit_code: null }),
    shell('rg missing', { status: 'failed', exit_code: 1 }),
    shell('ls'),
  )
  assert.equal(m.toolResults, 5)
  assert.equal(m.toolErrors, 3)
  assert.equal(m.toolErrorRate, 3 / 5)
  assert.equal(m.nonZeroExits, 1)
})

test('unrecognised commands raise the unclassified count', () => {
  const m = run(shell('custom-reader src/a.ts && ls && perl -ne print src/a.ts'))
  assert.equal(m.unclassifiedSegments, 2)
  assert.equal(m.commands, 1)
})

test('events that are not completed tool items are ignored, and raw unwrapped events are accepted', () => {
  const raw = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', status: 'completed', exit_code: 0 } })
  const m = run(JSON.stringify({ event: { type: 'turn.completed', usage: {} } }), 'not json', raw)
  assert.equal(m.toolResults, 1)
})

test('tokeniser splits segments, keeps quoted text and drops output redirects', () => {
  assert.deepEqual(segments("sed -n '1,20p' a.ts 2>&1 | head -5 && cat 'b c.ts' > out.txt; echo \"x;y\""),
    [['sed', '-n', '1,20p', 'a.ts'], ['head', '-5'], ['cat', 'b c.ts'], ['echo', 'x;y']])
  assert.equal(innerScript("/bin/zsh -lc 'cat a.ts'"), 'cat a.ts')
  assert.equal(innerScript(['bash', '-lc', 'cat a.ts']), 'cat a.ts')
})

test('awk line ranges and multi-range sed are parsed', () => {
  assert.deepEqual(classify(['awk', 'NR>=5 && NR<=9', 'a.ts']).reads, [{ path: 'a.ts', start: 5, end: 9 }])
  assert.deepEqual(classify(['sed', '-n', '1,3p;7,8p', 'a.ts']).reads, [{ path: 'a.ts', start: 1, end: 3 }, { path: 'a.ts', start: 7, end: 8 }])
})
