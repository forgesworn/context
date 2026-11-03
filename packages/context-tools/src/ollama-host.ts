import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { WorkspaceStore, workspaceKey } from './workspace-store.js'
import { hostProcess, type HostFactory } from './agent-host.js'
import { boundedText, fingerprint, helper, loadOllamaProfile } from './ollama-profile.js'

export const workerThread = /^ollama_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function ollamaHost(profile: string, directory: string, maxRunSeconds: number): HostFactory {
  return async (root, callbacks) => {
    let wire: Awaited<ReturnType<typeof hostProcess>> | undefined, closed = false, failed = false, next = 0
    const calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>(), pending = new Set<string>()
    const fail = (reason: string) => { if (closed || failed) return; failed = true; for (const c of calls.values()) { clearTimeout(c.timer); c.reject(new Error(reason)) }; calls.clear(); callbacks.lost(reason); void wire?.close() }
    const validate = (id: string | number, result: any) => { if (closed || failed || !pending.has(String(id)) || !['accept', 'decline', 'cancel'].includes(result?.decision)) throw new Error('No matching worker approval') }
    wire = await hostProcess(process.execPath, [fileURLToPath(new URL('./ollama-runner.js', import.meta.url)), profile, directory, String(maxRunSeconds)], root, maxRunSeconds, m => {
      if (m.type === 'response') { const c = calls.get(m.id); if (!c) return; calls.delete(m.id); clearTimeout(c.timer); m.error ? c.reject(new Error(String(m.error))) : c.resolve(m.result) }
      else if (m.type === 'event') callbacks.event(m.value)
      else if (m.type === 'request') { pending.add(String(m.value.id)); callbacks.request(m.value) }
      else if (m.type === 'lost') fail(String(m.reason))
      else fail('Invalid worker controller message')
    }, fail)
    return {
      request: (method, params) => new Promise((resolve, reject) => {
        if (closed || failed || !wire) { reject(new Error('Worker controller closed')); return }
        const id = ++next, timer = setTimeout(() => fail('Worker controller timed out; reconcile its receipt before another turn'), maxRunSeconds * 1000)
        calls.set(id, { resolve, reject, timer }); wire.send({ type: 'request', id, method, params })
      }),
      validateResponse: validate,
      respond: (id, result) => { validate(id, result); pending.delete(String(id)); wire!.send({ type: 'answer', id, result }) },
      reject: id => { if (pending.delete(String(id))) wire!.send({ type: 'answer', id, result: { decision: 'cancel' } }) },
      close: async () => { closed = true; for (const c of calls.values()) { clearTimeout(c.timer); c.reject(new Error('Worker controller closed')) }; calls.clear(); pending.clear(); await wire?.close() },
    }
  }
}

/** Record actual console review, without making another inference request. */
export async function reviewOllama(profilePath: string, directory: string, thread: string, turn: string, decision: 'accept' | 'changes', root: string) {
  if (!workerThread.test(thread)) throw new Error('Invalid worker task identity')
  const p = await loadOllamaProfile(profilePath, 900), store = new WorkspaceStore(directory)
  try {
    const state = store.get<any>(workspaceKey('ollama', thread))
    if (!state || state.root !== root || state.profileHash !== fingerprint(p) || state.turn !== turn || state.status !== 'completed') throw new Error('No matching worker result to review')
    if (!state.output) return // dispatch declined before a provider request
    const disposition = state.proposalDeclined ? 'rejected' : decision === 'accept' ? 'accepted' : 'partial'
    const path = join(state.output, 'review.json')
    let existing: any
    try { existing = JSON.parse(await boundedText(path, 16384, true)) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    if (existing) { if (existing.disposition !== disposition) throw new Error('Worker receipt already has another review'); return }
    await helper(p, ['review', '--output-dir', state.output, '--disposition', disposition, '--reason', 'Console owner ' + (decision === 'accept' ? 'accepted the exact result and working-tree fingerprint' : 'requested changes after reviewing this result')])
  } finally { store.close() }
}
