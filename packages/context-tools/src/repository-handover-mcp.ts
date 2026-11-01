import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { lstatSync, realpathSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { formatHandoverError, resumeHandover, saveHandoverRecord } from './task-handover.mjs'

const nameSchema = z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/)
const identitySchema = z.object({ expectedRoot: z.string(), name: nameSchema }).strict()
const saveSchema = identitySchema.extend({
  packet: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.unknown()),
}).strict()

/** Explicitly enabled file operations, separate from read-only repository discovery. */
export function registerRepositoryHandovers(server: McpServer, root: string, directory: string): void {
  const checkDirectory = () => {
    try {
      const info = lstatSync(directory)
      if (!isAbsolute(directory) || resolve(directory) !== directory || realpathSync(directory) !== directory ||
        !info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error()
    } catch { throw new Error('handover directory must be an existing canonical private directory (mode 0700 on POSIX)') }
  }
  checkDirectory()
  const location = (expectedRoot: string, name: string, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (expectedRoot !== root) throw new Error('task-handover: repository binding does not match expectedRoot')
    checkDirectory()
    return join(directory, name)
  }
  const response = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const failure = (error: unknown) => ({ content: [{ type: 'text' as const, text: formatHandoverError(error) }], isError: true })
  server.registerTool('repository_handover_save', {
    description: 'Save a verified current packet and supplied progress to a new private checkpoint. Requires configured handover storage. Never overwrites or executes checks; results remain assertions.',
    inputSchema: saveSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input, extra) => {
    try {
      const out = location(input.expectedRoot, input.name, extra.signal)
      if (Buffer.byteLength(JSON.stringify(input.packet)) > 65536 || Buffer.byteLength(JSON.stringify(input.state)) > 16384) {
        throw new Error('task-handover: packet or state too large')
      }
      return response(await saveHandoverRecord({ root, packet: input.packet, state: input.state, out, signal: extra.signal }))
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
