import { spawn, fork, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

// Internal console contract; native wire formats remain adapter-owned.
export type HostEvent = { method: string; params: any }
export type HostRequest = { id: string | number; method: string; params: any }
export interface AgentHost {
  request(method: string, params: unknown): Promise<any>
  respond(id: string | number, result: unknown): void
  reject(id: string | number): void
  validateResponse?(id: string | number, result: unknown): void
  close(): Promise<void>
}
export type HostFactory = (root: string, callbacks: { event: (event: HostEvent) => void; request: (request: HostRequest) => void; lost: (reason: string) => void }) => Promise<AgentHost>

/** Bounded, newly owned process. Executable and argv are operator/adapter-owned. */
export async function hostProcess(executable: string, args: string[], root: string, maxRunSeconds: number, receive: (message: any) => void, lost: (reason: string) => void) {
  const child = spawn(executable, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env } })
  let buffer = '', received = 0, stopped = false, failed = false, closing: Promise<void> | undefined
  let guard: ReturnType<typeof fork> | undefined
  const fail = (reason: string) => {
    if (failed || stopped) return
    failed = true; lost(reason); void close()
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
        receive(message)
      } catch { fail('Invalid host protocol or event processing failure') }
    }
  })
  // Native diagnostics may contain credentials/settings; never forward them.
  child.stderr.resume()
  child.on('error', () => fail('Could not start the configured host executable'))
  child.stdin.on('error', () => fail('Host input pipe failed'))
  child.once('exit', () => { if (!stopped) fail('Host process exited; reconcile before retrying') })
  function close() {
    if (closing) return closing
    stopped = true
    closing = (async () => {
      child.stdin.end()
      await stopChild(child)
      if (guard && guard.exitCode === null && guard.signalCode === null) {
        const exited = once(guard, 'exit')
        if (guard.connected) guard.send('finished')
        await exited
      }
    })()
    return closing
  }
  try {
    await new Promise<void>((accept, reject) => { child.once('spawn', accept); child.once('error', reject) })
    guard = fork(fileURLToPath(new URL('./agent-watchdog.js', import.meta.url)), [String(child.pid), String(maxRunSeconds * 1000)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] })
    await new Promise<void>((accept, reject) => { guard!.once('message', value => value === 'ready' ? accept() : reject(new Error('Invalid watchdog response'))); guard!.once('error', reject); guard!.once('exit', () => reject(new Error('Host watchdog could not start'))) })
    if (stopped || failed) throw new Error('Host closed during startup')
    return { send, close }
  } catch (error) { await close(); throw error }
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
