#!/usr/bin/env node
// Re-score recorded runs by reviewer dimension instead of whole-task verdict.
// No model calls: reads each receipt's recorded reviewer dimensions.
// Usage: node rescore.mjs NAME=DIR [NAME=DIR ...]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const runs = process.argv.slice(2).map((arg) => arg.split('='))
if (!runs.length) throw new Error('usage: rescore.mjs NAME=DIR [...]')
const arms = ['plain', 'graphify', 'context']
const cells = new Map()
for (const [name, dir] of runs) {
  for (const task of readdirSync(dir)) {
    for (const arm of arms) {
      const path = join(dir, task, arm, 'receipt.json')
      if (!existsSync(path)) continue
      const receipt = JSON.parse(readFileSync(path, 'utf8'))
      const dims = receipt.reviewerRun?.verdict?.dimensions ?? []
      cells.set(`${name}|${task}|${arm}`, { passed: dims.filter((d) => d.pass).length, total: dims.length, accepted: Boolean(receipt.accepted) })
    }
  }
}
const rows = []
for (const [name] of runs) {
  for (const arm of arms) {
    const own = [...cells].filter(([key]) => key.startsWith(`${name}|`) && key.endsWith(`|${arm}`)).map(([, cell]) => cell)
    if (!own.length) continue
    const passed = own.reduce((sum, cell) => sum + cell.passed, 0)
    const total = own.reduce((sum, cell) => sum + cell.total, 0)
    rows.push({ run: name, arm, tasks: own.length, accepted: own.filter((cell) => cell.accepted).length, dimensionsPassed: passed, dimensions: total, rate: Number((passed / total).toFixed(2)) })
  }
}
process.stdout.write(`${JSON.stringify({ byRunAndArm: rows, cells: Object.fromEntries(cells) }, null, 1)}\n`)
