import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRepositorySessionServer, type RepositorySessionOptions } from './repository-session-mcp.js'

const MAX_INPUT = 131072
const requestSchema = z.object({
  id: z.union([z.string().max(64), z.number().int().safe()]),
  name: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()).default({}),
}).strict()
const taskSchema = z.object({
  slot: z.string(), label: z.string(), task: z.string(), paths: z.array(z.string()),
  state: z.enum(['working', 'blocked', 'reviewing', 'done']),
  expectedRevision: z.number(), ttlSeconds: z.number().default(900),
})
type Task = z.infer<typeof taskSchema>
export interface RepositoryShellOptions extends RepositorySessionOptions {
  root: string
  task?: { label: string; task: string; paths: string[] }
}

export async function writeRepositoryShellFrame(output: Writable, value: unknown): Promise<void> {
  if (output.destroyed || output.writableEnded) throw new Error('shell output is closed')
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => { output.off('close', closed); output.off('error', failed) }
    const complete = (error?: Error | null) => {
      if (settled) return
      settled = true
      if (error) {
        // Node may emit error after its write callback. Keep the listener until
        // close so that a rejected callback cannot cause an unhandled event.
        if (output.closed) cleanup(); else output.once('close', cleanup)
        reject(error)
      } else { cleanup(); resolve() }
    }
    const closed = () => complete(new Error('shell output closed during write'))
    const failed = (error: Error) => complete(error)
    output.once('close', closed); output.on('error', failed)
    try { output.write(JSON.stringify(value) + '\n', complete) }
    catch (error) { cleanup(); complete(error instanceof Error ? error : new Error('shell output failed')) }
  })
}

