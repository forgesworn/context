import { spawn, fork, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

export type HostEvent = { method: string; params: any }
export type HostRequest = { id: string | number; method: string; params: any }
export interface AgentHost {
  request(method: string, params: unknown): Promise<any>
  respond(id: string | number, result: unknown): void
  reject(id: string | number): void
  close(): Promise<void>
}
export type HostFactory = (root: string, callbacks: { event: (event: HostEvent) => void; request: (request: HostRequest) => void; lost: (reason: string) => void }) => Promise<AgentHost>

/** A narrow client of the installed harness. Never supplies policy/model overrides. */
export function codexHost(executable: string, maxRunSeconds: number): HostFactory {
  return async (root, callbacks) => {
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env } })
    const pending = new Map<number, { accept: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    let next = 0, buffer = '', received = 0, stopped = false, failed = false
    let guard: ReturnType<typeof fork> | undefined
    const fail = (reason: string) => {
      if (failed || stopped) return
      failed = true
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(reason)) }
      pending.clear(); callbacks.lost(reason)
      void close()
    }
    const send = (message: unknown) => {
      if (stopped || failed || child.stdin.destroyed) throw new Error('Host connection is closed')
      const line = JSON.stringify(message) + '\n'
      if (Buffer.byteLength(line) > 131072 || child.stdin.writableLength > 262144) throw new Error('Host input limit reached')
      child.stdin.write(line)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      received += Buffer.byteLength(chunk)
      if (received > 32 * 1024 * 1024) { fail('Host output limit reached'); return }
      buffer += chunk
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { fail('Host message limit reached'); return }
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0 && !stopped && !failed) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        try {
          const message = JSON.parse(line)
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error()
          if (typeof message.method === 'string') {
            if (message.id !== undefined) {
              if (!['string', 'number'].includes(typeof message.id)) throw new Error()
              callbacks.request({ id: message.id, method: message.method, params: message.params ?? {} })
            } else callbacks.event({ method: message.method, params: message.params ?? {} })
          } else if (typeof message.id === 'number') {
            const entry = pending.get(message.id)
            if (!entry) continue
            pending.delete(message.id); clearTimeout(entry.timer)
            if (message.error) entry.reject(new Error('Host rejected ' + String(message.error.message ?? 'request').slice(0, 500)))
            else entry.accept(message.result)
          } else throw new Error()
        } catch { fail('Invalid host protocol or event processing failure') }
      }
    })
    // Drain diagnostics without forwarding arbitrary environment/auth logs into the UI.
    child.stderr.resume()
    child.on('error', () => fail('Could not start the configured Codex executable'))
    child.stdin.on('error', () => fail('Host input pipe failed'))
    child.once('exit', () => { if (!stopped) fail('Host process exited; reconcile before retrying') })
    const request = (method: string, params: unknown) => new Promise<any>((accept, reject) => {
      const id = ++next
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timed out; outcome may be unknown')); fail('Host request timeout') }, 60000)
      pending.set(id, { accept, reject, timer })
      try { send({ id, method, params }) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
    })
    async function close() {
      if (stopped) return
      stopped = true
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Host connection closed')) }
      pending.clear()
      child.stdin.end()
      await stopChild(child)
      if (guard && guard.exitCode === null && guard.signalCode === null) {
        const exited = once(guard, 'exit')
        if (guard.connected) guard.send('finished')
        await exited
      }
    }
    try {
      await new Promise<void>((accept, reject) => { child.once('spawn', accept); child.once('error', reject) })
      guard = fork(fileURLToPath(new URL('./agent-watchdog.js', import.meta.url)), [String(child.pid), String(maxRunSeconds * 1000)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] })
      await new Promise<void>((accept, reject) => { guard!.once('message', value => value === 'ready' ? accept() : reject(new Error('Invalid watchdog response'))); guard!.once('error', reject); guard!.once('exit', () => reject(new Error('Host watchdog could not start'))) })
      await request('initialize', { clientInfo: { name: 'z1p_console', title: 'Z1P local task console', version: '1' }, capabilities: { experimentalApi: true } })
      send({ method: 'initialized', params: {} })
      return { request, respond: (id, result) => send({ id, result }), reject: id => send({ id, error: { code: -32601, message: 'This client cannot handle this request; no action approved' } }), close }
    } catch (error) { await close(); throw error }
  }
}

async function stopChild(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').catch(() => {})
  const signal = (value: NodeJS.Signals) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
    try { if (process.platform === 'win32') child.kill(value); else process.kill(-child.pid, value) } catch { child.kill(value) }
  }
  signal('SIGTERM')
  const timer = setTimeout(() => signal('SIGKILL'), 1500)
  await exited; clearTimeout(timer)
}
