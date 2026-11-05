#!/usr/bin/env node
// OS2 phase 0 transcript metrics. Model-free; reads one recorded executor stream.
//
// Input: a `codex exec --json` stream as the v3 runner writes it, one JSON object
// per line, either the raw event or wrapped as {"event": ...}. Only
// `item.completed` events are used:
//   command_execution: command, aggregated_output, exit_code, status
//   mcp_tool_call:     server, tool, status, error, result.content[].text, result.isError
//   file_change:       counted, but in no error-rate denominator
// Field names were confirmed from the Codex 0.166.0 binary and the v3 runner. They
// are checked against a real 0.166.0 stream by the write probe; nothing earlier.
//
// Every non-blank line must be a JSON event object with a string `type`. Anything
// else is counted in malformedLines and sets integrity to 'malformed'.
//
// Packet coverage comes from repository_packet results on server z1p-repository:
// the 0.26.0 text header `source <path>:<start>-<end>  sha256 <hash>  <N> lines`,
// or the JSON form's packet.sources[].{path,startLine,endLine}.
//
// readsAfterPacket = distinct packet-covered files later read directly with an
// overlapping line range (whole file when the command gives no range), divided by
// distinct packet-covered files. Reads before a file's covering packet do not count.
// Searches (rg, grep, git grep, find) are the plain arm's prescribed behaviour and
// are reported separately, outside the threshold.
//
// The read metric fails closed. It is null, with readsAfterPacketValid false and the
// reasons listed, when any line is malformed, a successful packet yielded no parseable
// ranges, or an unclassified shell segment could address a packet-covered file.
// A segment is unclassified when the parser cannot tell which file it reads: unknown
// commands, command or process substitution, loops and other control words, globs and
// variables in file operands, interpreters, xargs, and git or jq forms with
// unresolvable paths. Against the final covered set of the whole stream, an
// unclassified segment invalidates only if its text (script body and heredoc
// included) names a covered path or its basename, or it can reach files indirectly:
// a glob character, shell variable, brace expansion, command or process substitution,
// a subshell, a control word, xargs, or find/fd/rg running a command. The others are
// still counted and listed in unclassifiedNotTouchingPackets. A script that was
// written earlier and is run by name (`node check.mjs`) is not followed.
//
// `git diff` in any form but REV:path prints the agent's own changes, not file
// contents, so it is not a read. `git show REV:path` and `git cat-file -p REV:path`
// are whole-file reads.
//
// Pipelines: a reader with no file operand narrows what its upstream reader read
// (`nl F | sed -n 5,9p` reads F lines 5-9). `tail` without a known file length is a
// partial read with no exact lines; it counts as overlapping any covered range and
// the file is listed in approximateRereadFiles unless an exact read also overlapped.
//
// Error rates are separate: mcpErrorRate is failed or isError MCP calls over MCP
// calls; shellErrorRate is non-zero exits over command executions (commands that never
// ran are in commandsNotRun, not in the rate). File changes are in neither.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { posix } from 'node:path'

