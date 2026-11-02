// Independent installation boundary; fixture assertions are not host adoption.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorkflow, appendWorkflowEvent, planWorkflow, assessHostLifecycle } from '@forgesworn/context-tools/host-workflow'

globalThis.fetch = () => { throw new Error('Workflow planning must not contact a provider') }
const cli = process.argv[2], root = join(process.cwd(), 'workflow-repo'), storage = join(process.cwd(), 'workflow-private')
await mkdir(root); await mkdir(storage, { mode: 0o700 })
execFileSync('git', ['init', '-q', root], { stdio: 'pipe', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) })
const revision = 'a'.repeat(64)
const spec = { version: 1, id: 'installed', root, revision, createdAt: 100,
  nodes: ['one', 'two'].map((id, i) => ({ id, task: 'Inspect source', dependsOn: i ? ['one'] : [], paths: [], checks: ['test'],
    maxAttempts: 2, gate: null, effect: 'none', costLimitMicros: null })),
  budget: { maxConcurrent: 2, maxAttempts: 4, maxDurationMs: 1000, maxCostMicros: null } }
const observation = { root, revision, now: 200, approvals: [] }
let record = createWorkflow(spec)
for (const node of ['one', 'two']) {
  const at = node === 'one' ? 110 : 140
  for (const event of [
    { id: node + '-start', type: 'start', node, attempt: node, actor: 'worker', at, packetSha256: revision, approvalEvidence: null },
    { id: node + '-result', type: 'result', node, attempt: node, actor: 'worker', at: at + 1, outcome: 'succeeded', failure: null,
      checks: [{ check: 'test', outcome: 'passed', evidence: 'Fixture assertion passed' }], findings: [], usage: { inputTokens: 10, outputTokens: 2, costMicros: null } },
    { id: node + '-review', type: 'review', node, attempt: node, actor: 'reviewer', at: at + 2, accepted: true, evidence: 'Fixture receipt inspected' },
  ]) record = appendWorkflowEvent(record, event, record.events.length, observation)
}
assert.equal(planWorkflow(JSON.parse(JSON.stringify(record)), observation).reportedComplete, true)
assert.equal(planWorkflow(record, observation).metrics.wholeTaskCost, null)
const write = async (name, value) => { const path = join(storage, name); await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path }
const run = args => JSON.parse(execFileSync(process.execPath, [cli, 'workflow', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }))
const input = await write('spec.json', spec), out = join(storage, 'initial.json'), observed = await write('observed.json', observation)
assert.equal(run(['init', '--root', root, '--spec', input, '--out', out]).status, 'written')
if (process.platform !== 'win32') assert.equal((await stat(out)).mode & 0o777, 0o600)
assert.deepEqual(run(['plan', '--root', root, '--record', out, '--observation', observed]).ready, ['one'])
assert.throws(() => run(['init', '--root', root, '--spec', input, '--out', out]))
assert.equal(JSON.parse(await readFile(out, 'utf8')).events.length, 0)
assert.equal(assessHostLifecycle({ version: 1, host: 'claude', hostVersion: 'fixture', transport: 'native', root,
  automaticGuidance: true, observations: [] }).qualification, 'incomplete')
console.log('Packed host workflows: dependency/review replay, private exclusive snapshots, root binding and explicit incomplete host qualification passed.')
