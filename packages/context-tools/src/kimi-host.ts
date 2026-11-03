import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { hostProcess, type HostFactory } from './agent-host.js'

const sessionId = z.string().regex(/^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: any, max = 256) => typeof v === 'string' && v.length > 0 && v.length <= max
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const scope = (tool: any) => hash([tool.rawInput, tool.kind, tool.locations, tool.content])
type Field = { key: string; id: string; question: string; valueType: 'text' | 'choice' | 'array'; options?: { label: string; description: string }[]; min: number; max: number }
type Pending = { fields: Field[] } | { toolId: string; hash: string; allow: string; decline: string }

/** Installed Kimi ACP client. Never advertises client filesystem, terminal or auth execution. */
export function kimiHost(executable: string, maxRunSeconds: number): HostFactory {
  return async (root, callbacks) => {
    let wire: Awaited<ReturnType<typeof hostProcess>> | undefined, opening: ReturnType<typeof hostProcess> | undefined
    let closed = false, failed = false, terminal = false, thread = '', turn = '', output = '', modelValue = '', mode = '', next = 0, stopping = false
    const calls = new Map<number, { accept: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    const pending = new Map<string | number, Pending>(), tools = new Map<string, any>()
    const event = (method: string, params: any) => callbacks.event({ method, params: { threadId: thread, turnId: turn, ...params } })
    const rejectCalls = (reason: string) => { for (const c of calls.values()) { clearTimeout(c.timer); c.reject(new Error(reason)) }; calls.clear() }
    const fail = (reason: string) => { if (closed || failed || terminal) return; failed = true; rejectCalls(reason); pending.clear(); callbacks.lost(reason); void wire?.close() }
    const send = (message: unknown) => { if (closed || failed || !wire) throw new Error('Kimi connection closed'); wire.send(message) }
    const reply = (id: string | number, result: unknown) => send({ jsonrpc: '2.0', id, result })
    const cancel = (id: string | number) => reply(id, pending.get(id) && 'fields' in pending.get(id)! ? { action: 'cancel' } : { outcome: { outcome: 'cancelled' } })
    const rpc = (method: string, params: unknown, seconds = 60) => new Promise<any>((accept, reject) => {
      const id = ++next, timer = setTimeout(() => fail('Kimi request timed out; reconcile before retrying'), seconds * 1000)
      calls.set(id, { accept, reject, timer })
      try { send({ jsonrpc: '2.0', id, method, params }) } catch (error) { calls.delete(id); clearTimeout(timer); reject(error) }
    })
    function validate(id: string | number, result: any) {
      const p = pending.get(id)
      if (!p || closed || failed || terminal) throw new Error('Kimi request is no longer pending')
      if ('fields' in p) {
        if (['decline', 'cancel'].includes(result?.decision)) return
        for (const f of p.fields) {
          const answer = result?.answers?.[f.id]?.answers
          if (!Array.isArray(answer) || answer.length !== 1 || typeof answer[0] !== 'string') throw new Error('Answer every Kimi form field')
          let value: unknown = answer[0]
          if (f.valueType === 'array') { try { value = JSON.parse(answer[0]) } catch { throw new Error('Select the requested choices') } }
          const allowed = f.options?.map(o => o.label)
          if (f.valueType === 'array') {
            if (!Array.isArray(value) || value.length < f.min || value.length > f.max || new Set(value).size !== value.length || value.some(v => typeof v !== 'string' || !allowed?.includes(v))) throw new Error('Select the requested choices')
          } else if (typeof value !== 'string' || value.length < f.min || value.length > f.max || (allowed && !allowed.includes(value))) throw new Error('Use a valid answer from the displayed Kimi form')
        }
      } else {
        if (!['accept', 'decline', 'cancel'].includes(result?.decision)) throw new Error('Approval decision required')
        if (result.decision === 'accept' && (!tools.has(p.toolId) || scope(tools.get(p.toolId)) !== p.hash)) throw new Error('Kimi operation changed; no current matching approval preview')
      }
    }
    function receive(m: any) {
      if (closed || failed || terminal) return
      if (m.jsonrpc !== '2.0') throw new Error()
      if (typeof m.method !== 'string') {
        const c = calls.get(m.id)
        if (!c) return
        calls.delete(m.id); clearTimeout(c.timer)
        if (m.error) c.reject(new Error('Kimi rejected the request (code ' + String(m.error.code) + '); reconcile in its native client'))
        else c.accept(m.result)
        return
      }
      const p = m.params
      if (m.method === '$/cancel_request') {
        if (pending.has(p?.requestId)) { cancel(p.requestId); pending.delete(p.requestId); event('serverRequest/resolved', { requestId: p.requestId }) }
        return
      }
      if (m.method === 'session/update') {
        // Session resume is negotiated without history replay; pre-prompt metadata is not a live turn.
        if (!turn) return
        if (p?.sessionId !== thread || !object(p.update)) { fail('Kimi update does not match the owned session'); return }
        const u = p.update
        if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && typeof u.content.text === 'string') {
          output = (output + u.content.text).slice(-65536); event('item/agentMessage/delta', { delta: u.content.text })
        } else if (['tool_call', 'tool_call_update'].includes(u.sessionUpdate)) {
          if (!text(u.toolCallId, 512) || (!tools.has(u.toolCallId) && tools.size >= 64)) { fail('Kimi tool bound exceeded'); return }
          const tool = { ...tools.get(u.toolCallId), ...u }; delete tool.sessionUpdate
          if (Buffer.byteLength(JSON.stringify(tool)) > 131072) { fail('Kimi tool event bound exceeded'); return }
          tools.set(u.toolCallId, tool)
          for (const approval of pending.values()) if ('toolId' in approval && approval.toolId === u.toolCallId && scope(tool) !== approval.hash) { fail('Kimi changed a pending operation; reconcile before approving'); return }
          if (['completed', 'failed'].includes(tool.status)) {
            event('item/completed', { item: { type: 'hostTool', tool: tool.title ?? tool.kind, input: tool.rawInput, output: tool.rawOutput ?? tool.content, isError: tool.status === 'failed' } }); tools.delete(u.toolCallId)
          }
        } else if (u.sessionUpdate === 'config_option_update') {
          const opts = u.configOptions
          if (Array.isArray(opts) && opts.some(o => (o.id === 'model' && o.currentValue !== modelValue) || (o.id === 'mode' && o.currentValue !== mode))) fail('Kimi changed session configuration; reconcile in its native client')
        }
        return
      }
      if (m.id === undefined) return
      if (!(text(m.id) || (Number.isSafeInteger(m.id) && m.id >= 0)) || !turn || p?.sessionId !== thread || pending.has(m.id) || pending.size >= 8 || Buffer.byteLength(JSON.stringify(p)) > 30000) {
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Unsupported or out-of-scope interaction; no action approved' } }); fail('Kimi request scope/bound mismatch'); return
      }
      if (m.method === 'elicitation/create') {
        let fields: Field[]
        try { fields = formFields(p) } catch { reply(m.id, { action: 'cancel' }); fail('Unsupported Kimi form; use its native client'); return }
        pending.set(m.id, { fields })
        callbacks.request({ id: m.id, method: 'item/tool/requestUserInput', params: { threadId: thread, turnId: turn, message: p.message, cancellable: true, questions: fields.map(f => ({ id: f.id, question: f.question, isSecret: false, valueType: f.valueType, options: f.options, maxLength: f.max })) } })
      } else if (m.method === 'session/request_permission') {
        const call = p.toolCall, options = p.options
        const allow = Array.isArray(options) ? options.filter(o => o.kind === 'allow_once') : [], decline = Array.isArray(options) ? options.filter(o => o.kind === 'reject_once') : []
        const previous = object(call) ? tools.get(call.toolCallId) : undefined
        const tool = object(call) && text(call.toolCallId, 512) ? { ...previous, ...call } : undefined
        // Kimi can ask before tool.call.started supplies rawInput. Its preceding
        // stream carries cumulative JSON; accept only a complete same-call object.
        if (tool && tool.rawInput === undefined && previous?.content?.length === 1) {
          const c = previous.content[0]
          if (c.type === 'content' && c.content?.type === 'text' && typeof c.content.text === 'string') {
            try { const input = JSON.parse(c.content.text); if (object(input)) tool.rawInput = input } catch {}
          }
        }
        if (!tool || !object(tool.rawInput) || ['switch_mode', 'think'].includes(tool.kind) || !Array.isArray(options) || options.length > 16 || options.some(o => !text(o.optionId) || !text(o.name, 2000)) || new Set(options.map(o => o.optionId)).size !== options.length || allow.length !== 1 || decline.length !== 1 || Buffer.byteLength(JSON.stringify(tool)) > 24000) {
          reply(m.id, { outcome: { outcome: 'cancelled' } }); fail('Kimi approval lacks a bounded exact operation and one-request choices'); return
        }
        tools.set(call.toolCallId, tool)
        pending.set(m.id, { toolId: call.toolCallId, hash: scope(tool), allow: allow[0].optionId, decline: decline[0].optionId })
        callbacks.request({ id: m.id, method: 'kimi/tool/requestApproval', params: { threadId: thread, turnId: turn, tool: tool.title ?? tool.kind, input: { kind: tool.kind, rawInput: tool.rawInput, locations: tool.locations, content: tool.content }, cwd: root } })
      } else {
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Unsupported interaction; no action approved' } }); fail('Kimi requested an unsupported interaction; use its native client')
      }
    }
    return {
      request: async (method, params: any) => {
        if (closed || failed) throw new Error('Kimi connection closed')
        if (method === 'thread/start' || method === 'thread/resume') {
          if (wire || params.cwd !== root) throw new Error('Kimi session already initialised or checkout mismatch')
          if (method === 'thread/resume') thread = sessionId.parse(params.threadId)
          opening = hostProcess(executable, ['acp'], root, maxRunSeconds, receive, fail); wire = await opening
          if (closed || failed) { await wire.close(); throw new Error('Kimi start cancelled') }
          const init = await rpc('initialize', { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } }, clientInfo: { name: 'z1p_console', version: '1' } })
          if (init?.protocolVersion !== 1 || !object(init.agentCapabilities?.sessionCapabilities?.resume)) throw new Error('Kimi must support ACP1 and history-free resume')
          // No ephemeral MCP additions; native configured servers/settings remain the harness's responsibility.
          const settings = await rpc(thread ? 'session/resume' : 'session/new', { cwd: root, mcpServers: [], ...(thread ? { sessionId: thread } : {}) })
          if (thread && settings.sessionId !== undefined && settings.sessionId !== thread) throw new Error('Kimi resumed another session')
          thread = thread || sessionId.parse(settings.sessionId)
          const options = settings.configOptions
          if (!Array.isArray(options)) throw new Error('Kimi did not report effective configuration')
          const models = options.filter(o => o.id === 'model'), modes = options.filter(o => o.id === 'mode')
          modelValue = models[0]?.currentValue; mode = modes[0]?.currentValue
          if (models.length !== 1 || modes.length !== 1 || !text(modelValue) || !text(mode) || !/^[A-Za-z0-9._-]+\/.+/.test(modelValue)) throw new Error('Kimi must report a provider/model and permission mode before a prompt')
          const slash = modelValue.indexOf('/')
          return { cwd: root, thread: { id: thread, cwd: root, status: { type: 'idle' } }, model: modelValue.slice(slash + 1), modelProvider: modelValue.slice(0, slash), approvalPolicy: mode, sandbox: 'Not reported by native host' }
        }
        if (method === 'turn/start') {
          if (!wire || !modelValue || turn || params.threadId !== thread || !Array.isArray(params.input) || params.input.length !== 1 || typeof params.input[0]?.text !== 'string') throw new Error('Invalid Kimi turn')
          turn = randomUUID()
          void rpc('session/prompt', { sessionId: thread, prompt: [{ type: 'text', text: params.input[0].text }] }, maxRunSeconds).then(result => {
            if (closed || failed) return
            if (stopping && result?.stopReason !== 'cancelled') { fail('Kimi ended after Stop without a terminal cancellation receipt'); return }
            terminal = true; pending.clear()
            event('item/completed', { item: { type: 'agentMessage', text: output } })
            event('turn/completed', { turn: { id: turn, status: result?.stopReason === 'end_turn' ? 'completed' : result?.stopReason === 'cancelled' ? 'interrupted' : 'failed', error: result?.stopReason !== 'end_turn' ? { message: 'Kimi stopped: ' + String(result?.stopReason) } : null } })
          }).catch(() => fail('Kimi prompt failed without a qualified result; reconcile its saved session'))
          return { turn: { id: turn, status: 'inProgress' } }
        }
        if (method === 'turn/interrupt' && turn && params.threadId === thread && params.turnId === turn) { stopping = true; for (const id of pending.keys()) cancel(id); pending.clear(); send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: thread } }); return {} }
        throw new Error('Unsupported Kimi operation')
      },
      validateResponse: validate,
      respond: (id, result: any) => {
        validate(id, result); const p = pending.get(id)!
        if ('fields' in p) {
          if (result.decision) reply(id, { action: result.decision })
          else reply(id, { action: 'accept', content: Object.fromEntries(p.fields.map(f => { const v = result.answers[f.id].answers[0]; return [f.key, f.valueType === 'array' ? JSON.parse(v) : v] })) })
        } else reply(id, result.decision === 'cancel' ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: result.decision === 'accept' ? p.allow : p.decline } })
        pending.delete(id)
      },
      reject: id => { if (pending.has(id)) { cancel(id); pending.delete(id) } },
      close: async () => { closed = true; rejectCalls('Kimi connection closed'); pending.clear(); const owned = wire ?? await opening?.catch(() => undefined); await owned?.close() },
    }
  }
}

