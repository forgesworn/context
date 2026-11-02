import { isAbsolute, normalize } from 'node:path'
import { z } from 'zod'

// This is a data contract and replay planner for a coding host, never an executor.
// All actors, receipts, approvals and source hashes remain host assertions.
const text = z.string().trim().min(1).max(2048)
const id = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const root = text.refine(value => isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f]/u.test(value), 'canonical absolute root required')
const path = text.refine(value => !isAbsolute(value) && !value.includes('\\') && !/[\x00-\x1f]/u.test(value) &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'normalised relative path required')
const unique = <T>(values: T[]) => new Set(values).size === values.length
const ids = z.array(id).max(64).refine(unique, 'duplicate identifier')
const usage = z.object({ inputTokens: integer.nullable(), outputTokens: integer.nullable(), costMicros: integer.nullable() }).strict()
const source = z.object({ path, startLine: integer.min(1), endLine: integer.min(1), sha256: hash }).strict()
  .refine(value => value.endLine >= value.startLine, 'invalid source range')
const finding = z.object({ id, claim: text, sources: z.array(source).min(1).max(16) }).strict()
const node = z.object({ id, task: text, dependsOn: ids, paths: z.array(path).max(64).refine(unique),
  checks: z.array(text).min(1).max(32).refine(unique), maxAttempts: integer.min(1).max(16),
  gate: id.nullable(), effect: z.enum(['none', 'external']), costLimitMicros: integer.nullable(),
}).strict()
const specSchema = z.object({ version: z.literal(1), id, root, revision: hash, createdAt: integer,
  nodes: z.array(node).min(1).max(64), budget: z.object({ maxConcurrent: integer.min(1).max(16),
    maxAttempts: integer.min(1).max(1024), maxDurationMs: integer.min(1).max(86_400_000), maxCostMicros: integer.nullable(),
  }).strict(),
}).strict()
const base = { id, at: integer, actor: id }
const attempt = { ...base, node: id, attempt: id }
const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...attempt, type: z.literal('start'), packetSha256: hash, approvalEvidence: text.nullable() }).strict(),
  z.object({ ...attempt, type: z.literal('result'), outcome: z.enum(['succeeded', 'failed', 'unknown']),
    failure: z.enum(['transient', 'invalid_output', 'refused', 'spend_hold']).nullable(),
    checks: z.array(z.object({ check: text, outcome: z.enum(['passed', 'failed', 'unknown']), evidence: text }).strict()).max(32),
    findings: z.array(finding).max(128), usage,
  }).strict(),
  z.object({ ...attempt, type: z.literal('review'), accepted: z.boolean(), evidence: text }).strict(),
  z.object({ ...attempt, type: z.literal('reconcile'), resolution: z.enum(['retry_safe', 'stop']), evidence: text }).strict(),
  z.object({ ...base, type: z.literal('cancel'), evidence: text }).strict(),
])
const recordSchema = z.object({ format: z.literal('z1p-host-workflow-v1'), spec: specSchema, events: z.array(eventSchema).max(4096) }).strict()
const observationSchema = z.object({ root, revision: hash, now: integer,
  approvals: z.array(z.object({ gate: id, revision: hash, evidence: text }).strict()).max(64),
}).strict()

