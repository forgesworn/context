import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { lstatSync, realpathSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { formatHandoverError, resumeHandover, saveHandoverRecord } from './task-handover.mjs'
import type { RepositoryNavigation } from './repository-navigation.js'
import type { PacketReferences } from './repository-packet-references.js'

const nameSchema = z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/)
  .describe('New checkpoint filename ending .json, for example queue-cancellation-001.json. Never overwrites.')
const identitySchema = z.object({ expectedRoot: z.string(), name: nameSchema }).strict()
const stateText = z.string().min(1).max(2048)
const stateTexts = z.array(stateText).max(32)
const stateSchema = z.object({
  version: z.literal(1), status: z.enum(['in_progress', 'blocked', 'ready_for_review']),
  completed: stateTexts, decisions: stateTexts,
  checks: z.array(z.object({ index: z.number().int().nonnegative(), outcome: z.enum(['passed', 'failed', 'not_run', 'unknown']),
    evidence: stateText.nullable(),
  }).strict()).describe('Exactly one result per packet acceptanceChecks entry, identified by zero-based index. Passed/failed results need actual evidence.'),
  unresolvedQuestions: stateTexts, pendingEffects: stateTexts, nextAction: stateText,
}).strict()
const saveSchema = identitySchema.extend({
  packetId: z.string().regex(/^packet-[a-f0-9-]{36}$/).optional().describe('Prefer the packetId returned by a fresh repository_packet in this connection; do not copy source into the request.'),
  packet: z.record(z.string(), z.unknown()).optional().describe('Legacy complete JSON packet. Supply exactly one of packetId or packet.'),
  state: stateSchema,
}).strict().refine(value => (value.packetId !== undefined) !== (value.packet !== undefined), 'Supply exactly one of packetId or packet')

export function checkHandoverDirectory(directory: string): void {
  try {
    const info = lstatSync(directory)
    if (!isAbsolute(directory) || resolve(directory) !== directory || realpathSync(directory) !== directory ||
      !info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error()
  } catch { throw new Error('handover directory must be an existing canonical private directory (mode 0700 on POSIX)') }
}

/** Explicitly enabled file operations, separate from read-only repository discovery. */
export function registerRepositoryHandovers(server: McpServer, root: string, directory: string,
  packetSource?: { navigation: RepositoryNavigation; references: PacketReferences }): void {
  checkHandoverDirectory(directory)
  const location = (expectedRoot: string, name: string, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (expectedRoot !== root) throw new Error('task-handover: repository binding does not match expectedRoot')
    checkHandoverDirectory(directory)
    return join(directory, name)
  }
  const response = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const failure = (error: unknown) => ({ content: [{ type: 'text' as const, text: formatHandoverError(error) }], isError: true })
  server.registerTool('repository_handover_save', {
    description: 'Save a fresh repository_packet packetId and typed progress to a new private .json checkpoint. No source echo needed. Legacy full packet accepted. Requires configured storage. Never overwrites or executes checks; results remain assertions.',
    inputSchema: saveSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input, extra) => {
    try {
      const out = location(input.expectedRoot, input.name, extra.signal)
      let packet = input.packet
      if (input.packetId !== undefined) {
        if (!packetSource) throw new Error('task-handover: packet references unavailable on this connection')
        const status = await packetSource.navigation.status(extra.signal)
        if (status.freshness !== 'current' || status.policy.freshness !== 'current' || !status.generation) {
          throw new Error('task-handover: packet reference requires current source; refresh and retrieve a new packet')
        }
        packet = packetSource.references.resolve(input.packetId, root, status.generation)
      }
      if (Buffer.byteLength(JSON.stringify(packet)) > 65536 || Buffer.byteLength(JSON.stringify(input.state)) > 16384) {
        throw new Error('task-handover: packet or state too large')
      }
      return response(await saveHandoverRecord({ root, packet, state: input.state, out, signal: extra.signal }))
    } catch (error) { return failure(error) }
  })
  server.registerTool('repository_handover_resume', {
    description: 'Read a named private checkpoint after verifying current selected sources and checkout. Returns progress and evidence locations, not source excerpts or execution authority.',
    inputSchema: identitySchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input, extra) => {
    try {
      const handover = location(input.expectedRoot, input.name, extra.signal)
      return response(await resumeHandover({ root, handover }))
    } catch (error) { return failure(error) }
  })
}
