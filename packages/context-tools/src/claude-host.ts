import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { hostProcess, type HostFactory } from './agent-host.js'

const uuid = z.string().uuid()
const record = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const smallString = (value: any) => typeof value === 'string' && value.length > 0 && value.length <= 256

/** Installed Claude Code stream-json/control protocol. No SDK runtime or policy overrides. */
export function claudeHost(executable: string, maxRunSeconds: number): HostFactory {
  return async (root, callbacks) => {
    let wire: Awaited<ReturnType<typeof hostProcess>> | undefined
    let opening: ReturnType<typeof hostProcess> | undefined
    let closed = false, failed = false, terminal = false, thread = '', turn = '', model = '', stopping = false
    const controls = new Map<string, { accept: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const approvals = new Map<string, { input: Record<string, any>; questions?: any[] }>()
    const tools = new Map<string, { name: string; input: unknown }>()
    const event = (method: string, params: any) => callbacks.event({ method, params: { threadId: thread, turnId: turn || undefined, ...params } })
    const rejectControls = (reason: string) => { for (const c of controls.values()) { clearTimeout(c.timer); c.reject(new Error(reason)) }; controls.clear() }
    const fail = (reason: string) => {
      if (closed || failed || terminal) return
      failed = true; rejectControls(reason); approvals.clear(); callbacks.lost(reason); void wire?.close()
    }
    const send = (message: unknown) => { if (closed || failed || !wire) throw new Error('Claude connection closed'); wire.send(message) }
    const reply = (id: string, response: unknown) => send({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })
    const deny = (id: string, interrupt = false) => reply(id, { behavior: 'deny', message: 'Owner did not approve this request.', ...(interrupt ? { interrupt: true } : {}) })
    const control = (request: unknown) => new Promise<any>((accept, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => { rejectControls('Claude control request timeout; outcome unknown'); fail('Claude control request timeout') }, 60000)
      controls.set(id, { accept, reject, timer })
      try { send({ type: 'control_request', request_id: id, request }) } catch (error) { controls.delete(id); clearTimeout(timer); reject(error) }
    })
    function receive(m: any) {
      if (closed || failed || terminal) return
      if (m.type === 'control_response') {
        const response = m.response, c = controls.get(response?.request_id)
        if (!c) return
        controls.delete(response.request_id); clearTimeout(c.timer)
        if (response.subtype === 'success') c.accept(response.response)
        else c.reject(new Error('Claude rejected the control request'))
        return
      }
      if (m.type === 'control_cancel_request') {
        if (approvals.delete(m.request_id)) event('serverRequest/resolved', { requestId: m.request_id })
        return
      }
      if (m.type === 'control_request') {
        if (!smallString(m.request_id) || !record(m.request)) throw new Error()
        const r = m.request
        if (!turn || r.subtype !== 'can_use_tool' || !smallString(r.tool_name) || !record(r.input) || ['ExitPlanMode', 'EnterPlanMode'].includes(r.tool_name)) {
          send({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'Unsupported interaction; no permission granted' } })
          fail('Claude requested an unsupported interaction; reconcile in its native client'); return
        }
        if (approvals.has(m.request_id) || approvals.size >= 8 || Buffer.byteLength(JSON.stringify(r.input)) > 24000) { deny(m.request_id); fail('Claude tool request bound exceeded'); return }
        if (r.tool_name === 'AskUserQuestion') {
          const questions = r.input.questions
          if (!Array.isArray(questions) || !questions.length || questions.length > 3 || questions.some(q => !record(q) || !smallString(q.header) || typeof q.question !== 'string' || q.question.length > 2000 || q.isSecret || (q.options !== undefined && (!Array.isArray(q.options) || q.options.length > 8 || q.options.some((o: any) => !record(o) || !smallString(o.label) || typeof o.description !== 'string' || o.description.length > 2000))))) {
            deny(m.request_id); fail('Unsupported Claude question; reconcile in its native client'); return
          }
          approvals.set(m.request_id, { input: r.input, questions })
          callbacks.request({ id: m.request_id, method: 'item/tool/requestUserInput', params: { threadId: thread, turnId: turn, questions: questions.map((q, i) => ({ ...q, id: 'q' + i, isSecret: false })) } })
        } else {
          approvals.set(m.request_id, { input: r.input })
          callbacks.request({ id: m.request_id, method: 'claude/tool/requestApproval', params: { threadId: thread, turnId: turn, tool: r.tool_name, input: r.input, cwd: root } })
        }
        return
      }
      // Only session-specific model/tool/result messages can affect a turn.
      if (['assistant', 'user', 'result', 'stream_event'].includes(m.type) && (!turn || m.session_id !== thread)) { fail('Claude message does not match the owned session'); return }
      if (m.type === 'system' && m.subtype === 'init') {
        if (m.session_id !== thread || m.cwd !== root || m.model !== model) fail('Claude effective session/model changed; reconcile before continuing')
      } else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta' && typeof m.event.delta.text === 'string') {
        event('item/agentMessage/delta', { delta: m.event.delta.text })
      } else if (m.type === 'assistant') {
        if (!Array.isArray(m.message?.content)) throw new Error()
        const text = m.message.content.filter((c: any) => c.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n')
        if (text) event('item/completed', { item: { type: 'agentMessage', text } })
        for (const c of m.message.content) if (c.type === 'tool_use') {
          if (!smallString(c.id) || !smallString(c.name) || tools.size >= 64 || Buffer.byteLength(JSON.stringify(c.input)) > 131072) { fail('Claude tool event bound exceeded'); return }
          tools.set(c.id, { name: c.name, input: c.input })
        }
      } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
        for (const c of m.message.content) if (c.type === 'tool_result') {
          const tool = tools.get(c.tool_use_id)
          if (!tool) continue
          tools.delete(c.tool_use_id)
          event('item/completed', { item: { type: 'hostTool', tool: tool.name, input: tool.input, output: c.content, isError: c.is_error === true } })
        }
      } else if (m.type === 'result') {
        // An interrupt ack or a success racing with Stop does not prove interruption.
        if (stopping) { fail('Claude ended after Stop without a qualified interruption receipt; reconcile its saved session'); return }
        terminal = true; approvals.clear()
        if (typeof m.result === 'string') event('item/completed', { item: { type: 'agentMessage', text: m.result } })
        event('turn/completed', { turn: { id: turn, status: m.subtype === 'success' && m.is_error === false ? 'completed' : 'failed', error: m.is_error ? { message: 'Claude reported ' + String(m.subtype) } : null } })
      }
    }
    return {
      request: async (method, params: any) => {
        if (closed || failed) throw new Error('Claude connection closed')
        if (method === 'thread/start' || method === 'thread/resume') {
          if (wire || thread || params.cwd !== root) throw new Error('Claude session already initialised or checkout mismatch')
          thread = method === 'thread/resume' ? uuid.parse(params.threadId) : randomUUID()
          const args = ['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--permission-prompt-tool', 'stdio', method === 'thread/resume' ? '--resume=' + thread : '--session-id=' + thread]
          opening = hostProcess(executable, args, root, maxRunSeconds, receive, fail)
          wire = await opening
          if (closed || failed) { await wire.close(); throw new Error('Claude start cancelled') }
          const init = await control({ subtype: 'initialize' })
          const settings = await control({ subtype: 'get_settings' })
          model = settings?.applied?.model
          const provider = init?.account?.apiProvider, policy = init?.current_permission_mode
          if (!smallString(model) || !smallString(provider) || !smallString(policy) || init?.session_state !== 'idle') throw new Error('Claude cannot report effective settings or idle session before execution')
          // Keep credentials, environment, account identity and full native settings out of the journal/UI.
          const sandbox = settings?.effective?.sandbox
          return { cwd: root, thread: { id: thread, cwd: root, status: { type: 'idle' } }, model, modelProvider: provider, approvalPolicy: policy, sandbox: record(sandbox) ? { enabled: sandbox.enabled === true, autoAllowBashIfSandboxed: sandbox.autoAllowBashIfSandboxed === true } : 'Not reported by native host' }
        }
        if (method === 'turn/start') {
          if (!wire || !model || turn || params.threadId !== thread || !Array.isArray(params.input) || params.input.length !== 1 || typeof params.input[0]?.text !== 'string') throw new Error('Invalid Claude turn')
          turn = randomUUID()
          send({ type: 'user', session_id: thread, message: { role: 'user', content: params.input[0].text }, parent_tool_use_id: null })
          return { turn: { id: turn, status: 'inProgress' } }
        }
        if (method === 'turn/interrupt' && turn && params.threadId === thread && params.turnId === turn) { stopping = true; return control({ subtype: 'interrupt' }) }
        throw new Error('Unsupported Claude host operation')
      },
      respond: (id, result: any) => {
        if (typeof id !== 'string') throw new Error('Unknown Claude approval')
        const pending = approvals.get(id)
        if (!pending) throw new Error('Claude request is no longer pending')
        if (pending.questions) {
          const answers: Record<string, string> = Object.create(null)
          for (const [i, q] of pending.questions.entries()) {
            const answer = result?.answers?.['q' + i]?.answers
            if (!Array.isArray(answer) || answer.length !== 1 || typeof answer[0] !== 'string') throw new Error('Invalid question answer')
            answers[q.question] = answer[0]
          }
          reply(id, { behavior: 'allow', updatedInput: { ...pending.input, answers } })
        } else if (result?.decision === 'accept') reply(id, { behavior: 'allow', updatedInput: pending.input })
        else if (['decline', 'cancel'].includes(result?.decision)) deny(id, result.decision === 'cancel')
        else throw new Error('Invalid Claude decision')
        approvals.delete(id)
      },
      reject: id => { if (typeof id === 'string' && approvals.has(id)) { deny(id); approvals.delete(id) } },
      close: async () => { closed = true; rejectControls('Claude connection closed'); approvals.clear(); const owned = wire ?? await opening?.catch(() => undefined); await owned?.close() },
    }
  }
}