const MAX = Number.MAX_SAFE_INTEGER
const WHOLE = { start: 1, end: MAX }
const FILE_READERS = new Set(['cat', 'nl', 'bat', 'head', 'tail', 'sed', 'awk', 'less', 'more'])
const SEARCHERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'ag', 'find', 'fd'])
// Commands that never print file content. Anything not listed here or handled
// below is unclassified.
const NON_READS = new Set([
  'ls', 'cd', 'pwd', 'echo', 'printf', 'true', 'false', 'test', '[', '[[', 'mkdir', 'touch', 'rm', 'mv', 'cp',
  'npm', 'npx', 'pnpm', 'yarn', 'pytest', 'tsc', 'vitest', 'cargo', 'wc', 'tr',
  'apply_patch', 'export', 'set', 'which', 'date', 'sleep', 'exit', 'basename', 'dirname', 'realpath',
  'readlink', 'stat', 'du', 'df', 'whoami', 'uname', 'id', 'chmod', 'ln', 'mktemp', 'seq', 'tree',
])
// Print their file operands (or only stdin): file operands cannot be told from option values.
const STDIN_FILTERS = new Set(['sort', 'uniq', 'cut', 'diff'])
const CONTROL = new Set(['for', 'while', 'until', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'case', 'esac', 'select', 'function', '{', '}', '!'])
const GIT_QUIET = new Set([
  'status', 'add', 'commit', 'checkout', 'switch', 'branch', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'config',
  'remote', 'fetch', 'pull', 'push', 'reset', 'restore', 'worktree', 'apply', 'am', 'init', 'clone', 'tag', 'merge',
  'rebase', 'cherry-pick', 'revert', 'describe', 'show-ref', 'for-each-ref', 'shortlog', 'clean', 'mv', 'rm', 'bisect',
  'reflog', 'submodule', 'gc', 'symbolic-ref', 'update-ref', 'merge-base', 'name-rev', 'count-objects', 'hash-object',
  'version', 'check-ignore', 'ls-remote', 'notes', 'archive',
])
const GIT_CONTENT = new Set(['show', 'cat-file', 'diff', 'diff-tree', 'diff-index', 'diff-files', 'blame', 'annotate', 'log', 'whatchanged', 'format-patch', 'difftool', 'range-diff'])
const NL_VALUE_FLAGS = new Set(['-b', '-d', '-f', '-h', '-i', '-l', '-n', '-s', '-v', '-w'])
const BAT_VALUE_FLAGS = new Set(['-l', '--language', '--theme', '--style', '--paging', '--color', '--decorations', '-H', '--highlight-line', '--tabs', '--wrap', '--terminal-width', '--file-name', '--map-syntax', '--diff-context'])

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const unclassified = () => ({ kind: 'unclassified', reads: [] })
// unclassified, and able to reach files without naming them
const indirect = () => ({ kind: 'unclassified', reads: [], indirect: true })
const other = () => ({ kind: 'other', reads: [] })

/** Parse a JSONL stream. The array carries a non-enumerable `malformedLines` count:
 * non-JSON lines, non-object values, wrappers whose `event` is not an object, and
 * objects without a string `type`. Blank lines are ignored. */
export function parseEvents(text) {
  const events = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let value
    try { value = JSON.parse(line) } catch { malformed++; continue }
    const event = isObject(value) && Object.hasOwn(value, 'event') ? value.event : value
    if (isObject(event) && typeof event.type === 'string') events.push(event)
    else malformed++
  }
  Object.defineProperty(events, 'malformedLines', { value: malformed })
  return events
}

/** Ranges a packet result returned, as [{path, start, end}]. */
export function packetRanges(item, root) {
  const ranges = []
  for (const content of item?.result?.content ?? []) {
    const text = typeof content?.text === 'string' ? content.text : ''
    try {
      const json = JSON.parse(text)
      const sources = json?.packet?.sources ?? json?.sources
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (typeof s?.path === 'string' && Number.isInteger(s.startLine) && Number.isInteger(s.endLine)) {
            ranges.push({ path: normalise(s.path, root), start: s.startLine, end: s.endLine })
          }
        }
        continue
      }
    } catch { /* text form */ }
    for (const m of text.matchAll(/^source (\S+):(\d+)-(\d+)\s/gm)) {
      ranges.push({ path: normalise(m[1], root), start: Number(m[2]), end: Number(m[3]) })
    }
  }
  return ranges
}

/** Index of the end of a `$(...)`, `<(...)` or `>(...)` starting at i (s[i + 1] is `(`),
 * or of a backtick pair starting at i. Quotes inside are skipped. */
function skipSub(s, i) {
  if (s[i] === '`') {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === '\\') j++
      else if (s[j] === '`') return j
    }
    return s.length - 1
  }
  let depth = 0
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') j++
    else if (c === "'" || c === '"') {
      let k = j + 1
      while (k < s.length && s[k] !== c) k += c === '"' && s[k] === '\\' ? 2 : 1
      j = k
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j
  }
  return s.length - 1
}

/** Position after the bodies of the pending heredocs, which start at pos. */
function skipBodies(s, pos, pending) {
  for (const entry of pending.splice(0)) {
    const start = pos
    while (pos < s.length) {
      let end = s.indexOf('\n', pos)
      if (end < 0) end = s.length
      let line = s.slice(pos, end)
      pos = Math.min(end + 1, s.length)
      if (entry.strip) line = line.replace(/^\t+/, '')
      if (line === entry.delim) break
    }
    entry.body = s.slice(start, pos)
  }
  return pos
}

