#!/usr/bin/env node
// OS2 phase 0: how many merged changes could become impact or code-change tasks? Model-free.
//
// Writes the candidate list to --out for the blind task author and prints counts
// only. The pool can be rebuilt from public history; what stays hidden from the
// tool side is which candidates the blind author picks and their acceptance files.
//
// A candidate is one first-parent change (a squash commit, or a merge diffed
// against its first parent) that:
//   - is not a chore, CI, docs, build, style, release, test-only or dependency change;
//   - changes at least 2 non-test source files and at least 1 test file;
//   - changes 20 to 400 source lines and at most 20 files in all.
// Its own diff gives the dependency set and its tests give the checker.

import { execFileSync } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'

export const CRITERIA = {
  excludeSubject: /^(chore|ci|docs|build|style|release|test|tests)(\([^)]*\))?!?:|\b(bump|renovate|dependabot|deps?)\b|^v?\d+\.\d+\.\d+$/i,
  source: /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|svelte)$/,
  notSource: /(^|\/)(docs|examples?|playground|dist|build|\.github|scripts|bench(marks)?)\/|\.d\.ts$|(^|\/)[^/]*\.config\.[^/]+$/,
  test: /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/,
  minSourceFiles: 2,
  minTestFiles: 1,
  minSourceLines: 20,
  maxSourceLines: 400,
  maxFiles: 20,
}

const SEP = '\u001e'

/** Parse `git log --first-parent -m --numstat --format=<SEP>%H %cs %s` output. */
export function parseLog(text) {
  const changes = []
  for (const block of text.split(SEP).slice(1)) {
    const [header, ...lines] = block.split('\n')
    const m = header.match(/^([0-9a-f]{40}) (\d{4}-\d{2}-\d{2}) (.*)$/)
    if (!m) continue
    const files = []
    for (const line of lines) {
      const f = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (f) files.push({ path: f[3], lines: (f[1] === '-' ? 0 : Number(f[1])) + (f[2] === '-' ? 0 : Number(f[2])) })
    }
    changes.push({ commit: m[1], date: m[2], subject: m[3], files })
  }
  return changes
}

export function classify(change, c = CRITERIA) {
  if (c.excludeSubject.test(change.subject)) return 'subject'
  const tests = change.files.filter(f => c.test.test(f.path))
  const sources = change.files.filter(f => c.source.test(f.path) && !c.test.test(f.path) && !c.notSource.test(f.path))
  const lines = sources.reduce((n, f) => n + f.lines, 0)
  if (change.files.length > c.maxFiles) return 'too-many-files'
  if (sources.length < c.minSourceFiles) return 'too-few-source-files'
  if (tests.length < c.minTestFiles) return 'no-tests'
  if (lines < c.minSourceLines || lines > c.maxSourceLines) return 'source-size'
  return 'eligible'
}

export function summarise(changes) {
  const reasons = {}
  const eligible = []
  for (const ch of changes) {
    const r = classify(ch)
    reasons[r] = (reasons[r] ?? 0) + 1
    if (r === 'eligible') eligible.push({ commit: ch.commit, date: ch.date })
  }
  const byHalfYear = {}
  for (const e of eligible) {
    const key = e.date.slice(0, 4) + (Number(e.date.slice(5, 7)) <= 6 ? 'H1' : 'H2')
    byHalfYear[key] = (byHalfYear[key] ?? 0) + 1
  }
  return { counts: { scanned: changes.length, eligible: eligible.length, reasons, byHalfYear }, eligible }
}

function main(argv) {
  const get = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  const repo = get('--repo'), out = get('--out'), since = get('--since') ?? '2025-01-01'
  if (!repo || !out || !isAbsolute(out) || existsSync(out)) {
    console.error('usage: node history-candidates.mjs --repo <checkout> --out <new absolute file> [--since YYYY-MM-DD]')
    return 2
  }
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const log = execFileSync('git', ['-C', repo, 'log', '--first-parent', '-m', '--numstat', `--since=${since}`, `--format=${SEP}%H %cs %s`],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const { counts, eligible } = summarise(parseLog(log))
  writeFileSync(out, JSON.stringify({ head, since, criteria: Object.fromEntries(Object.entries(CRITERIA).map(([k, v]) => [k, String(v)])), counts, eligible }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify({ head, since, ...counts }))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
