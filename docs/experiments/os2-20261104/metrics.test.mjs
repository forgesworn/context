import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measure, parseEvents, segments, classify, innerScript, analyse, scan, packetRanges } from './metrics.mjs'

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

test('unrecognised commands raise the unclassified count', () => {
  const m = run(shell('custom-reader src/a.ts && ls && perl -ne print src/a.ts'))
  assert.equal(m.unclassifiedSegments, 2)
  assert.equal(m.commands, 1)
})

test('events that are not completed tool items are ignored, and raw unwrapped events are accepted', () => {
  const raw = JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', status: 'completed', exit_code: 0 } })
  const m = run(JSON.stringify({ event: { type: 'turn.completed', usage: {} } }), raw)
  assert.equal(m.toolResults, 1)
  assert.equal(m.malformedLines, 0)
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

// helpers for the cases below
const mcp = (tool, extra = {}) => wrap({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'z1p-repository', tool, status: 'completed', error: null, result: { content: [] }, ...extra } })
const fileChange = status => wrap({ type: 'item.completed', item: { type: 'file_change', status, changes: [] } })
const look = command => analyse(command, '/w')
const paths = command => look(command).reads.map(r => r.path)
const kinds = (...commands) => commands.map(c => look(c).unclassified)
const summary = command => { const { reads, searches, unclassified } = look(command); return { reads, searches, unclassified } }

test('malformed lines are counted and make integrity malformed', () => {
  const clean = run(packet([['src/a.ts', 1, 40]]), '', '   ', shell('cat src/a.ts'))
  assert.equal(clean.malformedLines, 0)
  assert.equal(clean.integrity, 'ok')
  assert.equal(clean.readsAfterPacket, 1)
  const bad = ['not json', '{"type":"item.completed","item":{"type":"command_execution","command":"ls"', '42', 'null', '[]', '"x"',
    '{"event":"x"}', '{"event":null}', '{"event":{}}', '{"foo":1}']
  for (const line of bad) {
    const m = run(packet([['src/a.ts', 1, 40]]), line, shell('cat src/a.ts'))
    assert.equal(m.malformedLines, 1, line)
    assert.equal(m.integrity, 'malformed', line)
    assert.equal(m.readsAfterPacket, null, line)
    assert.equal(m.readsAfterPacketValid, false, line)
    assert.deepEqual(m.readsAfterPacketInvalidReasons, ['malformed-lines'], line)
  }
  assert.equal(run('x', 'y', 'z').malformedLines, 3)
})

test('parseEvents keeps the array shape and exposes the malformed count', () => {
  const events = parseEvents('{"type":"a"}\nnope\n{"event":{"type":"b"}}\n')
  assert.deepEqual(events, [{ type: 'a' }, { type: 'b' }])
  assert.equal(events.malformedLines, 1)
  assert.equal(measure(events).malformedLines, 1)
  assert.equal(measure([{ type: 'a' }], { malformedLines: 2 }).integrity, 'malformed')
})

test('mcp and shell error rates are separate and leave file changes out of both', () => {
  const m = run(
    packet([['src/a.ts', 1, 4]], { status: 'failed', error: 'x' }),
    mcp('repository_search', { result: { isError: true, content: [] } }),
    mcp('repository_status'),
    shell('ls'),
    shell('rg missing', { status: 'failed', exit_code: 1 }),
    shell('ls', { status: 'declined', exit_code: null }),
    shell('ls'),
    fileChange('completed'),
    fileChange('failed'),
  )
  assert.equal(m.toolResults, 9)
  assert.equal(m.mcpCalls, 3)
  assert.equal(m.mcpErrors, 2)
  assert.equal(m.mcpErrorRate, 2 / 3)
  assert.equal(m.commands, 4)
  assert.equal(m.shellErrors, 1)
  assert.equal(m.shellErrorRate, 1 / 4)
  assert.equal(m.nonZeroExits, 1)
  assert.equal(m.commandsNotRun, 1)
  assert.equal(m.fileChanges, 2)
  assert.equal(m.fileChangeErrors, 1)
  assert.equal('toolErrorRate' in m, false)
})

test('error rates are null without a denominator and ignore the other family', () => {
  const shellOnly = run(shell('ls'), shell('false', { exit_code: 1, status: 'failed' }))
  assert.equal(shellOnly.mcpErrorRate, null)
  assert.equal(shellOnly.shellErrorRate, 1 / 2)
  const mcpOnly = run(mcp('repository_search'), fileChange('failed'))
  assert.equal(mcpOnly.shellErrorRate, null)
  assert.equal(mcpOnly.mcpErrorRate, 0)
})

test('an unclassified segment makes readsAfterPacket null and says why', () => {
  const m = run(packet([['src/a.ts', 1, 40]]), shell('cat src/a.ts'), shell('custom-reader src/a.ts'))
  assert.equal(m.unclassifiedSegments, 1)
  assert.equal(m.readsAfterPacket, null)
  assert.equal(m.readsAfterPacketValid, false)
  assert.deepEqual(m.readsAfterPacketInvalidReasons, ['unclassified-segments'])
  assert.deepEqual(m.rereadFiles, ['src/a.ts'])
  assert.deepEqual(m.unclassifiedTouchingPackets, ['custom-reader src/a.ts'])
  assert.deepEqual(m.unclassifiedNotTouchingPackets, [])
})

test('a successful packet with no parseable ranges makes readsAfterPacket null', () => {
  const m = run(packet([]), shell('cat src/a.ts'))
  assert.equal(m.packets, 1)
  assert.equal(m.packetsWithoutRanges, 1)
  assert.equal(m.readsAfterPacket, null)
  assert.deepEqual(m.readsAfterPacketInvalidReasons, ['packet-without-ranges'])
  const odd = wrap({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'z1p-repository', tool: 'repository_packet', status: 'completed', result: { content: [{ type: 'text', text: 'something else entirely' }] } } })
  assert.equal(run(odd).readsAfterPacketValid, false)
  // a failed packet is an error, not a packet without ranges
  assert.equal(run(packet([]), packet([['src/a.ts', 1, 4]], { status: 'failed' })).packetsWithoutRanges, 1)
  assert.equal(run(packet([['src/a.ts', 1, 4]], { status: 'failed' })).readsAfterPacketValid, true)
})