/** Split a shell command into stages {words, pipeIn, unsafe, dropped, here}. Words honour single and
 * double quotes. && || ; & | and newlines end a stage; pipeIn marks a stage fed by `|`.
 * Output redirect targets (`> out`, `2>&1`) and here-string data are dropped; `< file`
 * keeps the file as a word. Heredoc bodies are skipped, but kept in `here` (and dropped
 * redirect targets and here-string data in `dropped`) so their text can be searched.
 * `unsafe` marks a stage holding command or process substitution, a subshell or an
 * unterminated quote. */
export function scan(command) {
  const stages = [], pending = []
  let words = [], dropped = [], here = [], word = '', quote = null, has = false, dropNext = false, pipeIn = false, unsafe = false
  const endWord = () => {
    if (has) { if (dropNext) { dropNext = false; dropped.push(word) } else words.push(word) }
    word = ''; has = false
  }
  const endStage = piped => {
    endWord(); dropNext = false
    if (words.length || unsafe) { stages.push({ words, pipeIn, unsafe, dropped, here }); pipeIn = piped === true } else if (piped) pipeIn = true
    words = []; dropped = []; here = []; unsafe = false
  }
  const substitute = i => {
    const j = skipSub(command, i)
    word += command.slice(i, j + 1); has = true; unsafe = true
    return j
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i], n = command[i + 1]
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue }
    if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && n !== undefined) { i++; if (n !== '\n') word += n }
      else if (c === '`' || (c === '$' && n === '(')) i = substitute(i)
      else word += c
      continue
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue }
    if (c === '\\') { if (n !== undefined) { i++; if (n !== '\n') { word += n; has = true } } continue }
    if (c === '`' || (c === '$' && n === '(')) { i = substitute(i); continue }
    if (c === '#' && !has) { while (i + 1 < command.length && command[i + 1] !== '\n') i++; continue }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); continue }
    if (c === '\n') { endStage(); if (pending.length) i = skipBodies(command, i + 1, pending) - 1; continue }
    if (c === ';') { endStage(); continue }
    if ((c === '&' || c === '|') && n === c) { endStage(); i++; continue }
    if (c === '|') { if (n === '&') i++; endStage(true); continue }
    if (c === '&') {
      if (n === '>') { endWord(); i++; if (command[i + 1] === '>') i++; dropNext = true } else endStage()
      continue
    }
    if (c === '>') {
      if (n === '(') { i = substitute(i); continue }
      if (/^\d*$/.test(word)) { word = ''; has = false } else endWord()
      if (n === '>') i++
      if (command[i + 1] === '&') { i++; while (/\d|-/.test(command[i + 1] ?? '')) i++; continue }
      if (command[i + 1] === '|') i++
      dropNext = true; continue
    }
    if (c === '<') {
      if (n === '(') { i = substitute(i); continue }
      endWord()
      if (n === '<' && command[i + 2] === '<') { i += 2; dropNext = true; continue } // here-string
      if (n === '<') {
        let j = i + 2
        const strip = command[j] === '-'
        if (strip) j++
        while (command[j] === ' ' || command[j] === '\t') j++
        let delim = '', q = null
        for (; j < command.length; j++) {
          const d = command[j]
          if (q) { if (d === q) q = null; else delim += d } else if (d === "'" || d === '"') q = d
          else if (d === '\\') delim += command[++j] ?? ''
          else if (/[\s;&|<>()]/.test(d)) break
          else delim += d
        }
        const entry = { delim, strip, body: '' }
        pending.push(entry); here.push(entry); i = j - 1
      }
      continue
    }
    if (c === '(' || c === ')') { endWord(); unsafe = true; continue }
    word += c; has = true
  }
  if (quote) unsafe = true
  endStage()
  return stages
}

/** Words of each stage, without the pipeline and safety metadata. */
export function segments(command) {
  return scan(command).map(s => s.words).filter(w => w.length)
}

