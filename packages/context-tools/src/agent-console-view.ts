export const consoleStyle = `#managed-console{overflow-wrap:anywhere;border:1px solid #c5d2bf;border-radius:10px;background:#edf0e4;padding:20px;margin-bottom:25px}#managed-console h2{margin-top:0}#task-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}#task-form label{min-width:0;display:grid;gap:4px;font-size:13px;font-weight:650}#task-form .wide{grid-column:1/-1}textarea{font:inherit;width:100%;resize:vertical;min-height:80px;padding:10px;border:1px solid #a8b4ab;border-radius:5px;background:#fffefa;color:inherit}.console-grid{display:grid;grid-template-columns:minmax(200px,30%) 1fr;gap:20px;margin-top:20px;min-width:0}.console-grid>*{min-width:0}#task-list button{display:block;width:100%;text-align:left;margin-bottom:8px;font-weight:450}#task-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;padding:12px;background:#fffefa;border:1px solid #d3dccb;font:12px/1.5 ui-monospace,monospace}#task-detail button{margin:6px 8px 6px 0}#task-detail fieldset{border:1px solid #a8b4ab;padding:12px;margin:12px 0}#task-detail label{display:block}#task-detail input{margin:4px 0 10px}#task-message{color:#8c3e22;overflow-wrap:anywhere}@media(max-width:750px){#task-form,.console-grid{grid-template-columns:minmax(0,1fr)}#task-form .wide{grid-column:auto}}`
export const consoleShell = `<section id="managed-console" aria-labelledby="managed-heading"><h2 id="managed-heading">Managed tasks</h2><p>Start work here, follow its progress and review the result. The installed host keeps its model, account and execution policy.</p><details id="new-task" open><summary>New task</summary><form id="task-form"><label>Checkout<select id="task-root" required></select></label><label>Host<select id="task-host"><option value="codex" disabled>Codex · not configured</option><option value="claude" disabled>Claude · not configured</option><option disabled>Kimi · adapter pending</option><option disabled>Ollama · adapter pending</option></select></label><label class="wide">Task title<input id="task-title" maxlength="160" required></label><label class="wide">What should the agent do?<textarea id="task-objective" maxlength="8000" required></textarea></label><label class="wide">Intended files or directories (optional, one per line)<textarea id="task-paths" rows="2"></textarea></label><div class="wide"><button type="submit">Save task</button> <span id="console-bound" class="muted"></span></div></form></details><p id="task-message" role="status" aria-live="polite"></p><div class="console-grid"><nav id="task-list" aria-label="Saved managed tasks"></nav><section id="task-detail" aria-label="Selected task"><p>Select a task or save a new one.</p></section></div></section>`

