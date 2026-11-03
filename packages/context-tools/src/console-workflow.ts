import { createHash, randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { appendWorkflowEvent, createWorkflow, planWorkflow, type WorkflowEvent, type WorkflowRecord } from './host-workflow.js'
import { buildPacketInline, serializePacket } from './source-packet.mjs'

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
export const planInput = z.object({
  title: text(160), root: text(2048), maxConcurrent: z.number().int().min(1).max(4),
  nodes: z.array(z.object({ title: text(160), task: text(2048), host: z.enum(['codex', 'claude', 'kimi', 'ollama']),
    paths: z.array(text(512)).min(1).max(8), checks: z.array(text(512)).min(1).max(8),
    dependsOn: z.array(z.number().int().min(0).max(7)).max(7),
  }).strict()).min(1).max(8),
}).strict()
export const planReviewSchema = z.object({ evidence: text(1900), checks: z.array(z.object({
  check: text(512), outcome: z.enum(['passed', 'failed', 'unknown']), evidence: text(2048),
}).strict()).min(1).max(8) }).strict()
export type PlanReview = z.infer<typeof planReviewSchema>
export interface ConsolePlan {
  id: string; title: string; identity: string; record: WorkflowRecord; tasks: Record<string, string>
  revisionNumber?: number; supersedes?: string; supersededBy?: string; requestHash?: string
  change?: { reason: string; changed: string[]; affected: string[]; at: number }
  notices?: { taskId: string; nodeId: string; noteId: string | null; unavailable?: 'inbox_full' | 'no_registered_run' }[]
}
export interface PlannedTask { id: string; planId?: string; nodeId?: string; planAttempt?: string; planPacket?: any;
  planNeedsReconciliation?: boolean;
  root: string; title: string; host: string; paths: string[]; status: string; result: string; executionRoot?: string;
  review?: { hash: string }; accepted?: { hash: string }; worktree?: { root: string; branch: string }
  objective?: string; inbox?: { id: string; deliveredAt?: number; acknowledgedAt?: number; submittedTurn?: string }[] }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
export function newConsolePlan(input: z.infer<typeof planInput>, id: string, identity: string): ConsolePlan {
  const record = createWorkflow({ version: 1, id, root: input.root, revision: sha(JSON.stringify(input)), createdAt: Date.now(),
    nodes: input.nodes.map((node, index) => ({ id: 'step-' + (index + 1), task: node.task, paths: node.paths,
      checks: node.checks, dependsOn: node.dependsOn.map(parent => 'step-' + (parent + 1)), maxAttempts: 3,
      gate: null, effect: 'none', costLimitMicros: null })),
    budget: { maxConcurrent: input.maxConcurrent, maxAttempts: input.nodes.length * 3, maxDurationMs: 86400000, maxCostMicros: null } })
  return { id, title: input.title, identity, record, tasks: {} } satisfies ConsolePlan
}
export function planInputFrom(plan: ConsolePlan, tasks: PlannedTask[]): z.infer<typeof planInput> {
  return planInput.parse({ title: plan.title, root: plan.record.spec.root, maxConcurrent: plan.record.spec.budget.maxConcurrent,
    nodes: plan.record.spec.nodes.map(node => { const task = tasks.find(task => task.id === plan.tasks[node.id])!; return {
      title: task.title, task: node.task, host: task.host, paths: node.paths, checks: node.checks,
      dependsOn: node.dependsOn.map(id => plan.record.spec.nodes.findIndex(node => node.id === id)),
    } }) })
}
export function planChanges(before: z.infer<typeof planInput>, after: z.infer<typeof planInput>) {
  if (before.root !== after.root) throw new Error('A revision must keep the same selected checkout')
  const all = Array.from({ length: Math.max(before.nodes.length, after.nodes.length) }, (_, i) => 'step-' + (i + 1))
  const global = before.title !== after.title || before.maxConcurrent !== after.maxConcurrent
  const changed = all.filter((_, index) => global || JSON.stringify(before.nodes[index]) !== JSON.stringify(after.nodes[index]))
  if (!changed.length) throw new Error('Change the plan requirements before saving a revision')
  const affected = new Set(changed)
  for (let round = 0; round < 8; round++) for (const input of [before, after]) input.nodes.forEach((node, index) => {
    if (node.dependsOn.some(parent => affected.has('step-' + (parent + 1)))) affected.add('step-' + (index + 1))
  })
  return { changed, affected: all.filter(id => affected.has(id)) }
}
export function observePlan(plan: ConsolePlan) {
  return { root: plan.record.spec.root, revision: plan.record.spec.revision, now: Date.now(), approvals: [] }
}
function append(plan: ConsolePlan, event: WorkflowEvent) {
  plan.record = appendWorkflowEvent(plan.record, event, plan.record.events.length, observePlan(plan))
}
export function startPlan(plan: ConsolePlan, task: PlannedTask, attempt: string, packet: any) {
  append(plan, { id: randomUUID(), type: 'start', at: Date.now(), actor: task.id, node: task.nodeId!, attempt,
    packetSha256: sha(serializePacket(packet)), approvalEvidence: null })
  task.planAttempt = attempt; task.planPacket = packet
}
export function unresolvedPlan(plan: ConsolePlan, task: PlannedTask) {
  if (!task.planAttempt || plan.record.events.some(e => e.type === 'result' && e.attempt === task.planAttempt)) return
  append(plan, { id: randomUUID(), type: 'result', at: Date.now(), actor: task.id, node: task.nodeId!, attempt: task.planAttempt,
    outcome: 'unknown', failure: null, checks: [], findings: [], usage: { inputTokens: null, outputTokens: null, costMicros: null } })
}
export function reviewPlan(plan: ConsolePlan, task: PlannedTask, accepted: boolean, review: PlanReview) {
  if (!task.planAttempt) throw new Error('No workflow attempt to review')
  append(plan, { id: randomUUID(), type: 'result', at: Date.now(), actor: task.id, node: task.nodeId!, attempt: task.planAttempt,
    outcome: 'succeeded', failure: null, checks: review.checks, findings: [], usage: { inputTokens: null, outputTokens: null, costMicros: null } })
  append(plan, { id: randomUUID(), type: 'review', at: Date.now(), actor: 'console-owner', node: task.nodeId!, attempt: task.planAttempt,
    accepted, evidence: review.evidence + '\nWorking-tree review: ' + task.review!.hash })
}
export function reconcilePlan(plan: ConsolePlan, task: PlannedTask, evidence: string) {
  if (!task.planAttempt) throw new Error('No workflow attempt to reconcile')
  append(plan, { id: randomUUID(), type: 'reconcile', at: Date.now(), actor: 'console-owner', node: task.nodeId!, attempt: task.planAttempt,
    resolution: 'retry_safe', evidence })
}
export function planView(plan: ConsolePlan, tasks: PlannedTask[]) {
  const state = planWorkflow(plan.record, observePlan(plan))
  const ready = plan.supersededBy ? [] : state.ready.filter(id => !tasks.find(task => task.id === plan.tasks[id])!.planNeedsReconciliation)
  return { id: plan.id, title: plan.title, root: plan.record.spec.root, revision: plan.record.spec.revision,
    revisionNumber: plan.revisionNumber ?? 1, supersedes: plan.supersedes, supersededBy: plan.supersededBy, change: plan.change,
    notices: (plan.notices ?? []).map(notice => { const task = tasks.find(task => task.id === notice.taskId)!, note = task.inbox?.find(note => note.id === notice.noteId); return {
      ...notice, title: task.title, host: task.host,
      delivery: notice.unavailable ?? (note?.acknowledgedAt ? 'acknowledged' : note?.deliveredAt ? 'stored_in_shared_inbox' : 'queued'),
    } }),
    createdAt: plan.record.spec.createdAt, budget: plan.record.spec.budget, ready, stopReasons: state.stopReasons,
    reportedComplete: !plan.supersededBy && state.reportedComplete, historicallyComplete: state.reportedComplete, metrics: state.metrics,
    nodes: plan.record.spec.nodes.map(node => {
      const task = tasks.find(task => task.id === plan.tasks[node.id])!, status = state.nodes.find(item => item.id === node.id)!
      const missing = node.dependsOn.filter(id => state.nodes.find(item => item.id === id)!.state !== 'accepted')
      const result = plan.record.events.filter((e): e is Extract<WorkflowEvent, { type: 'result' }> => e.type === 'result' && e.node === node.id).at(-1)
      return { ...node, ...status, ready: ready.includes(node.id), taskId: task.id, title: task.title, host: task.host, taskStatus: task.status,
        executionRoot: task.worktree?.root ?? task.root, branch: task.worktree?.branch,
        checks: node.checks.map(check => result?.checks.find(item => item.check === check) ?? { check, outcome: 'unknown', evidence: 'No check receipt recorded' }),
        blockers: plan.supersededBy ? ['Previous requirements revision; open the current revision'] : task.planNeedsReconciliation ? ['Previous preparation or run needs explicit reconciliation'] : missing.length ? ['Waiting for accepted result: ' + missing.join(', ')] : state.stopReasons.length ? state.stopReasons :
          ['pending', 'retryable'].includes(status.state) && !state.ready.includes(node.id) ? ['Waiting for plan capacity or overlapping paths'] : [],
        reviewGate: 'Owner review of this exact result and check evidence is required before dependent steps become ready',
      }
    }) }
}
export function assertPlanReady(plan: ConsolePlan, task: PlannedTask) {
  if (plan.supersededBy) throw new Error('Plan requirements were superseded; open the current revision')
  if (!planWorkflow(plan.record, observePlan(plan)).ready.includes(task.nodeId!)) throw new Error('Plan step is blocked. Review dependencies, overlaps, limits or unresolved outcomes first.')
}
export async function planPacket(root: string, task: { paths: string[]; objective: string }, checks: string[]) {
  const sources = []
  for (const path of task.paths) {
    const info = await lstat(join(root, path)).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined })
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16000) throw new Error('Plan sources must be explicit regular files of at most 16,000 bytes')
    sources.push({ path, startLine: 1, endLine: 16001 })
  }
  if (!sources.length) throw new Error('A plan step needs at least one existing source file')
  const packet = await buildPacketInline({ root, spec: { version: 1, task: task.objective, sources, allowedFiles: task.paths,
    acceptanceChecks: checks, exclusions: [], unresolvedQuestions: [] }, clampToEnd: true })
  if (Buffer.byteLength(serializePacket(packet)) > 48000) throw new Error('Plan source packet exceeds 48,000 bytes; select smaller files')
  return packet
}
export function packetFingerprint(packet: any) { return sha(serializePacket(packet)) }