/** Unwrap `bash -lc '<script>'` and similar into the inner script. */
export function innerScript(command) {
  const shell = /^(ba|z|da|k)?sh$/
  if (Array.isArray(command)) {
    const i = command.findIndex(p => /^-[a-z]*c$/.test(p))
    return shell.test(posix.basename(command[0] ?? '')) && i >= 0 && i + 1 < command.length ? command[i + 1] : command.join(' ')
  }
  const words = segments(command)[0] ?? []
  if (shell.test(posix.basename(words[0] ?? '')) && /^-[a-z]*c$/.test(words[1] ?? '') && words[2]) return words[2]
  return command
}

function normalise(path, root) {
  let p = path
  if (root && p.startsWith(root.endsWith('/') ? root : root + '/')) p = p.slice(root.length + (root.endsWith('/') ? 0 : 1))
  p = posix.normalize(p)
  return p.startsWith('./') ? p.slice(2) : p
}

/** Root-relative path of a file operand, or null when it cannot be known (variable, glob, `~`, unknown cwd). */
function resolve(file, root, cwd) {
  if (cwd === null || /[$*?[\]{}`]|^~/.test(file)) return null
  return normalise(file.startsWith('/') ? file : posix.join(cwd, file), root)
}

/** Classify one stage: {kind: 'read'|'search'|'other'|'unclassified', reads: [{path,start,end}], window?}.
 * `window` (a reader with no file operand) is the range list it applies to stdin.
 * An unclassified result may carry `indirect: true`.
 * ctx: {cwd: root-relative directory, null if unknown; unsafe: stage has substitution or a subshell}. */
export function classify(words, root, ctx = {}) {
  if (ctx.unsafe) return indirect()
  if (!words.length) return unclassified()
  const cwd = ctx.cwd === undefined ? '' : ctx.cwd
  let ws = words
  const skipAssignments = () => { while (ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0])) ws = ws.slice(1) }
  skipAssignments()
  if (ws.length && posix.basename(ws[0]) === 'env') {
    ws = ws.slice(1); skipAssignments()
    if (ws[0]?.startsWith('-')) return unclassified()
  }
  if (!ws.length) return other()
  const name = posix.basename(ws[0]), args = ws.slice(1)
  if (CONTROL.has(ws[0])) return indirect()
  if (name === 'xargs') return indirect()
  if (FILE_READERS.has(name)) return classifyReader(name, args, root, cwd)
  if (SEARCHERS.has(name)) return classifySearch(name, args)
  if (name === 'git') return classifyGit(args, root, cwd)
  if (name === 'node' || name === 'perl' || name === 'ruby' || /^python[\d.]*$/.test(name)) return classifyInterpreter(name, args)
  if (name === 'jq') return classifyJq(args, root, cwd)
  if (STDIN_FILTERS.has(name)) return args.some(a => !a.startsWith('-')) ? unclassified() : other()
  return NON_READS.has(name) ? other() : unclassified()
}

function classifyReader(name, args, root, cwd) {
  const p = name === 'sed' ? parseSed(args) : name === 'awk' ? parseAwk(args) : name === 'head' || name === 'tail' ? parseHeadTail(name, args) : parseCat(name, args)
  if (p.inPlace) return other()
  const reads = []
  for (const f of p.files) {
    const path = resolve(f, root, cwd)
    if (path === null) return unclassified()
    for (const r of p.ranges) reads.push({ path, ...r })
  }
  return p.files.length ? { kind: 'read', reads } : { kind: 'read', reads, window: p.ranges }
}

/** cat, nl, bat, less, more: whole files; bat -r gives a line range. */
function parseCat(name, args) {
  const files = [], ranges = []
  const valued = name === 'nl' ? NL_VALUE_FLAGS : name === 'bat' ? BAT_VALUE_FLAGS : null
  let literal = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!literal && a === '--') { literal = true; continue }
    if (!literal && name === 'bat' && (a === '-r' || a === '--line-range' || /^(-r|--line-range=)./.test(a))) {
      const spec = a === '-r' || a === '--line-range' ? args[++i] ?? '' : a.replace(/^(-r|--line-range=)/, '')
      const m = spec.match(/^(\d*):(\d*)$/) ?? spec.match(/^(\d+)()$/)
      ranges.push(m && (m[1] || m[2]) ? { start: Number(m[1] || 1), end: m[2] ? Number(m[2]) : m[0].includes(':') ? MAX : Number(m[1]) } : WHOLE)
      continue
    }
    if (!literal && valued?.has(a)) { i++; continue }
    if (!literal && (a.startsWith('-') || (a.startsWith('+') && (name === 'less' || name === 'more')))) continue
    files.push(a)
  }
  return { files: files.filter(f => f !== '-'), ranges: ranges.length ? ranges : [WHOLE] }
}

/** Option parsing shared by head and tail: -n N, -nN, -N, --lines=N, -c N, --bytes=N. */
function parseHeadTail(name, args) {
  let count = null
  const files = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    let m
    if (a === '-n' || a === '--lines' || a === '-c' || a === '--bytes') count = args[++i] ?? null
    else if ((m = a.match(/^(?:-n|--lines=|-c|--bytes=)(.+)$/))) count = m[1]
    else if (/^-\d+$/.test(a)) count = a.slice(1)
    else if (a.startsWith('-')) continue
    else files.push(a)
  }
  const m = typeof count === 'string' ? count.match(/^([+-]?)(\d+)$/) : null
  let range
  if (name === 'head') {
    // -c N keeps the first N bytes, at most N lines
    if (count === null) range = { start: 1, end: 10 }
    else range = m && m[1] !== '-' ? { start: 1, end: Number(m[2]) } : WHOLE // -n -K (all but the last K) or unreadable
  } else if (m && m[1] === '+') range = { start: Math.max(1, Number(m[2])), end: MAX }
  else range = { start: null, end: null, partial: true, tail: count === null ? 10 : m ? Number(m[2]) : null } // file length unknown
  return { files: files.filter(f => f !== '-'), ranges: [range] }
}

function parseSed(args) {
  const scripts = [], positional = []
  let quiet = false, inPlace = false, scriptFile = false, literal = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (literal || !a.startsWith('-') || a === '-') { positional.push(a); continue }
    if (a === '--') { literal = true; continue }
    if (a.startsWith('--')) {
      if (a === '--quiet' || a === '--silent') quiet = true
      else if (a.startsWith('--in-place')) inPlace = true
      else if (a === '--expression') scripts.push(args[++i] ?? '')
      else if (a.startsWith('--expression=')) scripts.push(a.slice(13))
      else if (a === '--file') { scriptFile = true; i++ } else if (a.startsWith('--file=')) scriptFile = true
      continue
    }
    for (let k = 1; k < a.length; k++) { // short cluster: -n, -ne, -i.bak
      const f = a[k]
      if (f === 'n') quiet = true
      else if (f === 'i') { inPlace = true; break }
      else if (f === 'e') { scripts.push(a.slice(k + 1) || (args[++i] ?? '')); break }
      else if (f === 'f') { scriptFile = true; if (k + 1 === a.length) i++; break }
    }
  }
  if (!scripts.length && !scriptFile && positional.length) scripts.push(positional.shift())
  let ranges = [WHOLE]
  if (quiet && !scriptFile) { // without -n sed prints every line
    const parsed = scripts.map(parseSedRanges)
    if (parsed.length && parsed.every(Boolean)) ranges = parsed.flat()
  }
  return { files: positional.filter(f => f !== '-'), ranges, inPlace }
}

function parseSedRanges(script) {
  const out = []
  for (const part of script.split(/[;\n]/).map(s => s.trim()).filter(Boolean)) {
    if (/^\d+q$/.test(part)) continue
    const m = part.match(/^(\d+)(?:,(\d+|\$))?p$/)
    if (!m) return null
    out.push({ start: Number(m[1]), end: m[2] === undefined ? Number(m[1]) : m[2] === '$' ? MAX : Number(m[2]) })
  }
  return out.length ? out : null
}

function parseAwk(args) {
  let program = null, programFile = false
  const files = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-F' || a === '-v') i++
    else if (a === '-f') { programFile = true; i++ }
    else if (a.startsWith('-') && a !== '-') continue
    else if (program === null && !programFile) program = a
    else files.push(a)
  }
  const m = program?.match(/NR\s*>=?\s*(\d+)\s*&&\s*NR\s*<=?\s*(\d+)/)
  const eq = program?.match(/^\s*NR\s*==\s*(\d+)\s*$/)
  const range = m ? { start: Number(m[1]), end: Number(m[2]) } : eq ? { start: Number(eq[1]), end: Number(eq[1]) } : WHOLE
  return { files: files.filter(f => f !== '-'), ranges: [range] }
}

function classifySearch(name, args) {
  // -exec and friends run an arbitrary command; rg --pre runs one per file
  if ((name === 'find' && args.some(a => /^-(exec|execdir|ok|okdir)$/.test(a))) ||
      (name === 'fd' && args.some(a => /^(-x|-X|--exec|--exec-batch)$/.test(a))) ||
      args.some(a => a === '--pre' || a.startsWith('--pre='))) return indirect()
  return { kind: 'search', reads: [] }
}

function classifyInterpreter(name, args) {
  if (args.length && args.every(a => /^(-v|-V|--version|-h|--help)$/.test(a))) return other()
  // test runs are not reads, like npm test or pytest
  if (name === 'node' && args.includes('--test')) return other()
  if (name.startsWith('python') && args[0] === '-m' && /^(pytest|unittest)$/.test(args[1] ?? '')) return other()
  return unclassified() // -e, -c, scripts, stdin: any file could be read
}

function classifyJq(args, root, cwd) {
  if (args.some(a => /^(-f|--from-file|--arg|--argjson|--slurpfile|--rawfile|--args|--jsonargs|--indent|-L)$/.test(a))) return unclassified()
  const operands = args.filter(a => !a.startsWith('-') || a === '-')
  const reads = []
  for (const f of operands.slice(1).filter(f => f !== '-')) { // the first operand is the filter
    const path = resolve(f, root, cwd)
    if (path === null) return unclassified()
    reads.push({ path, ...WHOLE })
  }
  return reads.length ? { kind: 'read', reads } : other()
}

function classifyGit(args, root, cwd) {
  let i = 0
  for (; i < args.length && args[i].startsWith('-'); i++) {
    if (/^(-[Cc]|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)/.test(args[i])) return unclassified()
  }
  const sub = args[i], rest = args.slice(i + 1)
  if (sub === undefined) return other()
  if (sub === 'grep') return { kind: 'search', reads: [] }
  if (sub === 'stash') return rest[0] === 'show' && rest.some(a => /^(-p|--patch|-u|--include-untracked)$/.test(a)) ? unclassified() : other()
  if (GIT_CONTENT.has(sub)) return classifyGitContent(sub, rest, root)
  return GIT_QUIET.has(sub) ? other() : unclassified()
}

// An operand that could be a path rather than a revision
const pathLike = o => /[/.]/.test(o) && !/\.\.|[~^]|@\{/.test(o)

function classifyGitContent(sub, rest, root) {
  const dd = rest.indexOf('--')
  const before = dd < 0 ? rest : rest.slice(0, dd)
  const flags = before.filter(a => a.startsWith('-')), operands = before.filter(a => !a.startsWith('-'))
  const blobs = os => {
    const reads = []
    for (const o of os) {
      const file = o.slice(o.indexOf(':') + 1)
      if (!file) continue // `REV:` lists a tree
      const path = resolve(file, root, '')
      if (path === null) return unclassified()
      reads.push({ path, ...WHOLE })
    }
    return reads.length ? { kind: 'read', reads } : other()
  }
  if (sub === 'cat-file') { // `-p REV:path` prints one whole file
    if (flags.some(f => /^-[tse]$/.test(f))) return other() // type, size or existence only
    return flags.some(f => f.startsWith('--batch')) || !operands.length || !operands.every(o => o.includes(':')) ? unclassified() : blobs(operands)
  }
  // plain `git diff` prints the agent's own changes; REV:path operands or --no-index name other files
  if (sub === 'diff') return flags.includes('--no-index') || operands.some(o => o.includes(':')) ? unclassified() : other()
  if (flags.some(f => /^(--(stat|name-only|name-status|numstat|shortstat|summary|check|no-patch|quiet|raw)|-s)$/.test(f))) return other() // names or counts only
  if (sub === 'log' && !flags.some(f => /^(-p|-u|--patch|-c|--cc|--full-diff|-L)/.test(f))) return other()
  if (sub === 'blame' || sub === 'annotate' || (dd >= 0 && rest.length > dd + 1)) return unclassified()
  if (sub === 'show' && operands.some(o => o.includes(':'))) return blobs(operands.filter(o => o.includes(':')))
  return operands.some(pathLike) ? unclassified() : other() // a revision or ref alone shows a commit
}

/** Apply a reader's window to what its upstream emitted: [{path,start,end}] in stream
 * order. Null when the result cannot be told (several files, unknown lengths). */
function applyWindow(flow, windows) {
  const unknownLength = r => r.start == null || r.end >= MAX / 2
  if (flow.slice(0, -1).some(unknownLength)) return null
  const out = []
  for (const w of windows) {
    if (w.partial) { // tail of an upstream of unknown length
      for (const r of flow) out.push({ path: r.path, start: null, end: null, partial: true, tail: w.tail })
      continue
    }
    let offset = 0
    for (const r of flow) {
      if (r.start == null) { out.push(r); continue }
      const length = r.end - r.start + 1
      const a = Math.max(w.start, offset + 1), b = Math.min(w.end, offset + length)
      if (a <= b) out.push({ path: r.path, start: r.start + a - offset - 1, end: r.start + b - offset - 1 })
      offset += length
    }
  }
  return out
}

// Text that can reach files without naming them: glob, variable, brace expansion
const REACHES = /[*?[]|\$[A-Za-z_{0-9@*#?!]|\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

/** Analyse one command: its file reads (pipelines resolved), searches and unclassified
 * stages. `segments` lists each unclassified stage as {text, indirect}; the text is
 * its words, dropped redirect targets and heredoc bodies. */
export function analyse(command, root) {
  const stages = [], segments = []
  let cwd = ''
  for (const [i, st] of scan(innerScript(command)).entries()) {
    const c = classify(st.words, root, { cwd, unsafe: st.unsafe })
    const stage = { kind: c.kind, reads: c.reads, flow: c.reads.length ? c.reads : null, owner: i }
    const up = st.pipeIn ? stages[i - 1] : null
    let ambiguous = false
    if (c.window && up?.flow) {
      const narrowed = applyWindow(up.flow, c.window)
      if (narrowed) { stages[up.owner].reads = narrowed; Object.assign(stage, { flow: narrowed, owner: up.owner }) } else { stage.kind = 'unclassified'; ambiguous = true }
    }
    if (stage.kind === 'unclassified') {
      // an ambiguous window keeps the upstream reads whole, so it cannot hide a read
      const text = [st.words.join(' '), ...st.dropped, ...st.here.map(h => h.body)].join(' ')
      segments.push({ text, indirect: !ambiguous && (c.indirect === true || REACHES.test(text)) })
    }
    if (!st.pipeIn && st.words[0] === 'cd') { // later relative paths resolve against the new directory
      const target = st.words[1]
      cwd = st.unsafe || st.words.length !== 2 || cwd === null || /[$*?[\]{}`]|^~|^-$/.test(target) ? null
        : target.startsWith('/') ? normalise(target, root) : posix.join(cwd, target)
    }
    stages.push(stage)
  }
  return { reads: stages.flatMap(s => s.reads), searches: stages.filter(s => s.kind === 'search').length, unclassified: segments.length, segments }
}

