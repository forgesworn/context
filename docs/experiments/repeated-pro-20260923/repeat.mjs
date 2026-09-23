#!/usr/bin/env node
// Runs every repetition of the protocol through graphify-20260922/run.mjs, one task and arm order at a time.
// Arm order rotates per repetition; cells with a finished receipt.json are skipped, so a rerun resumes.
// Stops at the first failed run.mjs or a receipt whose executor or reviewer did not finish successfully.
// Usage: node repeat.mjs --local /private/local.json   (local.evidence is the parent; repetitions go in rep1..repN)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const protocol = JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'))
const flag = process.argv.indexOf('--local')
if (flag < 0) throw new Error('usage: repeat.mjs --local /private/local.json')
const local = JSON.parse(readFileSync(resolve(process.argv[flag + 1]), 'utf8'))
// Hitting the turn cap is an outcome of the cell, not a failure of the run.
const failed = (run) => run && !['success', 'error_max_turns'].includes(run.subtype)

for (let rep = 1; rep <= protocol.repetitions; rep += 1) {
  const evidence = join(local.evidence, `rep${rep}`)
  mkdirSync(evidence, { recursive: true })
  const repLocal = join(evidence, 'local.json')
  writeFileSync(repLocal, JSON.stringify({ ...local, evidence }, null, 2))
  protocol.tasks.forEach((task, i) => {
    const order = protocol.armOrders[(i + rep - 1) % protocol.armOrders.length]
    for (const [position, arm] of order.entries()) {
      const receipt = join(evidence, task, arm, 'receipt.json')
      if (!existsSync(receipt)) {
        const r = spawnSync(process.execPath, [join(here, '../graphify-20260922/run.mjs'), '--local', repLocal, '--protocol', here, '--task', task, '--arms', arm, '--order-index', String(position + 1)], { stdio: 'inherit' })
        if (r.status !== 0) { console.log(`STOPPED rep${rep} ${task}/${arm}: run.mjs exited ${r.status}`); process.exit(1) }
      }
      const done = JSON.parse(readFileSync(receipt, 'utf8'))
      if (failed(done.executorRun) || failed(done.reviewerRun)) { console.log(`STOPPED rep${rep} ${task}/${arm}: executor or reviewer did not finish successfully`); process.exit(1) }
      console.log(`CELL rep${rep} ${task}/${arm} accepted=${done.accepted}`)
    }
  })
}
console.log('REPEATS-DONE')