test('invalid reasons accumulate and a clean run is valid', () => {
  const m = run(packet([]), packet([['src/a.ts', 1, 4]]), 'oops', shell("python3 -c \"open('src/a.ts')\""))
  assert.deepEqual(m.readsAfterPacketInvalidReasons, ['unclassified-segments', 'packet-without-ranges', 'malformed-lines'])
  const ok = run(packet([['src/a.ts', 1, 4]]), shell('cat src/a.ts'))
  assert.equal(ok.readsAfterPacketValid, true)
  assert.deepEqual(ok.readsAfterPacketInvalidReasons, [])
  const none = run(shell('ls'))
  assert.equal(none.readsAfterPacket, null)
  assert.equal(none.readsAfterPacketValid, true)
})

test('absolute packet paths inside the root match relative reads', () => {
  assert.deepEqual(packetRanges({ result: { content: [{ text: 'source /w/src/a.ts:1-9  sha256 x  9 lines' }] } }, '/w'), [{ path: 'src/a.ts', start: 1, end: 9 }])
  assert.equal(run(packet([['/w/src/a.ts', 1, 40]]), shell('cat src/a.ts')).readsAfterPacket, 1)
})

test('cat -n and other flags do not swallow the file', () => {
  assert.equal(run(packet([['src/a.ts', 1, 40]]), shell('cat -n src/a.ts')).readsAfterPacket, 1)
  assert.deepEqual(paths('nl -ba -w 3 src/a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('less -N src/a.ts'), ['src/a.ts'])
  assert.deepEqual(look('bat -r 10:20 src/a.ts').reads, [{ path: 'src/a.ts', start: 10, end: 20 }])
})

test('sed without -n prints every line, and a regex script is not a file', () => {
  assert.equal(run(packet([['src/a.ts', 30, 40]]), shell('sed 1,5p src/a.ts')).readsAfterPacket, 1)
  assert.deepEqual(look("sed -n '/foo/p' src/a.ts").reads, [{ path: 'src/a.ts', start: 1, end: Number.MAX_SAFE_INTEGER }])
  assert.deepEqual(look("sed -ne '2,4p;4q' src/a.ts").reads, [{ path: 'src/a.ts', start: 2, end: 4 }])
  assert.deepEqual(look('sed -i s/a/b/ src/a.ts').reads, [])
})

test('head and tail count forms', () => {
  const end = Number.MAX_SAFE_INTEGER
  assert.deepEqual(look('head -n -5 src/a.ts').reads, [{ path: 'src/a.ts', start: 1, end }])
  assert.deepEqual(look('head --lines=7 src/a.ts').reads, [{ path: 'src/a.ts', start: 1, end: 7 }])
  assert.deepEqual(look('head -n5 src/a.ts').reads, [{ path: 'src/a.ts', start: 1, end: 5 }])
  assert.deepEqual(look('tail -n +30 src/a.ts').reads, [{ path: 'src/a.ts', start: 30, end }])
})

test('tail is a partial read without exact lines, not a whole-file read', () => {
  assert.deepEqual(classify(['tail', '-n', '20', 'a.ts']).reads, [{ path: 'a.ts', start: null, end: null, partial: true, tail: 20 }])
  assert.equal(classify(['tail', 'a.ts']).reads[0].tail, 10)
  const m = run(packet([['src/a.ts', 1, 40]]), shell('tail -n 20 src/a.ts'))
  assert.equal(m.readsAfterPacket, 1)
  assert.deepEqual(m.approximateRereadFiles, ['src/a.ts'])
  const exact = run(packet([['src/a.ts', 1, 40]]), shell('tail -n 20 src/a.ts'), shell('head -5 src/a.ts'))
  assert.deepEqual(exact.approximateRereadFiles, [])
  // a tail of a file the packet never covered is still outside the packets
  assert.equal(run(packet([['src/a.ts', 1, 40]]), shell('tail -n 5 src/b.ts')).readsOutsidePackets, 1)
})

test('cat FILE | head -n N reads only the head', () => {
  assert.equal(run(packet([['src/a.ts', 30, 40]]), shell('cat src/a.ts | head -n 20')).readsAfterPacket, 0)
  assert.equal(run(packet([['src/a.ts', 10, 40]]), shell('cat src/a.ts | head -n 20')).readsAfterPacket, 1)
  assert.deepEqual(look('cat src/a.ts | head -n 20').reads, [{ path: 'src/a.ts', start: 1, end: 20 }])
})

test('nl FILE | sed -n A,Bp reads the downstream range', () => {
  assert.equal(run(packet([['src/a.ts', 1, 4]]), shell("nl src/a.ts | sed -n '5,10p'")).readsAfterPacket, 0)
  assert.equal(run(packet([['src/a.ts', 8, 12]]), shell("nl src/a.ts | sed -n '5,10p'")).readsAfterPacket, 1)
  // a filter between the reader and the window renumbers lines, so the whole read stands
  assert.deepEqual(look('cat -n src/a.ts | grep -v x | head -3').reads, [{ path: 'src/a.ts', start: 1, end: Number.MAX_SAFE_INTEGER }])
})

test('windows compose along a pipeline', () => {
  assert.deepEqual(look('sed -n 10,50p src/a.ts | head -3').reads, [{ path: 'src/a.ts', start: 10, end: 12 }])
  assert.deepEqual(look('cat src/a.ts | cat -n | sed -n 3,4p').reads, [{ path: 'src/a.ts', start: 3, end: 4 }])
  assert.deepEqual(look("sed -n '1,3p;7,8p' src/a.ts | head -n 4").reads, [{ path: 'src/a.ts', start: 1, end: 3 }, { path: 'src/a.ts', start: 7, end: 7 }])
  assert.deepEqual(look('git show HEAD:src/a.ts | sed -n 5,9p').reads, [{ path: 'src/a.ts', start: 5, end: 9 }])
  assert.deepEqual(look('cat src/a.ts | tail -n 5').reads, [{ path: 'src/a.ts', start: null, end: null, partial: true, tail: 5 }])
  assert.equal(look('cat src/a.ts | head -n 20').unclassified, 0)
})

test('a window with no upstream file reads nothing, and an ambiguous one is unclassified', () => {
  assert.deepEqual(look('echo hi | sed -n 1,3p').reads, [])
  assert.deepEqual(look('rg -l foo | head -5').reads, [])
  const several = look('cat a.ts b.ts | head -n 5')
  assert.equal(several.unclassified, 1)
  assert.deepEqual(several.reads.map(r => r.path), ['a.ts', 'b.ts'])
  // the upstream reads stay whole, so the ambiguous window cannot hide a read
  const covered = run(packet([['b.ts', 1, 9]]), shell('cat a.ts b.ts | head -n 5'))
  assert.equal(covered.readsAfterPacket, 1)
  assert.equal(covered.unclassifiedSegments, 1)
  assert.deepEqual(covered.unclassifiedNotTouchingPackets, ['head -n 5'])
})

test('git forms that print file content', () => {
  assert.deepEqual(paths('git show HEAD:src/a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('git cat-file -p HEAD:src/a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('git -c core.pager=cat show HEAD:src/a.ts'), [])
  assert.equal(run(packet([['src/a.ts', 1, 40]]), shell('git show HEAD:src/a.ts')).readsAfterPacket, 1)
  for (const c of ['git log -p -- src/a.ts', 'git show HEAD -- src/a.ts', 'git blame src/a.ts', 'git diff HEAD:a.ts HEAD~1:a.ts', 'git diff --no-index a b',
    'git -C sub show HEAD:a.ts', 'git cat-file --batch', 'git cat-file -p abc123', 'git stash show -p', 'git frobnicate']) {
    assert.equal(look(c).unclassified, 1, c)
  }
  for (const c of ['git status', 'git diff', 'git diff HEAD~1', 'git diff --stat', 'git diff --name-only -- src/a.ts', 'git show HEAD', 'git log --oneline -5',
    'git diff -- src/a.ts', 'git diff src/a.ts', 'git diff HEAD~1 -- src/a.ts', 'git diff --cached', 'git diff --check', 'git diff origin/main...HEAD -- src/a.ts',
    'git cat-file -t HEAD', 'git add -A && git commit -m x', 'git --no-pager status']) {
    assert.deepEqual(summary(c), { reads: [], searches: 0, unclassified: 0 }, c)
  }
  assert.equal(look('git grep foo').searches, 1)
})

test('interpreters that can read any file are unclassified', () => {
  for (const c of ['python3 -c "print(open(1).read())"', "node -e 'x'", 'node script.mjs', 'python script.py', 'python3 -m json.tool a.json',
    'perl -ne print src/a.ts', 'ruby -e x', 'node', 'python3 -']) {
    assert.equal(look(c).unclassified, 1, c)
  }
  for (const c of ['node --version', 'python3 --version', 'perl -v', 'node --test x.test.mjs', 'python3 -m pytest tests -x', 'python -m unittest']) {
    assert.equal(look(c).unclassified, 0, c)
  }
})

test('jq, xargs, find -exec, env wrappers and sort-like filters', () => {
  assert.deepEqual(look('jq . x.json').reads, [{ path: 'x.json', start: 1, end: Number.MAX_SAFE_INTEGER }])
  assert.deepEqual(look('cat x.json | jq .name').reads.map(r => r.path), ['x.json'])
  assert.equal(look('jq -r .name').unclassified, 0)
  assert.equal(look('jq --arg a b .x y.json').unclassified, 1)
  const piped = look('rg -l foo | xargs cat')
  assert.equal(piped.unclassified, 1)
  assert.equal(piped.searches, 1)
  assert.equal(look('find . -name x -exec cat {} +').unclassified, 1)
  assert.equal(look('fd -x cat').unclassified, 1)
  assert.equal(look('rg --pre cat foo').unclassified, 1)
  assert.deepEqual(paths('FOO=1 cat src/a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('env FOO=1 cat src/a.ts'), ['src/a.ts'])
  assert.deepEqual(kinds('env', 'FOO=1', 'env -i cat a.ts', 'sort src/a.ts', 'sort -u', 'diff a b', 'ls | uniq -c'), [0, 0, 1, 1, 0, 1, 0])
})

test('command and process substitution is unclassified, not parsed as a file', () => {
  for (const c of ['cat $(ls)', 'cat `ls`', 'diff <(cat a) <(cat b)', 'echo "$(cat src/a.ts)"', 'echo "`cat src/a.ts`"', 'cat a > >(tee x)',
    'cat $(echo "a b") | head -3', 'FOO=$(cat src/a.ts) true']) {
    const a = look(c)
    assert.ok(a.unclassified >= 1, c)
    assert.deepEqual(a.reads.filter(r => r.path.includes('$') || r.path.includes('(')), [], c)
  }
  assert.equal(look('cat $(ls) && ls').unclassified, 1)
  // single quotes keep the text literal
  assert.deepEqual(summary("rg '$(' src"), { reads: [], searches: 1, unclassified: 0 })
  assert.deepEqual(summary("echo '`x`'"), { reads: [], searches: 0, unclassified: 0 })
})

test('loops, conditionals, groups and unterminated quotes are unclassified', () => {
  for (const c of ['for f in a b; do cat $f; done', 'while read f; do cat "$f"; done < list.txt', 'until false; do cat a.ts; done',
    'if [ -f a.ts ]; then cat a.ts; fi', '{ cat a.ts; }', '(cd src && cat a.ts)', "cat 'a.ts", 'case x in x) cat a.ts;; esac']) {
    assert.ok(look(c).unclassified >= 1, c)
  }
  assert.equal(run(packet([['a.ts', 1, 9]]), shell('for f in a.ts; do cat $f; done')).readsAfterPacket, null)
})

test('heredoc-fed interpreters are unclassified and the body is never parsed as commands', () => {
  const python = summary("python3 - <<'PY'\nprint(open('src/a.ts').read())\nPY")
  assert.deepEqual(python, { reads: [], searches: 0, unclassified: 1 })
  for (const c of ['node <<EOF\nconsole.log(1)\nEOF', 'bash <<EOF\ncat src/a.ts\nEOF', "cat <<EOF | python3\nprint(1)\nEOF", 'python3 <<< "print(1)"', 'perl <<EOF\nprint 1\nEOF']) {
    const a = look(c)
    assert.equal(a.unclassified, 1, c)
    assert.deepEqual(a.reads, [], c)
  }
  assert.equal(run(packet([['src/a.ts', 1, 9]]), shell("python3 - <<'PY'\nprint(open('src/a.ts').read())\nPY")).readsAfterPacket, null)
  assert.equal(run(packet([['src/a.ts', 1, 9]]), shell("python3 - <<'PY'\nprint(1)\nPY")).readsAfterPacket, 0)
})

test('heredocs that feed cat or apply_patch are writes, and later commands still parse', () => {
  assert.deepEqual(summary("cat > notes.txt <<'EOF'\ncat src/a.ts\nrg foo\nsed -n 1,5p src/b.ts\nEOF"), { reads: [], searches: 0, unclassified: 0 })
  assert.deepEqual(summary("apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch\nPATCH"), { reads: [], searches: 0, unclassified: 0 })
  assert.deepEqual(paths("cat > n.txt <<EOF\nx\nEOF\ncat src/b.ts"), ['src/b.ts'])
  assert.deepEqual(paths("cat <<-EOF > n.txt\n\tx\n\tEOF\ncat src/b.ts"), ['src/b.ts'])
  assert.deepEqual(paths("cat <<A; cat <<B\none\nA\ntwo\nB\ncat src/c.ts"), ['src/c.ts'])
  assert.deepEqual(look("/bin/zsh -lc \"cat > f <<'EOF'\nhello\nEOF\ncat src/b.ts\"").reads.map(r => r.path), ['src/b.ts'])
})

test('globs, variables and tildes in file operands are unclassified', () => {
  for (const c of ['cat src/*.ts', 'cat "$F"', 'cat ~/x', 'sed -n 1,5p src/a.{ts,js}', 'head -5 src/?.ts', 'cat src/[ab].ts']) {
    const a = look(c)
    assert.equal(a.unclassified, 1, c)
    assert.deepEqual(a.reads, [], c)
  }
})

test('cd moves the directory that later relative paths resolve against', () => {
  assert.deepEqual(paths('cd src && cat a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('cd /w/src && cat a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('cd /w/src && cd .. && cat src/a.ts'), ['src/a.ts'])
  assert.deepEqual(paths('cat a.ts; cd src; cat a.ts'), ['a.ts', 'src/a.ts'])
  assert.equal(run(packet([['src/a.ts', 1, 9]]), shell('cd src && cat a.ts')).readsAfterPacket, 1)
  for (const c of ['cd $X && cat a.ts', 'cd && cat a.ts', 'cd - && cat a.ts', 'cd ~ && cat a.ts']) assert.equal(look(c).unclassified, 1, c)
})

test('comments, backgrounding, stderr pipes and line continuation', () => {
  assert.deepEqual(paths('cat src/a.ts # then read b.ts'), ['src/a.ts'])
  assert.deepEqual(paths('cat src/a.ts & ls'), ['src/a.ts'])
  assert.deepEqual(paths('ls &>/dev/null; cat src/b.ts'), ['src/b.ts'])
  assert.deepEqual(paths('cat src/a.ts \\\n src/b.ts'), ['src/a.ts', 'src/b.ts'])
  assert.equal(look('rg foo |& head -3').searches, 1)
  assert.deepEqual(scan('cat a |\n head -3').map(s => [s.words[0], s.pipeIn]), [['cat', false], ['head', true]])
})

test('a command item without a usable command is unclassified', () => {
  const m = run(packet([['src/a.ts', 1, 9]]), wrap({ type: 'item.completed', item: { type: 'command_execution', status: 'completed', exit_code: 0 } }))
  assert.equal(m.unclassifiedSegments, 1)
  assert.equal(m.readsAfterPacket, null)
})

// the shapes seen in the recorded 0.166.0 cells
const DIFF_STATUS = "/bin/zsh -lc 'git status --short && git diff -- src/h3.ts src/middleware.ts src/response.ts test/router.test.ts test/middleware.test.ts'"
const DIFF_CHECK = "/bin/zsh -lc 'git diff --check && git diff --stat && git diff -- src/h3.ts src/middleware.ts'"
const ANSWER_CHECK = "/bin/zsh -lc \"node -e 'JSON.parse(require(\\\"node:fs\\\").readFileSync(\\\"answer.json\\\", \\\"utf8\\\")); console.log(\\\"answer.json: valid JSON\\\")'\""
const H3_CHECK = "/bin/zsh -lc \"node --experimental-strip-types --input-type=module -e 'import { H3 } from \\\"./src/h3.ts\\\"; const app = new H3(); console.log(app)'\""
const h3 = packet([['src/h3.ts', 1, 60]])

test('git diff in any form but REV:path is not a read and not unclassified', () => {
  for (const c of [DIFF_STATUS, DIFF_CHECK]) {
    assert.deepEqual(summary(c), { reads: [], searches: 0, unclassified: 0 }, c)
    const m = run(h3, shell(c), shell('cat src/h3.ts'))
    assert.equal(m.unclassifiedSegments, 0)
    assert.equal(m.readsAfterPacket, 1) // only the cat is a re-read
    assert.equal(run(h3, shell(c)).readsAfterPacket, 0)
  }
})

test('a one-liner that does not name a covered file does not invalidate, but is listed', () => {
  const m = run(h3, shell(DIFF_STATUS), shell(ANSWER_CHECK))
  assert.equal(m.unclassifiedSegments, 1)
  assert.equal(m.readsAfterPacketValid, true)
  assert.equal(m.readsAfterPacket, 0)
  assert.deepEqual(m.readsAfterPacketInvalidReasons, [])
  assert.deepEqual(m.unclassifiedTouchingPackets, [])
  assert.equal(m.unclassifiedNotTouchingPackets.length, 1)
  assert.match(m.unclassifiedNotTouchingPackets[0], /^node -e JSON\.parse\(require\("node:fs"\)\.readFileSync\("answer\.json"/)
})

test('a one-liner that names a covered file invalidates, by path, root-absolute path, basename or stem', () => {
  const on = c => run(h3, shell(c))
  const named = [
    "node -e 'JSON.parse(require(\"node:fs\").readFileSync(\"src/h3.ts\", \"utf8\"))'",
    "node -e 'JSON.parse(require(\"node:fs\").readFileSync(\"/w/src/h3.ts\", \"utf8\"))'",
    "node -e 'require(\"node:fs\").readFileSync(\"h3.ts\")'",
    "node -e 'import(\"./src/h3\")'",
    H3_CHECK,
  ]
  for (const c of named) {
    const m = on(c)
    assert.equal(m.readsAfterPacket, null, c)
    assert.equal(m.readsAfterPacketValid, false, c)
    assert.deepEqual(m.readsAfterPacketInvalidReasons, ['unclassified-segments'], c)
    assert.equal(m.unclassifiedTouchingPackets.length, 1, c)
    assert.deepEqual(m.unclassifiedNotTouchingPackets, [], c)
  }
  // the same one-liners are harmless when they name a different file
  const other = run(packet([['src/other.ts', 1, 9]]), shell(H3_CHECK), shell(named[0]))
  assert.equal(other.readsAfterPacketValid, true)
  assert.equal(other.unclassifiedNotTouchingPackets.length, 2)
  // a basename must start a name: data.ts is not a.ts
  assert.equal(run(packet([['src/a.ts', 1, 9]]), shell("node -e 'x(\"data.ts\")'")).readsAfterPacketValid, true)
  assert.equal(run(packet([['src/a.ts', 1, 9]]), shell("node -e 'x(\"./a.ts\")'")).readsAfterPacketValid, false)
})

test('segments that can reach files indirectly invalidate whatever they name', () => {
  const cases = ['rg -l foo | xargs cat', 'find . -name x -exec cat {} +', 'fd -x cat', 'cat $(ls src)', 'cat `ls src`', 'diff <(ls) <(ls src)',
    'for f in a b; do cat x; done', 'if true; then ls; fi', 'custom-tool src/*.ts', 'custom-tool "$F"', 'custom-tool ${F}', 'custom-tool src/{a,b}.ts',
    'custom-tool x?.ts', 'custom-tool [ab].ts', '(custom-tool x)', "custom-tool 'x", "node -e 'for (const f of [1]) f'"]
  for (const c of cases) {
    const m = run(packet([['src/a.ts', 1, 9]]), shell(c))
    assert.equal(m.readsAfterPacketValid, false, c)
    assert.deepEqual(m.readsAfterPacketInvalidReasons, ['unclassified-segments'], c)
  }
  // an unrelated unclassified command is only listed
  const plain = run(packet([['src/a.ts', 1, 9]]), shell('custom-tool --fast x.txt'))
  assert.equal(plain.readsAfterPacketValid, true)
  assert.deepEqual(plain.unclassifiedNotTouchingPackets, ['custom-tool --fast x.txt'])
})

test('heredoc bodies, here-strings and redirect targets count as text', () => {
  const on = c => run(packet([['src/a.ts', 1, 9]]), shell(c))
  assert.equal(on("python3 - <<'PY'\nprint(open('src/a.ts').read())\nPY").readsAfterPacketValid, false)
  assert.equal(on("python3 - <<'PY'\nprint(open('src/b.ts').read())\nPY").readsAfterPacketValid, true)
  assert.equal(on("python3 <<< \"print(open('src/a.ts').read())\"").readsAfterPacketValid, false)
  assert.equal(on('custom-tool > src/a.ts').readsAfterPacketValid, false)
  assert.equal(on("python3 - <<'PY' | head -3\nprint(open('src/a.ts').read())\nPY").readsAfterPacketValid, false)
})

test('the covered set is final: an earlier unclassified segment can name a later-covered file', () => {
  const m = run(shell("node -e 'x(\"src/a.ts\")'"), packet([['src/a.ts', 1, 9]]))
  assert.equal(m.readsAfterPacketValid, false)
  assert.deepEqual(m.readsAfterPacketInvalidReasons, ['unclassified-segments'])
})

test('with no packet-covered files unclassified segments are listed and do not invalidate', () => {
  const m = run(shell(ANSWER_CHECK), shell('custom-tool $F'), shell('cat src/a.ts'))
  assert.equal(m.packets, 0)
  assert.equal(m.unclassifiedSegments, 2)
  assert.equal(m.readsAfterPacket, null)
  assert.equal(m.readsAfterPacketValid, true)
  assert.deepEqual(m.readsAfterPacketInvalidReasons, [])
  assert.equal(m.unclassifiedNotTouchingPackets.length, 2)
  // malformed lines still invalidate
  assert.equal(run(shell(ANSWER_CHECK), 'nope').readsAfterPacketValid, false)
})

test('unclassifiedNotTouchingPackets keeps the first 20, cut to 200 characters; the count stays complete', () => {
  const commands = Array.from({ length: 25 }, (_, i) => shell(`custom-tool-${i} ${'x'.repeat(i === 0 ? 300 : 3)}`))
  const m = run(h3, ...commands)
  assert.equal(m.unclassifiedSegments, 25)
  assert.equal(m.unclassifiedNotTouchingPackets.length, 20)
  assert.equal(m.unclassifiedNotTouchingPackets[0].length, 200)
  assert.equal(m.unclassifiedNotTouchingPackets[19], 'custom-tool-19 xxx')
  assert.equal(m.readsAfterPacketValid, true)
})

test('a command item without a usable command invalidates only when something is covered', () => {
  const bare = wrap({ type: 'item.completed', item: { type: 'command_execution', status: 'completed', exit_code: 0 } })
  assert.equal(run(h3, bare).readsAfterPacketValid, false)
  assert.equal(run(bare).readsAfterPacketValid, true)
})