export type WorkflowSpec = z.infer<typeof specSchema>
export type WorkflowEvent = z.infer<typeof eventSchema>
export type WorkflowRecord = z.infer<typeof recordSchema>
export type WorkflowObservation = z.infer<typeof observationSchema>
type Start = Extract<WorkflowEvent, { type: 'start' }>
type Result = Extract<WorkflowEvent, { type: 'result' }>
type Review = Extract<WorkflowEvent, { type: 'review' }>
type Reconcile = Extract<WorkflowEvent, { type: 'reconcile' }>
interface Attempt { start: Start; result?: Result; review?: Review; reconciliation?: Reconcile }
type NodeState = 'pending' | 'running' | 'awaiting_review' | 'accepted' | 'retryable' | 'reconcile' | 'escalated' | 'exhausted'
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('host-workflow: ' + message)
}
// Canonicalise objects for event identity; JSON property order is not identity.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
  return JSON.stringify(value)
}
function bounded(value: unknown) {
  assert(Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024, 'record exceeds 2 MiB')
}
function validateSpec(spec: WorkflowSpec) {
  const nodes = new Map(spec.nodes.map(item => [item.id, item]))
  assert(nodes.size === spec.nodes.length, 'duplicate node')
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (key: string) => {
    assert(nodes.has(key), 'missing dependency')
    assert(!visiting.has(key), 'dependency cycle')
    if (visited.has(key)) return
    visiting.add(key)
    for (const parent of nodes.get(key)!.dependsOn) visit(parent)
    visiting.delete(key); visited.add(key)
  }
  for (const item of spec.nodes) {
    visit(item.id)
    assert(item.effect !== 'external' || item.gate !== null, 'external effects require a host gate')
    assert(spec.budget.maxCostMicros === null || item.costLimitMicros !== null, 'cost cap requires per-attempt limits')
  }
}
export function createWorkflow(input: unknown): WorkflowRecord {
  bounded(input)
  const spec = specSchema.parse(input)
  validateSpec(spec)
  return { format: 'z1p-host-workflow-v1', spec, events: [] }
}
function state(item: WorkflowSpec['nodes'][number], attempts: Attempt[]): NodeState {
  const last = attempts.at(-1)
  if (!last) return 'pending'
  if (!last.result) return 'running'
  if (last.result.failure === 'refused' || last.result.failure === 'spend_hold') return 'escalated'
  if (last.result.outcome === 'succeeded') {
    if (!last.review) return 'awaiting_review'
    if (last.review.accepted) return 'accepted'
  }
  if (last.result.outcome === 'unknown' || item.effect === 'external') {
    if (!last.reconciliation) return 'reconcile'
    if (last.reconciliation.resolution === 'stop') return 'escalated'
  }
  return attempts.length >= item.maxAttempts ? 'exhausted' : 'retryable'
}
function overlap(a: string[], b: string[]) {
  return a.some(x => b.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')))
}
function totals(attempts: Attempt[]) {
  const results = attempts.flatMap(item => item.result ? [item.result] : [])
  const sum = (values: number[]) => {
    const value = values.reduce((a, b) => a + b, 0)
    assert(Number.isSafeInteger(value), 'usage total exceeds safe integer')
    return value
  }
  const observedCost = sum(results.map(item => item.usage.costMicros ?? 0))
  const observedTokens = sum(results.map(item => sum([item.usage.inputTokens ?? 0, item.usage.outputTokens ?? 0])))
  const costUnknown = results.some(item => item.usage.costMicros === null)
  return { observedCost, observedTokens, costUnknown,
    cost: costUnknown || results.length !== attempts.length ? null : observedCost,
    tokens: results.some(item => item.usage.inputTokens === null || item.usage.outputTokens === null) || results.length !== attempts.length ? null : observedTokens }
}
function eligible(spec: WorkflowSpec, attempts: Map<string, Attempt[]>, cancelled: boolean, observed: WorkflowObservation) {
  const all = [...attempts.values()].flat(), usage = totals(all), stopReasons: string[] = []
  if (cancelled) stopReasons.push('cancelled')
  if (all.some(item => item.result?.failure === 'spend_hold')) stopReasons.push('spend_hold')
  if (observed.now - spec.createdAt >= spec.budget.maxDurationMs) stopReasons.push('duration_limit')
  if (all.length >= spec.budget.maxAttempts) stopReasons.push('attempt_limit')
  if (spec.budget.maxCostMicros !== null) {
    if (usage.costUnknown) stopReasons.push('cost_unknown')
    if (usage.observedCost >= spec.budget.maxCostMicros) stopReasons.push('cost_limit')
    if (all.some(item => item.result?.usage.costMicros !== null && item.result !== undefined &&
      item.result.usage.costMicros! > spec.nodes.find(n => n.id === item.start.node)!.costLimitMicros!)) stopReasons.push('attempt_cost_limit')
  }
  const running = spec.nodes.filter(item => state(item, attempts.get(item.id)!) === 'running')
  const claimed = spec.nodes.filter(item => ['running', 'awaiting_review', 'reconcile'].includes(state(item, attempts.get(item.id)!)))
  let reserved = running.reduce((sum, item) => sum + (item.costLimitMicros ?? 0), 0)
  assert(Number.isSafeInteger(reserved), 'cost reservations exceed safe integer')
  const ready: string[] = [], occupied = [...claimed]
  if (stopReasons.length === 0) for (const item of spec.nodes) {
    const status = state(item, attempts.get(item.id)!)
    if (!['pending', 'retryable'].includes(status) || running.length + ready.length >= spec.budget.maxConcurrent || all.length + ready.length >= spec.budget.maxAttempts) continue
    if (!item.dependsOn.every(key => state(spec.nodes.find(n => n.id === key)!, attempts.get(key)!) === 'accepted')) continue
    if (item.gate !== null && !observed.approvals.some(a => a.gate === item.gate && a.revision === spec.revision)) continue
    if (occupied.some(other => overlap(item.paths, other.paths))) continue
    if (spec.budget.maxCostMicros !== null && item.costLimitMicros! > spec.budget.maxCostMicros - usage.observedCost - reserved) continue
    ready.push(item.id); occupied.push(item); reserved += item.costLimitMicros ?? 0
    assert(Number.isSafeInteger(reserved), 'cost reservations exceed safe integer')
  }
  return { ready, stopReasons, usage }
}
function replay(input: unknown) {
  bounded(input)
  const record = recordSchema.parse(input)
  validateSpec(record.spec)
  const attempts = new Map(record.spec.nodes.map(item => [item.id, [] as Attempt[]]))
  const eventIds = new Set<string>(), attemptIds = new Set<string>()
  let at = record.spec.createdAt, cancelled = false
  for (const event of record.events) {
    assert(!eventIds.has(event.id), 'duplicate event ID in record')
    eventIds.add(event.id)
    assert(event.at >= at, 'event time moved backwards'); at = event.at
    if (event.type === 'cancel') { assert(!cancelled, 'already cancelled'); cancelled = true; continue }
    const item = record.spec.nodes.find(n => n.id === event.node)
    assert(item, 'event references missing node')
    const history = attempts.get(item.id)!
    if (event.type === 'start') {
      assert(!attemptIds.has(event.attempt), 'attempt IDs must be unique across nodes')
      const approvals = item.gate !== null && event.approvalEvidence !== null ? [{ gate: item.gate, revision: record.spec.revision, evidence: event.approvalEvidence }] : []
      // Historical approval evidence is a recorded assertion. append() separately
      // requires the current host's observation, never a worker-supplied grant.
      assert(eligible(record.spec, attempts, cancelled, { root: record.spec.root, revision: record.spec.revision, now: event.at, approvals }).ready.includes(item.id), 'start violates dependencies, overlap, authority or budget')
      assert(item.gate !== null || event.approvalEvidence === null, 'unexpected approval evidence')
      history.push({ start: event }); attemptIds.add(event.attempt); continue
    }
    const current = history.at(-1)
    assert(current && current.start.attempt === event.attempt, 'event does not match current attempt')
    if (event.type === 'result') {
      assert(!current.result, 'attempt already has a result')
      assert(unique(event.checks.map(c => c.check)) && event.checks.every(c => item.checks.includes(c.check)), 'unknown or duplicate check')
      assert(event.outcome !== 'succeeded' || event.checks.length === item.checks.length, 'successful result must report every check')
      assert(event.outcome === 'failed' ? event.failure !== null : event.failure === null, 'invalid failure classification')
      assert(event.actor === current.start.actor, 'result actor must match attempt owner')
      current.result = event
    } else if (event.type === 'review') {
      assert(current.result?.outcome === 'succeeded' && !current.review, 'review requires an unreviewed successful result')
      if (event.accepted) {
        assert(event.actor !== current.start.actor, 'worker cannot accept its own result')
        assert(current.result.checks.every(c => c.outcome === 'passed'), 'acceptance requires passing checks')
      }
      current.review = event
    } else {
      assert(current.result && state(item, history) === 'reconcile' && !current.reconciliation, 'only uncertain or unaccepted external effects can be reconciled')
      current.reconciliation = event
    }
  }
  return { record, attempts, cancelled, lastAt: at }
}
function observe(record: WorkflowRecord, input: unknown, lastAt: number) {
  const observed = observationSchema.parse(input)
  assert(observed.root === record.spec.root && observed.revision === record.spec.revision, 'checkout or task revision changed; review and create a new workflow')
  assert(observed.now >= lastAt, 'observation predates recorded events')
  return observed
}
export function appendWorkflowEvent(input: unknown, eventInput: unknown, expectedSequence: number, observation: unknown): WorkflowRecord {
  assert(Number.isSafeInteger(expectedSequence) && expectedSequence >= 0, 'invalid expected event sequence')
  const current = replay(input), event = eventSchema.parse(eventInput)
  const observed = observe(current.record, observation, current.lastAt)
  const prior = current.record.events.find(item => item.id === event.id)
  if (prior) {
    assert(canonical(prior) === canonical(event), 'event ID reused with different content')
    return current.record
  }
  assert(expectedSequence === current.record.events.length, 'event sequence changed; reread before appending')
  assert(event.at <= observed.now && event.at >= current.lastAt, 'invalid event time')
  if (event.type === 'start') {
    assert(eligible(current.record.spec, current.attempts, current.cancelled, observed).ready.includes(event.node), 'node is not ready under current host observations')
    const item = current.record.spec.nodes.find(n => n.id === event.node)!
    assert(item.gate === null || observed.approvals.some(a => a.gate === item.gate && a.revision === current.record.spec.revision && a.evidence === event.approvalEvidence), 'current host approval required')
  }
  return replay({ ...current.record, events: [...current.record.events, event] }).record
}
export function planWorkflow(input: unknown, observation: unknown) {
  const { record, attempts, cancelled, lastAt } = replay(input)
  const observed = observe(record, observation, lastAt)
  const { ready, stopReasons, usage } = eligible(record.spec, attempts, cancelled, observed)
  const nodes = record.spec.nodes.map(item => ({ id: item.id, state: state(item, attempts.get(item.id)!), attempts: attempts.get(item.id)!.length }))
  const all = [...attempts.values()].flat()
  const accepted = all.filter(a => a.review?.accepted)
  return { format: record.format, id: record.spec.id, sequence: record.events.length, ready, stopReasons, nodes,
    reportedComplete: !cancelled && nodes.every(n => n.state === 'accepted'),
    findings: reduceWorkflowFindings(accepted.flatMap(a => a.result!.findings.map(f => ({ node: a.start.node, attempt: a.start.attempt, finding: f })))),
    metrics: { attempts: all.length, retries: all.length - nodes.filter(n => n.attempts > 0).length,
      rejectedReviews: all.filter(a => a.review && !a.review.accepted).length,
      failedAttempts: all.filter(a => a.result?.outcome === 'failed').length,
      unknownOutcomes: all.filter(a => a.result?.outcome === 'unknown' && !a.reconciliation).length,
      elapsedMs: observed.now - record.spec.createdAt,
      observedAttemptTokens: usage.observedTokens, attemptTokens: usage.tokens,
      observedAttemptCostMicros: usage.observedCost, attemptCostMicros: usage.cost,
      accountingScope: 'attempt-results-only' as const, wholeTaskCost: null,
    },
    caveat: 'Unsigned host assertions. Ready work is a proposal, not execution permission. The host verifies source packets, actors, approvals and check receipts, enforces live limits and reconciles external effects. Attempt usage excludes preparation, coordinator and review; use complete-task accounting.',
  }
}

export function reduceWorkflowFindings(input: unknown) {
  bounded(input)
  const rows = z.array(z.object({ node: id, attempt: id, finding }).strict()).max(8192).parse(input)
  type Reduced = { ids: string[]; claim: string; sources: z.infer<typeof source>[]; provenance: { node: string; attempt: string }[] }
  const reduced = new Map<string, Reduced>(), identities = new Map<string, Set<string>>()
  for (const row of rows) {
    const sources = [...new Map(row.finding.sources.map(s => [canonical(s), s])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, s]) => s)
    const key = canonical({ claim: row.finding.claim, sources })
    const existing = reduced.get(key) ?? { ids: [], claim: row.finding.claim, sources, provenance: [] }
    if (!existing.ids.includes(row.finding.id)) existing.ids.push(row.finding.id)
    if (!existing.provenance.some(p => p.node === row.node && p.attempt === row.attempt)) existing.provenance.push({ node: row.node, attempt: row.attempt })
    reduced.set(key, existing)
    const keys = identities.get(row.finding.id) ?? new Set<string>(); keys.add(key); identities.set(row.finding.id, keys)
  }
  return { inputCount: rows.length, findings: [...reduced.values()], conflictingIds: [...identities].filter(([, keys]) => keys.size > 1).map(([key]) => key).sort() }
}

