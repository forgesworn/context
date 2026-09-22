#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const args = Object.fromEntries(process.argv.slice(2).reduce((out, x, i, all) => i % 2 ? out : [...out, [x.replace(/^--/, ''), all[i + 1]]], []))
if (!args.output || !args['source-root'] || !['baseline', 'assisted'].includes(args.arm)) throw new Error('usage: --source-root PATH --output NEW_PATH --arm baseline|assisted')
const task = json(join(here, 'task.json'))
const inherited = json(join(here, '../d5-20260921/tasks/orientation-context.json'))
for (const key of ['id', 'repository', 'revision', 'selectionPolicy', 'setupPatch', 'setupPatchSha256']) assert.deepEqual(task[key], inherited[key], `inherited ${key}`)
const output = resolve(args.output)
const emptyGitDirectory = mkdtempSync(join(tmpdir(), 'd5-git-empty-'))
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TEMPLATE_DIR: emptyGitDirectory, GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: emptyGitDirectory, GIT_CONFIG_KEY_1: 'commit.gpgSign', GIT_CONFIG_VALUE_1: 'false' }
try {
  const result = execFileSync(process.execPath, [join(here, '../d5-20260921/prepare-arm.mjs'), '--pair', 'orientation-context', '--arm', args.arm, '--source-root', args['source-root'], '--output', output], { encoding: 'utf8', env })
  assert.equal(json(join(output, '.d5-prepared.json')).sourceRevision, task.revision)
  assert.deepEqual(json(join(output, '.z1p-navigation.json')), { version: 1, ...task.selectionPolicy })
  writeFileSync(join(output, '.d5-task.json'), readFileSync(join(here, 'task.json')))
  copyFileSync(join(here, 'public-check.mjs'), join(output, '.d5-public-check.mjs'))
  execFileSync('git', ['add', '-f', '.d5-task.json', '.d5-public-check.mjs'], { cwd: output, env })
  execFileSync('git', ['-c', 'user.name=D5 Protocol', '-c', 'user.email=d5@invalid', 'commit', '--no-verify', '--amend', '--no-edit', '-q'], { cwd: output, env: { ...env, GIT_AUTHOR_DATE: '2026-09-21T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-21T00:00:00Z' } })
  const preparedTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: output, encoding: 'utf8', env }).trim()
  process.stdout.write(JSON.stringify({ ...JSON.parse(result), preparedTree, qualification: 'd5-orientation-context-20260921-v3' }) + '\n')
} finally { rmSync(emptyGitDirectory, { recursive: true, force: true }) }
