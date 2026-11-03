import { createHash, createHmac } from 'node:crypto'
import { basename } from 'node:path'
import type { DashboardTicket } from './workspace-dashboard.js'

/** A separate, read-only capability. Never disclose the dashboard/control URL. */
export function girnelObservationPath(ticket: DashboardTicket, secret: Buffer): string {
  if (!ticket.girnel) throw new Error('A selected Girnel card is required')
  return '/girnel-observation/' + createHmac('sha256', secret).update(ticket.id).digest('hex')
}

export function girnelObservation(ticket: DashboardTicket, observedAt: number, complete: boolean) {
  if (!ticket.girnel) throw new Error('A selected Girnel card is required')
  return {
    format: 'z1p-girnel-observation', version: 1,
    boardId: ticket.girnel.boardId, cardId: ticket.girnel.cardId,
    observedAt, complete, lane: ticket.lane,
    // Explicitly selected activity only: no absolute checkout roots, source,
    // inboxes, checkpoints, console journal or credentials cross this boundary.
    agents: ticket.agents.map(agent => ({
      checkoutId: createHash('sha256').update(agent.checkoutRoot).digest('hex'), checkoutName: basename(agent.checkoutRoot),
      agentId: agent.agentId, label: agent.label, task: agent.task,
      state: agent.state, active: agent.active, branch: agent.branch, head: agent.head,
      paths: agent.paths, updatedAt: agent.updatedAt, expiresAt: agent.expiresAt,
    })),
  }
}