/** A local, task-scoped shell transport over the maintained MCP server. */
export async function runRepositoryShell(options: RepositoryShellOptions, input: Readable, output: Writable) {
  if (options.task && !options.cacheDirectory) throw new Error('connect task activity requires --cache-dir')
  // Input can fail while startup awaits RPC or output, before its iterator is
  // listening. Preserve the stream's stored error without an uncaught event.
  const inputError = () => {}
  const outputError = (error: Error) => { input.destroy(error) }
  const outputClosed = () => { input.destroy(new Error('shell output is closed')) }
  input.on('error', inputError); output.on('error', outputError); output.on('close', outputClosed)
  const unbind = () => {
    const releaseInput = () => input.off('error', inputError)
    const releaseOutput = () => { output.off('error', outputError); output.off('close', outputClosed) }
    if (input.destroyed && !input.closed) input.once('close', releaseInput); else releaseInput()
    if (output.destroyed && !output.closed) output.once('close', releaseOutput); else releaseOutput()
  }
  const session = await createRepositorySessionServer(options).catch(error => { unbind(); throw error })
  const client = new Client({ name: 'z1p-shell', version: '1' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const tasks = new Map<string, Task>()
  const primarySlot = 'shell-' + randomUUID()
  let renewAt = 0
  let finishAttempted = false
  const emit = (value: unknown) => writeRepositoryShellFrame(output, value)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    if (args.expectedRoot !== undefined && args.expectedRoot !== options.root) throw new Error('connect is bound to its selected checkout; open another connection for another root')
    const result = await client.callTool({ name, arguments: { ...args, expectedRoot: options.root } }, undefined, { timeout: 60_000 })
    let value: unknown = result
    if (Array.isArray(result.content) && result.content.length === 1 && result.content[0].type === 'text') {
      try { value = JSON.parse(result.content[0].text) } catch { value = result.content[0].text }
    }
    if (!result.isError && name === 'repository_activity') {
      const task = taskSchema.parse(args)
      const agent = (value as { agent: { revision: number } }).agent
      tasks.set(task.slot, { ...task, expectedRevision: agent.revision })
      if (task.slot === primarySlot) renewAt = Date.now() + task.ttlSeconds * 500
    }
    return { result: value, isError: result.isError === true }
  }
  const finish = async () => {
    finishAttempted = true
    const results = []
    for (const task of tasks.values()) {
      if (task.state === 'done') continue
      try { results.push({ slot: task.slot, ...await call('repository_activity', { ...task, state: 'done' }) }) }
      catch {
        results.push({ slot: task.slot, isError: true,
          result: 'activity finish outcome unknown; inspect coordination before retrying this slot' })
      }
    }
    return results
  }
  try {
    await session.server.connect(serverSide)
    await client.connect(clientSide)
    const tools = (await client.listTools()).tools
    const names = new Set(tools.map(tool => tool.name))
    const status = await call('repository_status')
    if (status.isError) throw new Error(String(status.result))
    const coordination = options.cacheDirectory ? await call('repository_coordination') : undefined
    if (coordination?.isError) throw new Error(String(coordination.result))
    let activity
    if (options.task) {
      activity = await call('repository_activity', {
        ...options.task, slot: primarySlot, state: 'working', expectedRevision: 0, ttlSeconds: 900,
      })
      if (activity.isError) throw new Error(String(activity.result))
    }
    await emit({ event: 'ready', root: options.root, tools: tools.map(tool => tool.name), status: status.result,
      coordination: coordination?.result, activity: activity?.result,
      transport: 'local-shell', nativeToolDiscovery: false })

    // One bounded line at a time; no unbounded readline buffer or request queue.
    let line = Buffer.alloc(0), discarded = false
    for await (const part of input) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      let start = 0
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] !== 10) continue
        const end = chunk.subarray(start, i)
        if (discarded || line.length + end.length > MAX_INPUT) {
          await emit({ id: null, isError: true, result: 'request exceeds 131072 bytes' })
        } else {
          let id: string | number | null = null
          try {
            const request = requestSchema.parse(JSON.parse(Buffer.concat([line, end]).toString('utf8')))
            id = request.id
            if (request.name === 'tools') {
              if (Object.keys(request.arguments).length) throw new Error('tools accepts no arguments')
              await emit({ id, result: tools, isError: false })
              line = Buffer.alloc(0); discarded = false; start = i + 1
              continue
            }
            if (request.name === 'close') {
              if (Object.keys(request.arguments).length) throw new Error('close accepts no arguments')
              const finished = await finish()
              await emit({ id, result: { closed: true, finished }, isError: finished.some(row => row.isError) })
              return
            }
            if (!names.has(request.name)) throw new Error('repository tool is unavailable')
            if (request.arguments.expectedRoot !== undefined && request.arguments.expectedRoot !== options.root) throw new Error('connect is bound to its selected checkout; open another connection for another root')
            // Renew the primary task on explicit work steps, never in an idle timer.
            const task = tasks.get(primarySlot)
            if (task && task.state !== 'done' && Date.now() >= renewAt && request.name !== 'repository_activity') {
              const renewed = await call('repository_activity', task)
              if (renewed.isError) throw new Error('activity renewal failed; read and reconcile before continuing')
            }
            await emit({ id, ...await call(request.name, request.arguments) })
          } catch (error) {
            await emit({ id, isError: true, result: error instanceof Error ? error.message : 'invalid request' })
          }
        }
        line = Buffer.alloc(0); discarded = false; start = i + 1
      }
      const rest = chunk.subarray(start)
      if (line.length + rest.length > MAX_INPUT) { line = Buffer.alloc(0); discarded = true }
      else if (!discarded) line = Buffer.concat([line, rest])
    }
    if (line.length || discarded) await emit({ id: null, isError: true, result: 'incomplete request; end each JSON object with a newline' })
    const finished = await finish()
    await emit({ event: 'closed', finished, isError: finished.some(row => row.isError) })
  } finally {
    try {
      // Do not replay an uncertain finish, including after output failure.
      if (!finishAttempted && tasks.size) {
        const finished = await finish()
        await emit({ event: 'closed', abnormal: true, isError: true, finished }).catch(() => {})
      }
    } finally {
      try { await client.close() } finally { try { await session.close() } finally { unbind() } }
    }
  }
}