function formFields(p: any): Field[] {
  if (p.mode !== 'form' || !text(p.message, 4000)) throw new Error()
  const s = p.requestedSchema
  if (!object(s) || s.type !== 'object' || !object(s.properties) || !Array.isArray(s.required) || Object.keys(s).some(k => !['type', 'properties', 'required', 'additionalProperties', 'title', 'description'].includes(k)) || s.additionalProperties === true) throw new Error()
  const entries = Object.entries(s.properties)
  if (!entries.length || entries.length > 3 || s.required.length !== entries.length || new Set(s.required).size !== entries.length || s.required.some((key: any) => !Object.hasOwn(s.properties, key))) throw new Error()
  return entries.map(([key, f], i) => {
    if (!object(f) || !text(key, 128) || Object.keys(f).some(k => !['type', 'title', 'description', 'enum', 'oneOf', 'items', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems'].includes(k))) throw new Error()
    const array = f.type === 'array'
    if (!array && f.type !== 'string') throw new Error()
    const enums = array ? f.items : f
    if (!object(enums) || (array && Object.keys(enums).some(k => !['type', 'enum', 'anyOf'].includes(k)))) throw new Error()
    const constants = array ? enums.anyOf : enums.oneOf
    const options = enums.enum !== undefined ? enums.enum.map((v: any) => ({ label: v, description: '' })) : constants?.map((o: any) => ({ label: o.const, description: o.description ?? o.title ?? '' }))
    if (options !== undefined && (!Array.isArray(options) || !options.length || options.length > 16 || options.some((o: any) => !text(o.label, 1000) || typeof o.description !== 'string' || o.description.length > 2000) || new Set(options.map((o: any) => o.label)).size !== options.length)) throw new Error()
    if (array && !options) throw new Error()
    const min = array ? (f.minItems ?? 1) : (f.minLength ?? 1), max = array ? (f.maxItems ?? options.length) : (f.maxLength ?? 4000)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > (array ? 16 : 4000)) throw new Error()
    return { key, id: 'q' + i, question: [f.title ?? key, f.description].filter(Boolean).join(': '), valueType: array ? 'array' : options ? 'choice' : 'text', options, min, max }
  })
}
