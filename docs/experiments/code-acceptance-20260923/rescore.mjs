#!/usr/bin/env node
// Re-score recorded code-change cells with checker plus scope check instead of the model reviewer.
// No model calls. Usage: node rescore.mjs NAME=DIR [...]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkScope } from './scope.mjs'

const packDir = resolve(dirname(fileURLToPath(import.meta.url)), '../d5-20260921')
const runs = process.argv.slice(2).map((arg) => arg.split('='))
if (!runs.length) throw new Error('usage: rescore.mjs NAME=DIR [...]')
const cells = []
for (const [run, dir] of runs) {
  for (const taskId of readdirSync(dir).sort()) {
    const taskPath = join(packDir, 'tasks', `${taskId}.json`)
    if (!existsSync(taskPath)) continue
    const task = JSON.parse(readFileSync(taskPath, 'utf8'))
    if (task.answerSchema) continue
    for (const arm of ['plain', 'graphify', 'context']) {
      const armDir = join(dir, taskId, arm)
      if (!existsSync(join(armDir, 'receipt.json'))) continue
      const receipt = JSON.parse(readFileSync(join(armDir, 'receipt.json'), 'utf8'))
      const scope = checkScope({ workspace: join(armDir, 'workspace'), include: task.selectionPolicy.include })
      const checker = Boolean(receipt.checker?.passed)
      cells.push({ run, task: taskId, arm, checker, scope: scope.passed, scopeReasons: scope.reasons, recordedAccepted: Boolean(receipt.accepted), accepted: checker && scope.passed,
        reviewerSeconds: receipt.reviewerRun?.seconds ?? null, reviewerCostUsd: receipt.reviewerRun?.totalCostUsd ?? null })
    }
  }
}
const changed = cells.filter((c) => c.accepted !== c.recordedAccepted)
const byRun = {}
for (const c of cells) {
  const r = (byRun[`${c.run}|${c.arm}`] ??= { run: c.run, arm: c.arm, tasks: 0, recordedAccepted: 0, accepted: 0 })
  r.tasks += 1; r.recordedAccepted += Number(c.recordedAccepted); r.accepted += Number(c.accepted)
}
const sum = (k) => Number(cells.reduce((s, c) => s + (c[k] ?? 0), 0).toFixed(2))
process.stdout.write(`${JSON.stringify({ cells: cells.length, changed, byRunAndArm: Object.values(byRun), reviewerAvoided: { seconds: sum('reviewerSeconds'), costUsd: sum('reviewerCostUsd') }, all: cells }, null, 1)}\n`)