const lifecycleSteps = ['startup', 'status', 'coordination', 'activity', 'message_sent', 'message_received', 'packet', 'edit',
  'stale_rejected', 'refresh', 'fresh_packet', 'checks', 'checkpoint', 'restart', 'resume', 'done'] as const
const lifecycleSchema = z.object({ version: z.literal(1), host: z.enum(['codex', 'claude', 'kimi', 'ollama']), hostVersion: text,
  transport: z.enum(['native', 'shell', 'host_packet']), root, automaticGuidance: z.boolean(),
  observations: z.array(z.object({ step: z.enum(lifecycleSteps), at: integer, passed: z.boolean(), evidence: text, session: id, generation: text.nullable() }).strict()).max(256),
}).strict()
/** Checks receipt completeness and consistency, not whether those receipts are true. */
export function assessHostLifecycle(input: unknown) {
  bounded(input)
  const trace = lifecycleSchema.parse(input)
  assert(trace.host !== 'ollama' || trace.transport === 'host_packet', 'direct Ollama qualification requires host-mediated packets')
  const issues: string[] = [], missing: string[] = []
  if (!trace.automaticGuidance) issues.push('automatic startup guidance was not observed')
  let previousIndex = -1, previousTime = 0
  const selected = new Map<string, typeof trace.observations[number]>()
  for (const step of lifecycleSteps) {
    const matches = trace.observations.filter(o => o.step === step)
    if (matches.length !== 1) { if (!matches.length) missing.push(step); else issues.push('duplicate observation: ' + step); continue }
    const item = matches[0], index = trace.observations.indexOf(item)
    if (!item.passed) issues.push('failed observation: ' + step)
    if (index <= previousIndex || item.at < previousTime) issues.push('observation out of order: ' + step)
    previousIndex = index; previousTime = item.at; selected.set(step, item)
  }
  const status = selected.get('status'), packet = selected.get('packet'), refresh = selected.get('refresh'), fresh = selected.get('fresh_packet')
  if (status && packet && (!status.generation || status.generation !== packet.generation)) issues.push('initial packet generation mismatch')
  if (refresh && fresh && (!refresh.generation || refresh.generation !== fresh.generation || fresh.generation === packet?.generation)) issues.push('refreshed packet generation mismatch')
  const checkpoint = selected.get('checkpoint'), resume = selected.get('resume'), restart = selected.get('restart')
  if (checkpoint && resume && (checkpoint.session === resume.session || restart?.session !== resume.session)) issues.push('restart/resume needs a new observed session')
  return { host: trace.host, hostVersion: trace.hostVersion, transport: trace.transport,
    qualification: missing.length || issues.length ? 'incomplete' : 'reported_complete', missing, issues,
    authentication: 'not-verified',
    caveat: 'Checks supplied observations only. Retain actual host/tool traces and review them independently; this report cannot authenticate tool execution or prove model adherence.',
  }
}
