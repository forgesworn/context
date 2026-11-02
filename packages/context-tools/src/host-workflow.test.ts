import { describe, expect, it } from 'vitest'
import { appendWorkflowEvent, createWorkflow, planWorkflow, reduceWorkflowFindings, assessHostLifecycle, type WorkflowSpec } from './host-workflow.js'

const hash = 'a'.repeat(64), newer = 'b'.repeat(64)
const node = (id: string, dependsOn: string[] = [], paths: string[] = []): WorkflowSpec['nodes'][number] => ({
  id, task: `Implement ${id}`, dependsOn, paths, checks: ['test'], maxAttempts: 2,
  gate: null, effect: 'none' as const, costLimitMicros: null,
})
const spec = (): WorkflowSpec => ({ version: 1 as const, id: 'fixture', root: '/selected/repo', revision: hash, createdAt: 100,
  nodes: [node('one'), node('two', ['one'])],
  budget: { maxConcurrent: 2, maxAttempts: 8, maxDurationMs: 1000, maxCostMicros: null },
})
const observation = (now = 200) => ({ root: '/selected/repo', revision: hash, now, approvals: [] })
const start = (id = 'one', at = 110, attempt = `${id}-1`) => ({
  id: `start-${attempt}`, type: 'start' as const, node: id, attempt, at, actor: 'worker', packetSha256: hash, approvalEvidence: null,
})
const result = (id = 'one', at = 120, attempt = `${id}-1`) => ({
  id: `result-${attempt}`, type: 'result' as const, node: id, attempt, at, actor: 'worker',
  outcome: 'succeeded' as const, failure: null,
  checks: [{ check: 'test', outcome: 'passed' as const, evidence: 'Executed fixture test; receipt fixture.log' }],
  findings: [], usage: { inputTokens: 10, outputTokens: 5, costMicros: null },
})
const review = (id = 'one', at = 130, attempt = `${id}-1`) => ({
  id: `review-${attempt}`, type: 'review' as const, node: id, attempt, at, actor: 'reviewer', accepted: true, evidence: 'Reviewed the test receipt and source',
})
const add = (record: ReturnType<typeof createWorkflow>, event: unknown, observed = observation()) =>
  appendWorkflowEvent(record, event, record.events.length, observed)