/** Does the text name a covered path, its extension-less form, or its basename? */
function names(text, paths) {
  for (const p of paths) {
    const stem = p.replace(/\.[^./]+$/, '')
    if (text.includes(stem.includes('/') ? stem : p)) return true
    const base = posix.basename(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp('(^|[^\\w.-])' + base).test(text)) return true
  }
  return false
}

// A read with no known line extent (tail of an unknown-length file) may overlap anything.
const overlaps = (a, b) => a.start == null || b.start == null || (a.start <= b.end && b.start <= a.end)

export function measure(events, { root, malformedLines } = {}) {
  const malformed = malformedLines ?? events.malformedLines ?? 0
  const covered = new Map() // path -> ranges returned so far
  const exact = new Set(), approximate = new Set()
  let toolResults = 0, packets = 0, packetsWithoutRanges = 0, fileChanges = 0, fileChangeErrors = 0
  let mcpCalls = 0, mcpErrors = 0, commands = 0, commandsNotRun = 0, nonZeroExits = 0, shellErrors = 0
  let searchesAfterPacket = 0, readsBeforePacket = 0, unclassified = 0
  const unclassifiedStages = []
  for (const event of events) {
    if (event?.type !== 'item.completed') continue
    const item = isObject(event.item) ? event.item : {}
    if (!['command_execution', 'mcp_tool_call', 'file_change'].includes(item.type)) continue
    toolResults++
    if (item.type === 'mcp_tool_call') {
      mcpCalls++
      const failed = item.status !== 'completed' || item.error || item.result?.isError
      if (failed) mcpErrors++
      if (item.server === 'z1p-repository' && item.tool === 'repository_packet' && !failed) {
        packets++
        const ranges = packetRanges(item, root)
        if (!ranges.length) packetsWithoutRanges++
        for (const r of ranges) {
          if (!covered.has(r.path)) covered.set(r.path, [])
          covered.get(r.path).push(r)
        }
      }
      continue
    }
    if (item.type === 'file_change') { fileChanges++; if (item.status && item.status !== 'completed') fileChangeErrors++; continue }
    commands++
    const notRun = (item.status && item.status !== 'completed' && item.status !== 'failed') || (item.status === 'failed' && item.exit_code == null)
    const nonZero = Number.isInteger(item.exit_code) && item.exit_code !== 0
    if (notRun) commandsNotRun++
    if (nonZero) nonZeroExits++
    if (nonZero) shellErrors++
    if (typeof item.command !== 'string' && !Array.isArray(item.command)) {
      unclassified++; unclassifiedStages.push({ text: '(no command)', indirect: true }); continue
    }
    const a = analyse(item.command, root)
    unclassified += a.unclassified
    unclassifiedStages.push(...a.segments)
    if (packets > 0) searchesAfterPacket += a.searches
    for (const r of a.reads) {
      const prior = covered.get(r.path)
      if (!prior) readsBeforePacket++
      else if (prior.some(p => overlaps(p, r))) (r.start == null ? approximate : exact).add(r.path)
    }
  }
  // against the final covered set: only a stage that could address a covered file invalidates
  const touching = [], elsewhere = []
  const covers = [...covered.keys()]
  for (const s of unclassifiedStages) (covers.length && (s.indirect || names(s.text, covers)) ? touching : elsewhere).push(s.text)
  const listed = texts => texts.slice(0, 20).map(t => t.slice(0, 200))
  const reasons = []
  if (touching.length) reasons.push('unclassified-segments')
  if (packetsWithoutRanges) reasons.push('packet-without-ranges')
  if (malformed) reasons.push('malformed-lines')
  const reread = new Set([...exact, ...approximate])
  return {
    packets,
    packetCoveredFiles: covered.size,
    packetsWithoutRanges,
    rereadFiles: [...reread].sort(),
    approximateRereadFiles: [...approximate].filter(f => !exact.has(f)).sort(),
    readsAfterPacket: !reasons.length && covered.size ? reread.size / covered.size : null,
    readsAfterPacketValid: !reasons.length,
    readsAfterPacketInvalidReasons: reasons,
    searchesAfterPacket,
    readsOutsidePackets: readsBeforePacket,
    commands,
    unclassifiedSegments: unclassified,
    unclassifiedTouchingPackets: listed(touching),
    unclassifiedNotTouchingPackets: listed(elsewhere),
    malformedLines: malformed,
    integrity: malformed ? 'malformed' : 'ok',
    toolResults,
    mcpCalls,
    mcpErrors,
    mcpErrorRate: mcpCalls ? mcpErrors / mcpCalls : null,
    shellErrors,
    shellErrorRate: commands ? shellErrors / commands : null,
    nonZeroExits,
    commandsNotRun,
    fileChanges,
    fileChangeErrors,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2)
  if (!file) { console.error('usage: node metrics.mjs <events.jsonl> [--root <workspace>]'); process.exit(2) }
  const i = rest.indexOf('--root')
  const root = i >= 0 ? rest[i + 1] : undefined
  console.log(JSON.stringify(measure(parseEvents(readFileSync(file, 'utf8')), { root }), null, 2))
}
