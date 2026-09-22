#!/usr/bin/env node
// Write acceptance/*.json (version 2) from rubrics.mjs and the locked version 1 files, and check that
// everything except the rubric text is unchanged. Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewerRules, rubrics } from './rubrics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pack = resolve(here, '../d5-20260921')
for (const [id, rubric] of Object.entries(rubrics)) {
  const v1 = JSON.parse(readFileSync(join(pack, 'acceptance', `${id}.json`), 'utf8'))
  const task = JSON.parse(readFileSync(join(pack, 'tasks', `${id}.json`), 'utf8'))
  const ids = Object.keys(rubric)
  if (v1.kind !== 'structured') throw new Error(`${id}: not a structured task`)
  if (JSON.stringify(ids) !== JSON.stringify(task.requiredFindingIds) || JSON.stringify(ids) !== JSON.stringify(Object.keys(v1.reviewerRubric))) throw new Error(`${id}: dimension ids differ from version 1`)
  for (const [dim, text] of Object.entries(rubric)) if (!text.startsWith('Required')) throw new Error(`${id}/${dim}: rubric text must start with its required points`)
  const v2 = { ...v1, version: 2, basedOn: `d5-20260921/acceptance/${id}.json`, reviewerRules, reviewerRubric: rubric }
  writeFileSync(join(here, 'acceptance', `${id}.json`), `${JSON.stringify(v2, null, 2)}\n`)
}
process.stdout.write(`wrote ${Object.keys(rubrics).length} acceptance files\n`)