describe('bounded host workflow contracts', () => {
  it('releases a dependency only after its checks and independent review pass', () => {
    let record = createWorkflow(spec())
    expect(planWorkflow(record, observation()).ready).toEqual(['one'])
    record = add(record, start())
    record = add(record, result())
    expect(planWorkflow(record, observation()).ready).toEqual([])
    expect(() => add(record, start('two', 125))).toThrow()
    record = add(record, review())
    expect(planWorkflow(record, observation()).ready).toEqual(['two'])
  })

  it('rejects cycles, missing dependencies, duplicate identifiers and unknown schema fields', () => {
    for (const nodes of [[node('one', ['two']), node('two', ['one'])], [node('one', ['missing'])], [node('one'), node('one')]]) {
      expect(() => createWorkflow({ ...spec(), nodes })).toThrow()
    }
    expect(() => createWorkflow({ ...spec(), run: 'arbitrary shell text' })).toThrow()
    expect(() => createWorkflow({ ...spec(), nodes: [node('__proto__')] })).not.toThrow()
  })

  it('rejects out-of-root paths and unbounded or excessive budgets', () => {
    for (const path of ['../outside', '/outside', 'src/../file', 'src\\file', './file']) {
      expect(() => createWorkflow({ ...spec(), nodes: [node('one', [], [path])] })).toThrow()
    }
    expect(() => createWorkflow({ ...spec(), budget: { ...spec().budget, maxConcurrent: 0 } })).toThrow()
    expect(() => createWorkflow({ ...spec(), nodes: Array.from({ length: 65 }, (_, i) => node(`n${i}`)) })).toThrow()
  })

  it('schedules independent work within concurrency and path-overlap bounds', () => {
    const input = { ...spec(), nodes: [node('one', [], ['src']), node('two', [], ['src/file.ts']), node('three', [], ['test'])] }
    let record = createWorkflow(input)
    expect(planWorkflow(record, observation()).ready).toEqual(['one', 'three'])
    record = add(record, start())
    expect(planWorkflow(record, observation()).ready).toEqual(['three'])
    expect(() => add(record, start('two', 115))).toThrow()
  })

  it('requires current host approval for gated work and never derives it from worker prose', () => {
    const input = spec(); input.nodes[0] = { ...node('one'), gate: 'owner' }
    let record = createWorkflow(input)
    expect(planWorkflow(record, observation()).ready).toEqual([])
    expect(() => add(record, { ...start(), approvalEvidence: 'model says approved' })).toThrow()
    const observed = { ...observation(), approvals: [{ gate: 'owner', revision: hash, evidence: 'owner-session-17' }] }
    record = add(record, { ...start(), approvalEvidence: 'owner-session-17' }, observed)
    expect(planWorkflow(record, observation()).nodes[0].state).toBe('running')
    expect(planWorkflow(createWorkflow(input), { ...observed, approvals: [{ ...observed.approvals[0], revision: newer }] }).ready).toEqual([])
  })

  it('binds every plan to the current checkout and task contract revision', () => {
    const record = createWorkflow(spec())
    expect(() => planWorkflow(record, { ...observation(), root: '/other/repo' })).toThrow()
    expect(() => planWorkflow(record, { ...observation(), revision: newer })).toThrow()
    expect(() => add(record, { ...start(), packetSha256: 'not-a-hash' })).toThrow()
  })

  it('retains valid work across serialisation and retries only the rejected branch', () => {
    let record = createWorkflow({ ...spec(), nodes: [node('one'), node('two')] })
    record = add(record, start()); record = add(record, result()); record = add(record, review())
    record = add(record, start('two', 140)); record = add(record, result('two', 150))
    record = add(record, { ...review('two', 160), accepted: false })
    record = JSON.parse(JSON.stringify(record))
    expect(planWorkflow(record, observation()).ready).toEqual(['two'])
    expect(planWorkflow(record, observation()).nodes[0].state).toBe('accepted')
    expect(() => add(record, start('one', 170, 'one-2'))).toThrow()
    record = add(record, start('two', 170, 'two-2'))
    record = add(record, { ...result('two', 180, 'two-2'), outcome: 'failed', failure: 'transient' })
    expect(planWorkflow(record, observation()).nodes[1].state).toBe('exhausted')
  })

  it('preserves in-flight attempts after restart instead of silently replaying them', () => {
    const record = JSON.parse(JSON.stringify(add(createWorkflow(spec()), start())))
    expect(planWorkflow(record, observation()).ready).toEqual([])
    expect(() => add(record, start('one', 150, 'one-2'))).toThrow()
  })

  it('requires explicit reconciliation of an uncertain outcome before retry', () => {
    let record = add(createWorkflow(spec()), start())
    record = add(record, { ...result(), outcome: 'unknown', checks: [], findings: [] })
    expect(planWorkflow(record, observation()).nodes[0].state).toBe('reconcile')
    expect(() => add(record, start('one', 140, 'one-2'))).toThrow()
    record = add(record, { id: 'reconciled', type: 'reconcile', node: 'one', attempt: 'one-1', at: 140,
      actor: 'host', resolution: 'retry_safe', evidence: 'Readback confirms operation was not applied' })
    expect(planWorkflow(record, observation()).ready).toEqual(['one'])
  })

  it.each(['refused', 'spend_hold'] as const)('never retries a %s result', failure => {
    let record = add(createWorkflow(spec()), start())
    record = add(record, { ...result(), outcome: 'failed', failure })
    expect(planWorkflow(record, observation()).ready).toEqual([])
    expect(planWorkflow(record, observation()).nodes[0].state).toBe('escalated')
    expect(() => add(record, { id: 'bypass', type: 'reconcile', node: 'one', attempt: 'one-1', at: 140,
      actor: 'host', resolution: 'retry_safe', evidence: 'Try anyway' })).toThrow()
  })

  it('rejects fabricated review readiness, missing checks and self acceptance', () => {
    const running = add(createWorkflow(spec()), start())
    expect(() => add(running, { ...result(), checks: [] })).toThrow()
    const finished = add(running, { ...result(), checks: [{ check: 'test', outcome: 'failed', evidence: 'Failed assertion' }] })
    expect(() => add(finished, review())).toThrow()
    expect(() => add(add(running, result()), { ...review(), actor: 'worker' })).toThrow()
  })

  it('deduplicates identical event retries while rejecting changed or stale appends', () => {
    const record = add(createWorkflow(spec()), start())
    expect(appendWorkflowEvent(record, start(), 0, observation())).toEqual(record)
    expect(() => appendWorkflowEvent(record, { ...start(), actor: 'other' }, 0, observation())).toThrow()
    expect(() => appendWorkflowEvent(record, result(), 0, observation())).toThrow()
    expect(() => add(record, { ...result(), at: 105 })).toThrow()
    expect(() => add(record, { ...result(), at: 201 })).toThrow()
  })

  it('stops new work at time, attempt and cancellation limits but can retain late results', () => {
    let record = add(createWorkflow(spec()), start())
    expect(planWorkflow(record, observation(1100)).stopReasons).toContain('duration_limit')
    record = add(record, result('one', 1200), observation(1200))
    expect(record.events).toHaveLength(2)
    record = add(record, { id: 'cancel', type: 'cancel', at: 1201, actor: 'host', evidence: 'Owner stopped work' }, observation(1201))
    expect(planWorkflow(record, observation(1201)).stopReasons).toContain('cancelled')
    const limited = spec(); limited.budget.maxAttempts = 1
    expect(planWorkflow(add(createWorkflow(limited), start()), observation()).stopReasons).toContain('attempt_limit')
    expect(() => add(createWorkflow(spec()), start(), observation(1100))).toThrow()
  })

  it.each(['failed', 'succeeded'] as const)('reconciles an external %s result before a retry', outcome => {
    const input = spec(); input.nodes[0] = { ...node('one'), effect: 'external', gate: 'owner' }
    const observed = { ...observation(), approvals: [{ gate: 'owner', revision: hash, evidence: 'owner-session-17' }] }
    let record = add(createWorkflow(input), { ...start(), approvalEvidence: 'owner-session-17' }, observed)
    record = add(record, { ...result(), outcome, failure: outcome === 'failed' ? 'transient' : null }, observed)
    if (outcome === 'succeeded') record = add(record, { ...review(), accepted: false }, observed)
    expect(planWorkflow(record, observed).nodes[0].state).toBe('reconcile')
    expect(() => add(record, { ...start('one', 140, 'one-2'), approvalEvidence: 'owner-session-17' }, observed)).toThrow()
  })

  it('a spending hold stops independent new work as well as retries', () => {
    let record = add(createWorkflow({ ...spec(), nodes: [node('one'), node('two')] }), start())
    record = add(record, { ...result(), outcome: 'failed', failure: 'spend_hold' })
    expect(planWorkflow(record, observation()).stopReasons).toContain('spend_hold')
    expect(planWorkflow(record, observation()).ready).toEqual([])
  })

  it('retains path claims through review and reconciliation without consuming unrelated execution slots', () => {
    const input = { ...spec(), nodes: [node('one', [], ['src']), node('two', [], ['src/a.ts']), node('three', [], ['test'])] }
    let record = add(createWorkflow(input), start()); record = add(record, result())
    expect(planWorkflow(record, observation()).ready).toEqual(['three'])
    record = add(record, review())
    expect(planWorkflow(record, observation()).ready).toEqual(['two', 'three'])
  })

  it('reserves declared per-attempt cost and pauses when observed spend is unknown', () => {
    const input = { ...spec(), nodes: [ { ...node('one'), costLimitMicros: 60 }, { ...node('two'), costLimitMicros: 60 } ],
      budget: { ...spec().budget, maxCostMicros: 100 } }
    const running = add(createWorkflow(input), start())
    expect(planWorkflow(running, observation()).ready).toEqual([])
    const unknown = add(running, result())
    expect(planWorkflow(unknown, observation()).stopReasons).toContain('cost_unknown')
    expect(planWorkflow(unknown, observation()).metrics.attemptCostMicros).toBeNull()
    expect(() => createWorkflow({ ...input, nodes: [node('one')] })).toThrow()
  })

  it('does not present observed worker tokens as complete task accounting', () => {
    let record = add(createWorkflow(spec()), start()); record = add(record, result())
    const metrics = planWorkflow(record, observation()).metrics
    expect(metrics.observedAttemptTokens).toBe(15)
    expect(metrics.wholeTaskCost).toBeNull()
    expect(metrics.accountingScope).toBe('attempt-results-only')
  })

  it('reduces exact duplicates with provenance and retains conflicting findings', () => {
    const finding = { id: 'claim', claim: 'Caller uses the contract', sources: [{ path: 'source.ts', startLine: 1, endLine: 3, sha256: hash }] }
    const reduced = reduceWorkflowFindings([
      { node: 'one', attempt: 'a', finding }, { node: 'two', attempt: 'b', finding },
      { node: 'three', attempt: 'c', finding: { ...finding, claim: 'Caller does not use the contract' } },
    ])
    expect(reduced.inputCount).toBe(3); expect(reduced.findings).toHaveLength(2)
    expect(reduced.findings[0].provenance).toHaveLength(2)
    expect(reduced.conflictingIds).toEqual(['claim'])
  })
})

