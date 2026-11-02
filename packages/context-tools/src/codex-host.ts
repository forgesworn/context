import { hostProcess, type HostFactory } from './agent-host.js'
export type { AgentHost, HostEvent, HostFactory, HostRequest } from './agent-host.js'

/** A narrow client of the installed harness. Never supplies policy/model overrides. */
export function codexHost(executable: string, maxRunSeconds: number): HostFactory {
  return async (root, callbacks) => {
    const pending = new Map<number, { accept: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    let next = 0
    const rejectPending = (reason: string) => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(reason)) }
      pending.clear()
    }
    const wire = await hostProcess(executable, ['app-server', '--listen', 'stdio://'], root, maxRunSeconds, message => {
      if (typeof message.method === 'string') {
        if (message.id !== undefined) {
          if (!['string', 'number'].includes(typeof message.id)) throw new Error()
          callbacks.request({ id: message.id, method: message.method, params: message.params ?? {} })
        } else callbacks.event({ method: message.method, params: message.params ?? {} })
      } else if (typeof message.id === 'number') {
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id); clearTimeout(entry.timer)
        if (message.error) entry.reject(new Error('Host rejected ' + String(message.error.message ?? 'request').slice(0, 500)))
        else entry.accept(message.result)
      } else throw new Error()
    }, reason => { rejectPending(reason); callbacks.lost(reason) })
    const request = (method: string, params: unknown) => new Promise<any>((accept, reject) => {
      const id = ++next
      const timer = setTimeout(() => { rejectPending('Host request timed out; outcome may be unknown'); callbacks.lost('Host request timeout'); void wire.close() }, 60000)
      pending.set(id, { accept, reject, timer })
      try { wire.send({ id, method, params }) } catch (error) { pending.delete(id); clearTimeout(timer); reject(error) }
    })
    const close = async () => { rejectPending('Host connection closed'); await wire.close() }
    try {
      await request('initialize', { clientInfo: { name: 'z1p_console', title: 'Z1P local task console', version: '1' }, capabilities: { experimentalApi: true } })
      wire.send({ method: 'initialized', params: {} })
      return { request, respond: (id, result) => wire.send({ id, result }), reject: id => wire.send({ id, error: { code: -32601, message: 'This client cannot handle this request; no action approved' } }), close }
    } catch (error) { await close(); throw error }
  }
}
