#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkStructuredAnswer } from './accept.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repositories = {
  context: { revision: '496bfca9ef1b6a0d5befe0e4dca3ff7b7258a13c', archiveSha256: '6e93afe49b6124f65f11afc848bf9c79c0e1eebd83457af27547c19de13657f3' },
  kithmoot: { revision: '35fbdbed3d70a574499e84ba6b08817222110df3', archiveSha256: '3c0f1dd0637c6f0a53a187e05808ff407dec72d60acf92b70aa8bafe7377a24d' },
}
const pairs = ['orientation-context', 'orientation-kithmoot', 'diagnosis-context', 'diagnosis-kithmoot', 'impact-context', 'impact-kithmoot', 'code-change-context', 'code-change-kithmoot']
const categories = ['orientation', 'diagnosis', 'impact', 'code-change']
const sha = value => createHash('sha256').update(value).digest('hex')
const fail = message => { throw new Error(message) }
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const fileSha = path => sha(readFileSync(path))
const archiveSha = (root, revision) => sha(execFileSync('git', ['archive', '--format=tar', revision], { cwd: root, maxBuffer: 256 * 1024 * 1024 }))
function args() {
  const out = {}
  for (let index = 2; index < process.argv.length; index += 2) out[process.argv[index].replace(/^--/, '')] = process.argv[index + 1]
  return out
}
function equal(actual, expected, label) { if (actual !== expected) fail(`${label} mismatch`) }
function requiredString(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`) }
function checkTask(task, id) {
  equal(task.version, 1, `${id} task version`); equal(task.id, id, `${id} task id`)
  if (!categories.includes(task.category) || !repositories[task.repository]) fail(`${id} has an invalid category or repository`)
  equal(task.revision, repositories[task.repository].revision, `${id} task revision`)
  requiredString(task.prompt, `${id} prompt`)
  if (!task.selectionPolicy || task.selectionPolicy.version !== 1 || !Array.isArray(task.selectionPolicy.include) || !task.selectionPolicy.include.length || task.selectionPolicy.include.some(value => typeof value !== 'string' || !value)) fail(`${id} selection policy schema mismatch`)
  if (task.setupPatch !== null && (typeof task.setupPatch !== 'string' || !task.setupPatch.startsWith('setup/'))) fail(`${id} setup patch schema mismatch`)
  const setupHash = task.setupPatch ? fileSha(join(here, task.setupPatch)) : null
  equal(task.setupPatchSha256 ?? null, setupHash, `${id} task setup patch hash`)
  if (task.category === 'code-change' && task.answerSchema !== undefined) fail(`${id} code task must not define an answer schema`)
  if (task.category !== 'code-change') checkAnswerSchema(task.answerSchema, id)
}
function checkAnswerSchema(schema, id) {
  if (!schema || schema.summary !== 'string' || !Array.isArray(schema.findings) || !Array.isArray(schema.evidence)) fail(`${id} answer schema mismatch`)
  // The schema is deliberately small, but it must describe both object shapes.
  const finding = schema.findings[0], evidence = schema.evidence[0]
  if (!finding || finding.id !== 'string' || finding.value !== 'string' || !evidence || evidence.path !== 'repository-relative string' || evidence.token !== 'exact source token') fail(`${id} answer schema fields mismatch`)
}
function checkAcceptance(acceptance, task, id) {
  equal(acceptance.version, 1, `${id} acceptance version`)
  equal(acceptance.checkerSha256, fileSha(join(here, 'accept.mjs')), `${id} acceptance checker hash`)
  if (task.category === 'code-change') {
    if (acceptance.kind !== 'code' || !Array.isArray(acceptance.commands) || !acceptance.commands.length || !Array.isArray(acceptance.behaviour) || !acceptance.behaviour.length) fail(`${id} code acceptance schema mismatch`)
    return
  }
  if (acceptance.kind !== 'structured' || !Array.isArray(acceptance.requiredEvidence) || !acceptance.requiredEvidence.length) fail(`${id} structured acceptance schema mismatch`)
  for (const evidence of acceptance.requiredEvidence) if (!evidence || typeof evidence.path !== 'string' || !evidence.path || typeof evidence.token !== 'string' || !evidence.token) fail(`${id} acceptance evidence schema mismatch`)
}
function canonicalAnswer(acceptance) {
  const findings = Object.entries(acceptance.requiredFindings ?? acceptance.reviewerRubric ?? { finding: 'review against the declared rubric' }).map(([id, value]) => ({ id, value: typeof value === 'string' && value ? value : 'review against the declared rubric' }))
  return { summary: 'Canonical acceptance fixture.', findings, evidence: acceptance.requiredEvidence.map(({ path, token }) => ({ path, token })) }
}
function checkProtocol(document) {
  if (!document || typeof document !== 'object' || !document.protocol || !Array.isArray(document.receipts)) fail('reporter document schema mismatch')
  const { protocol } = document
  equal(protocol.version, 1, 'protocol version'); equal(protocol.experimentId, 'd5-context-kithmoot-20260921-v1', 'experiment id')
  if (protocol.lockedAt !== null && (typeof protocol.lockedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(protocol.lockedAt) || Number.isNaN(Date.parse(protocol.lockedAt)))) fail('lockedAt must be null or a UTC timestamp')
  if (document.receipts.length && protocol.lockedAt === null) fail('receipts require a locked protocol')
  equal(protocol.measurementDefinitionSha256, fileSha(join(here, 'measurement.md')), 'measurement hash')
  if (!Array.isArray(protocol.pairs) || protocol.pairs.length !== pairs.length) fail('protocol pair count mismatch')
  const seen = new Set()
  for (const pair of protocol.pairs) {
    if (!pairs.includes(pair.id) || seen.has(pair.id)) fail('protocol pair IDs mismatch'); seen.add(pair.id)
    const task = json(join(here, 'tasks', `${pair.id}.json`)), acceptance = json(join(here, 'acceptance', `${pair.id}.json`)), repo = repositories[task.repository]
    equal(pair.category, task.category, `${pair.id} category`); equal(pair.taskDefinitionSha256, fileSha(join(here, 'tasks', `${pair.id}.json`)), `${pair.id} task hash`); equal(pair.acceptanceDefinitionSha256, fileSha(join(here, 'acceptance', `${pair.id}.json`)), `${pair.id} acceptance hash`)
    if (!pair.repository || pair.repository.name !== task.repository || pair.repository.revision !== repo.revision || typeof pair.repository.qualificationEvidence !== 'string' || !pair.repository.qualificationEvidence.includes('docs/DOGFOOD-EXECUTION.md') || !pair.repository.qualificationEvidence.includes('20260921-d3-client-w6qs0oay')) fail(`${pair.id} repository qualification mismatch`)
    if (pair.baselineOrder + pair.assistedOrder !== 3 || pair.baselineOrder === pair.assistedOrder) fail(`${pair.id} arm order mismatch`)
    if (!Array.isArray(pair.roles) || pair.roles.length !== 2) fail(`${pair.id} roles mismatch`)
    const executor = pair.roles.find(role => role.role === 'executor'), reviewer = pair.roles.find(role => role.role === 'reviewer')
    if (!executor || !reviewer || executor.model !== 'gpt-5.6-luna' || executor.effort !== 'medium' || executor.settingsSha256 !== fileSha(join(here, 'executor-settings.json')) || reviewer.model !== 'gpt-5.6-sol' || reviewer.effort !== 'high' || reviewer.settingsSha256 !== fileSha(join(here, 'reviewer-settings.json'))) fail(`${pair.id} role settings mismatch`)
    const expectedCheckIds = acceptance.kind === 'structured' ? ['structured-schema', 'frozen-source-provenance', 'blind-sol-rubric'] : ['external-code-checker', 'blind-sol-rubric']
    if (!Array.isArray(pair.acceptanceCheckIds) || pair.acceptanceCheckIds.join('\0') !== expectedCheckIds.join('\0')) fail(`${pair.id} acceptance check IDs mismatch`)
  }
  for (const category of categories) {
    const categoryPairs = protocol.pairs.filter(pair => pair.category === category)
    if (categoryPairs.length !== 2 || categoryPairs[0].baselineOrder === categoryPairs[1].baselineOrder) fail(`${category} orders do not alternate by root`)
  }
}
async function selfTestStructured(contextRoot, kithmootRoot) {
  let count = 0
  for (const id of pairs) {
    const task = json(join(here, 'tasks', `${id}.json`)), acceptance = json(join(here, 'acceptance', `${id}.json`))
    if (acceptance.kind !== 'structured') continue
    const root = task.repository === 'context' ? contextRoot : kithmootRoot, fixture = mkdtempSync(join(tmpdir(), `d5-verify-${id}-`))
    try {
      execFileSync('git', ['archive', '--format=tar', '--output', join(fixture, 'source.tar'), task.revision], { cwd: root })
      execFileSync('tar', ['-xf', join(fixture, 'source.tar'), '-C', fixture])
      if (task.setupPatch) execFileSync('git', ['apply', join(here, task.setupPatch)], { cwd: fixture })
      const source = path => readFileSync(join(fixture, path), 'utf8')
      const answer = canonicalAnswer(acceptance)
      await checkStructuredAnswer(answer, task, acceptance, source)
      const mutation = structuredClone(answer); mutation.evidence[0].token = '__d5_mutated_token__'
      let rejected = false
      try { await checkStructuredAnswer(mutation, task, acceptance, source) } catch { rejected = true }
      if (!rejected) fail(`${id} structured checker accepted its mutation`)
      count += 1
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }
  equal(count, 6, 'structured checker self-test count')
}

const a = args()
if (!a['context-root'] || !a['kithmoot-root']) fail('usage: --context-root PATH --kithmoot-root PATH')
const roots = { context: resolve(a['context-root']), kithmoot: resolve(a['kithmoot-root']) }
const measurement = readFileSync(join(here, 'measurement.md'), 'utf8')
const preparationHash = measurement.match(/Preparation executable SHA-256: `([0-9a-f]{64})`\./)?.[1]
equal(preparationHash, fileSha(join(here, 'prepare-arm.mjs')), 'preparation executable hash')
for (const [name, locked] of Object.entries(repositories)) {
  equal(execFileSync('git', ['rev-parse', locked.revision], { cwd: roots[name], encoding: 'utf8' }).trim(), locked.revision, `${name} locked revision`)
  equal(archiveSha(roots[name], locked.revision), locked.archiveSha256, `${name} archive hash`)
}
for (const id of pairs) {
  const task = json(join(here, 'tasks', `${id}.json`)); checkTask(task, id); checkAcceptance(json(join(here, 'acceptance', `${id}.json`)), task, id)
}
checkProtocol(json(join(here, 'protocol.json')))
await selfTestStructured(roots.context, roots.kithmoot)
process.stdout.write(JSON.stringify({ verified: true, pairs: pairs.length, structuredCheckers: 6, lockedAt: json(join(here, 'protocol.json')).protocol.lockedAt }) + '\n')