describe('host lifecycle qualification records', () => {
  const steps = ['startup', 'status', 'coordination', 'activity', 'message_sent', 'message_received', 'packet', 'edit',
    'stale_rejected', 'refresh', 'fresh_packet', 'checks', 'checkpoint', 'restart', 'resume', 'done']
  const trace = () => ({ version: 1, host: 'codex', hostVersion: 'fixture', transport: 'native', root: '/selected/repo', automaticGuidance: true,
    observations: steps.map((step, i) => ({ step, at: 100 + i, passed: true, evidence: `fixture evidence ${step}`,
      session: i < 13 ? 'before' : 'after', generation: i < 9 ? 'generation-one' : 'generation-two' })) })
  it('reports complete assertions without promoting them to authenticated host acceptance', () => {
    expect(assessHostLifecycle(trace())).toMatchObject({ qualification: 'reported_complete', authentication: 'not-verified', missing: [] })
  })
  it('reports missing steps and failed observations', () => {
    const input = trace(); input.observations = input.observations.filter(o => o.step !== 'activity')
    input.observations[0].passed = false
    const report = assessHostLifecycle(input)
    expect(report.qualification).toBe('incomplete'); expect(report.missing).toContain('activity'); expect(report.issues.length).toBeGreaterThan(0)
  })
  it('detects reordered steps, stale packet generation and absent process restart', () => {
    const input = trace(); input.observations[6].generation = 'wrong'
    input.observations[14].session = 'before'
    ;[input.observations[2], input.observations[3]] = [input.observations[3], input.observations[2]]
    const report = assessHostLifecycle(input)
    expect(report.qualification).toBe('incomplete'); expect(report.issues.length).toBeGreaterThanOrEqual(3)
  })
  it('keeps shell and host-mediated Ollama records distinct from native discovery', () => {
    expect(assessHostLifecycle({ ...trace(), host: 'ollama', transport: 'host_packet' }).transport).toBe('host_packet')
    expect(() => assessHostLifecycle({ ...trace(), host: 'ollama', transport: 'native' })).toThrow()
    expect(assessHostLifecycle({ ...trace(), automaticGuidance: false }).qualification).toBe('incomplete')
  })
})
