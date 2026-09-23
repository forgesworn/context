#!/usr/bin/env node
// Runs the Context arm alone for every repetition, without structured review.
// Resumes by skipping cells with receipt.json; stops at the first failed run.
// Usage: node screen.mjs --local /private/local.json   (local.evidence is the parent; repetitions go in rep1..repN)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const protocol = JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'))
const flag = process.argv.indexOf('--local')
if (flag < 0) throw new Error('usage: screen.mjs --local /private/local.json')
const local = JSON.parse(readFileSync(resolve(process.argv[flag + 1]), 'utf8'))
const failed = (run) => run && !['success', 'error_max_turns'].includes(run.subtype)

for (let rep = 1; rep <= protocol.repetitions; rep += 1) {
  const evidence = join(local.evidence, `rep${rep}`)
  mkdirSync(evidence, { recursive: true })
  const repLocal = join(evidence, 'local.json')
  writeFileSync(repLocal, JSON.stringify({ ...local, evidence }, null, 2))
  protocol.tasks.forEach((task, i) => {
    const position = protocol.armOrders[(i + rep - 1) % protocol.armOrders.length].indexOf('context') + 1
    const receipt = join(evidence, task, 'context', 'receipt.json')
    if (!existsSync(receipt)) {
      const r = spawnSync(process.execPath, [join(here, '../graphify-20260922/run.mjs'), '--local', repLocal, '--protocol', here, '--task', task, '--arms', 'context', '--order-index', String(position), '--skip-review'], { stdio: 'inherit' })
      if (r.status !== 0) { console.log(`STOPPED rep${rep} ${task}: run.mjs exited ${r.status}`); process.exit(1) }
    }
    const done = JSON.parse(readFileSync(receipt, 'utf8'))
    if (failed(done.executorRun)) { console.log(`STOPPED rep${rep} ${task}: executor did not finish successfully`); process.exit(1) }
    console.log(`CELL rep${rep} ${task}/context input=${done.executorRun.inputTotal} turns=${done.executorRun.numTurns}`)
  })
}
console.log('SCREEN-DONE')