export function consoleClient() {
  const el = (id: string) => document.getElementById(id)!
  const node = (tag: string, text = '') => { const value = document.createElement(tag); value.textContent = text; return value }
  const statuses: Record<string, string> = { draft: 'Saved', starting: 'Starting', running: 'Running', waiting: 'Needs your answer', stopping: 'Stopping', review: 'Ready for your review', accepted: 'Accepted locally', cancelled: 'Interrupted by host', failed: 'Host reported failure', unknown: 'Needs reconciliation' }
  let selected = '', last = '', busy = false, current: any, active = 0
  const drafts = new Map<string, string>()
  const endpoint = (path: string) => new URL('console/' + path, location.href)
  async function json(path: string) { const response = await fetch(endpoint(path), { cache: 'no-store', signal: AbortSignal.timeout(45000) }); if (!response.ok) throw new Error('Console unavailable; displayed data may be stale.'); return response.json() }
  async function action(data: Record<string, unknown>) {
    if (busy) return
    busy = true; el('task-message').textContent = ''
    try {
      const response = await fetch(endpoint('action'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify({ ...data, requestId: crypto.randomUUID() }), signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error(await response.text())
      const task = await response.json(); selected = task.id; current = task; last = ''; if (data.action === 'run') drafts.delete(task.id); await refresh()
      if (data.action === 'create') (el('new-task') as HTMLDetailsElement).open = false
    } catch (error) { el('task-message').textContent = String(error) + ' Refresh before retrying; an uncertain run is never restarted automatically.' }
    finally { busy = false }
  }
  function button(label: string, fn: () => void, disabled = false) { const value = node('button', label) as HTMLButtonElement; value.type = 'button'; value.disabled = disabled; value.addEventListener('click', fn); return value }
  function taskAction(actionName: string, extra = {}) { void action({ action: actionName, id: current.id, expectedRevision: current.revision, ...extra }) }
  function draw(task: any) {
    current = task
    const detail = el('task-detail'); detail.replaceChildren(node('h3', task.title), node('p', statuses[task.status] ?? task.status), node('p', task.root), node('p', task.objective))
    if (task.settings) detail.append(node('p', 'Host: ' + task.settings.provider + ' / ' + task.settings.model), node('p', 'Approval policy: ' + JSON.stringify(task.settings.approvalPolicy) + ' · Sandbox: ' + JSON.stringify(task.settings.sandbox)))
    if (task.status === 'draft' && !task.threadId) detail.append(button('Run task', () => taskAction('run'), active > 0))
    if (['starting', 'running', 'waiting'].includes(task.status)) detail.append(button('Stop run', () => taskAction('stop')))
    for (const pending of task.pending) {
      const box = node('fieldset'); box.append(node('legend', pending.method === 'item/tool/requestUserInput' ? 'The host has a question' : 'Host approval request'))
      // Full requested scope is visible; the client offers only one-operation decisions.
      if (pending.method === 'item/tool/requestUserInput') {
        const answers: Record<string, HTMLInputElement> = {}
        for (const question of pending.params.questions ?? []) {
          const label = node('label', question.question), input = document.createElement('input'); input.maxLength = 4000; label.append(input); box.append(label); answers[question.id] = input
          if (question.options) box.append(node('p', question.options.map((o: any) => o.label + ': ' + o.description).join(' · ')))
        }
        box.append(button('Send answers', () => taskAction('answer', { pendingId: pending.id, answers: Object.fromEntries(Object.entries(answers).map(([id, input]) => [id, input.value])) })))
      } else {
        if (pending.params.tool) box.append(node('h4', 'Requested tool: ' + pending.params.tool), node('pre', JSON.stringify(pending.params.input, null, 2)))
        if (pending.params.reason) box.append(node('p', pending.params.reason))
        if (pending.params.command) box.append(node('h4', 'Requested command'), node('pre', pending.params.command))
        if (pending.params.cwd) box.append(node('p', 'Working directory: ' + pending.params.cwd))
        if (pending.params.networkApprovalContext) box.append(node('h4', 'Requested network access'), node('pre', JSON.stringify(pending.params.networkApprovalContext, null, 2)))
        if (pending.params.additionalPermissions) box.append(node('h4', 'Requested additional access'), node('pre', JSON.stringify(pending.params.additionalPermissions, null, 2)))
        if (pending.preview) {
          box.append(node('h4', 'Proposed file changes'))
          for (const file of pending.preview.changes) box.append(node('h5', file.path + ' · ' + String(file.kind?.type ?? 'change')), node('pre', String(file.diff ?? '')))
        }
        const raw = node('details'); raw.append(node('summary', 'Full host request'), node('pre', JSON.stringify(pending.params, null, 2))); box.append(raw)
        if (pending.method === 'item/fileChange/requestApproval' && !pending.preview) box.append(node('p', 'A matching proposed patch is unavailable. Approval is disabled here; use the native host to reconcile.'))
        for (const [decision, label] of [['accept', 'Allow this request'], ['decline', 'Decline'], ['cancel', 'Cancel request']]) box.append(button(label, () => taskAction('answer', { pendingId: pending.id, decision }), decision === 'accept' && pending.method === 'item/fileChange/requestApproval' && !pending.preview))
      }
      detail.append(box)
    }
    if (task.result) detail.append(node('h4', 'Agent result'), node('pre', task.result))
    if (task.liveOutput) detail.append(node('h4', 'Live response'), node('pre', task.liveOutput))
    if (task.review) {
      detail.append(node('h4', 'Working tree for review'), node('pre', task.review.status || 'No working-tree changes'), node('pre', task.review.diff || 'No tracked diff'))
      for (const file of task.review.untracked) detail.append(node('h4', 'New file: ' + file.name), node('pre', file.text))
      detail.append(node('p', 'Review covers the current whole working tree, including any changes that existed before this task. Acceptance does not commit, merge or change a Girnel ticket.'))
      if (task.status === 'review') detail.append(button('Accept reviewed result', () => taskAction('review', { decision: 'accept', reviewHash: task.review.hash })), button('Request changes', () => taskAction('review', { decision: 'changes', reviewHash: task.review.hash })))
    }
    if (task.reviewError) detail.append(node('p', task.reviewError))
    if (task.threadId && ['draft', 'review', 'cancelled', 'failed', 'unknown'].includes(task.status)) {
      const label = node('label', task.status === 'unknown' ? 'Reconciliation and follow-up instructions' : 'Follow-up instructions'), input = document.createElement('textarea'); input.maxLength = 8000; input.id = 'follow-up'; input.value = drafts.get(task.id) ?? ''; input.addEventListener('input', () => drafts.set(task.id, input.value)); label.append(input); detail.append(label, button('Continue saved conversation', () => taskAction('run', { message: input.value }), active > 0))
    }
    const log = node('details'); log.append(node('summary', 'Run log' + (task.eventsTruncated ? ' (earlier output omitted)' : '')), node('pre', task.events.map((event: any) => event.text).join('\n\n'))); detail.append(log)
  }
  async function refresh() {
    try {
      const snapshot = await json('snapshot'); active = snapshot.active
      const roots = el('task-root') as HTMLSelectElement
      if (!roots.options.length) for (const root of snapshot.roots) roots.add(new Option(root, root))
      const hostSelect = el('task-host') as HTMLSelectElement
      for (const option of Array.from(hostSelect.options)) { const host = snapshot.hosts.find((host: any) => host.id === option.value); if (host) { option.disabled = !host.available; option.textContent = option.value === 'codex' ? 'Codex' : 'Claude'; if (!host.available) option.textContent += ' · not configured' } }
      if (hostSelect.selectedOptions[0]?.disabled) { const first = Array.from(hostSelect.options).find(option => !option.disabled); if (first) hostSelect.value = first.value }
      el('console-bound').textContent = 'One active run · ' + snapshot.maxRunSeconds + ' seconds maximum per host process'
      el('task-list').replaceChildren(...snapshot.tasks.map((task: any) => button(task.title + ' · ' + (task.host === 'claude' ? 'Claude · ' : '') + (statuses[task.status] ?? task.status), () => { selected = task.id; last = ''; void refresh() })))
      if (selected) {
        const requested = selected, task = await json('task/' + selected), signature = task.id + ':' + task.revision + ':' + task.eventSequence + ':' + task.outputSequence
        if (requested !== selected) return
        const editing = el('task-detail').contains(document.activeElement) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')
        if (signature !== last && (!editing || busy)) { last = signature; draw(task) }
      }
    } catch (error) { el('task-message').textContent = String(error) }
  }
  el('task-form').addEventListener('submit', event => {
    event.preventDefault()
    void action({ action: 'create', root: (el('task-root') as HTMLSelectElement).value, host: (el('task-host') as HTMLSelectElement).value, title: (el('task-title') as HTMLInputElement).value, objective: (el('task-objective') as HTMLTextAreaElement).value, paths: (el('task-paths') as HTMLTextAreaElement).value.split('\n').map(path => path.trim()).filter(Boolean) })
  })
  void refresh(); setInterval(() => { if (!document.hidden && !busy) void refresh() }, 1500)
}
