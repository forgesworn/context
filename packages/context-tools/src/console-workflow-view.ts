export const workflowStyle = `#task-plans{border:1px solid #c5d2bf;border-radius:10px;background:#edf0e4;padding:20px;margin-bottom:25px;overflow-wrap:anywhere}#task-plans label{display:grid;gap:4px;margin:10px 0;font-size:13px;font-weight:650}#task-plans fieldset{border:1px solid #a8b4ab;margin:14px 0;min-width:0}#task-plans button{margin:5px 8px 5px 0}#plan-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px}#plan-steps article{background:#fffefa;border:1px solid #c5d2bf;border-radius:8px;padding:16px;min-width:0}#plan-steps h4{margin:0 0 8px}#plan-steps ul{padding-left:18px}#plan-message{color:#8c3e22}#plan-list{display:flex;flex-wrap:wrap}#plan-builder .plan-dependencies label{display:inline-flex;align-items:center;gap:6px;margin-right:12px}#plan-builder input[type=checkbox]{width:auto}#plan-builder textarea{min-height:65px}`
export const workflowShell = `<section id="task-plans" aria-labelledby="plan-heading"><h2 id="plan-heading">Task plans</h2><p>Split a feature into steps. Each run starts explicitly; dependencies wait for reviewed results and check evidence.</p><details id="new-plan"><summary>New task plan</summary><form id="plan-form"><label>Plan title<input id="plan-title" maxlength="160" required></label><label>Plan checkout<select id="plan-root" required></select></label><label>Maximum concurrent steps<select id="plan-width"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select></label><p class="muted">Steps use separate branches from committed HEAD. Predecessor changes are not automatically merged. Select small source files for each step; the host receives a fresh packet.</p><div id="plan-builder"></div><button type="button" id="plan-add">Add step</button><button type="button" id="plan-remove" disabled>Remove last step</button><button type="submit">Save task plan</button></form></details><p id="plan-message" role="status" aria-live="polite"></p><nav id="plan-list" aria-label="Saved task plans"></nav><section id="plan-detail" aria-label="Selected task plan"><p>No task plan selected.</p></section></section>`

export function workflowClient() {
  const el = (id: string) => document.getElementById(id)!
  const node = (tag: string, text = '') => { const value = document.createElement(tag); value.textContent = text; return value }
  const endpoint = (path: string) => new URL('console/' + path, location.href)
  const labels: Record<string, string> = { codex: 'Codex', claude: 'Claude', kimi: 'Kimi', ollama: 'Ollama' }
  let selected = '', generation = 0, busy = false, refreshing = false, hosts: any[] = []
  let pending: any
  const lines = (input: HTMLTextAreaElement) => input.value.split('\n').map(value => value.trim()).filter(Boolean)
  function button(text: string, action: () => void) { const value = node('button', text) as HTMLButtonElement; value.type = 'button'; value.addEventListener('click', action); return value }
  function field(parent: HTMLElement, title: string, kind: 'input' | 'textarea' | 'select', key: string) {
    const label = node('label', title), input = document.createElement(kind); input.dataset.field = key; input.required = true; label.append(input); parent.append(label); return input
  }
  function addStep() {
    const builder = el('plan-builder'), index = builder.children.length
    if (index >= 8) return
    const box = node('fieldset'); box.dataset.step = String(index); box.append(node('legend', 'Step ' + (index + 1)))
    const title = field(box, 'Step ' + (index + 1) + ' title', 'input', 'title') as HTMLInputElement; title.maxLength = 160
    const host = field(box, 'Step ' + (index + 1) + ' host', 'select', 'host') as HTMLSelectElement
    for (const item of hosts.filter(host => host.available)) host.add(new Option(labels[item.id], item.id))
    const task = field(box, 'Step ' + (index + 1) + ' instructions', 'textarea', 'task') as HTMLTextAreaElement; task.maxLength = 2048
    const paths = field(box, 'Step ' + (index + 1) + ' source files (one per line, up to eight)', 'textarea', 'paths') as HTMLTextAreaElement; paths.maxLength = 4096
    const checks = field(box, 'Step ' + (index + 1) + ' required checks (one per line, up to eight)', 'textarea', 'checks') as HTMLTextAreaElement; checks.maxLength = 4096
    const dependencies = node('div'); dependencies.className = 'plan-dependencies'; dependencies.append(node('p', index ? 'Wait for accepted results from:' : 'This step has no prerequisites.'))
    for (let previous = 0; previous < index; previous++) { const label = node('label', 'Step ' + (previous + 1)), input = document.createElement('input'); input.type = 'checkbox'; input.value = String(previous); input.dataset.field = 'dependency'; label.prepend(input); dependencies.append(label) }
    box.append(dependencies); builder.append(box)
    ;(el('plan-add') as HTMLButtonElement).disabled = builder.children.length >= 8
    ;(el('plan-remove') as HTMLButtonElement).disabled = builder.children.length <= 1
  }
  function show(plan: any) {
    const detail = el('plan-detail'); detail.replaceChildren(node('h3', plan.title), node('p', plan.root), node('p', plan.reportedComplete ? 'Every step has an accepted local result. Integration, merge and release remain separate.' : 'Ready steps: ' + (plan.ready.join(', ') || 'none')))
    if (plan.stopReasons.length) detail.append(node('p', 'New starts stopped: ' + plan.stopReasons.join(', ')))
    detail.append(node('p', plan.metrics.attempts + ' attempts · ' + plan.metrics.retries + ' retries · ' + plan.metrics.unknownOutcomes + ' unresolved outcomes · whole-task cost unknown'))
    const steps = node('div'); steps.id = 'plan-steps'
    for (const step of plan.nodes) {
      const card = node('article'); card.dataset.node = step.id
      card.append(node('h4', step.id + ' · ' + step.title), node('p', labels[step.host] + ' · ' + step.taskStatus), node('p', 'Plan: ' + step.state + (plan.ready.includes(step.id) ? ' · ready for explicit run' : '')))
      card.append(node('p', step.dependsOn.length ? step.dependsOn.map((id: string) => plan.nodes.find((n: any) => n.id === id).title).join(' + ') + ' → ' + step.title : 'No prerequisites'))
      for (const blocker of step.blockers) card.append(node('p', blocker))
      card.append(node('p', step.reviewGate), node('p', step.executionRoot))
      if (step.branch) card.append(node('p', 'Branch: ' + step.branch))
      const checks = node('ul'); for (const check of step.checks) checks.append(node('li', check.outcome + ': ' + check.check + ' — ' + check.evidence)); card.append(checks)
      card.append(button('Open step ' + step.id, () => { window.dispatchEvent(new CustomEvent('z1p-select-task', { detail: step.taskId })); el('managed-console').scrollIntoView({ block: 'start' }) })); steps.append(card)
    }
    detail.append(steps, node('p', 'Three attempts per step; new starts stop after 24 hours. The selected host enforces its own execution controls. Check evidence is recorded by the owner; the console does not run these checks automatically.'))
  }
  async function read(path: string) { const response = await fetch(endpoint(path), { cache: 'no-store', signal: AbortSignal.timeout(45000) }); if (!response.ok) throw new Error('Task plans unavailable; displayed observations may be stale.'); return response.json() }
  async function refresh() {
    if (refreshing || busy) return
    refreshing = true; const request = ++generation
    try {
      const snapshot = await read('snapshot')
      if (request !== generation) return
      hosts = snapshot.hosts
      const roots = el('plan-root') as HTMLSelectElement
      if (!roots.options.length) for (const root of snapshot.roots) roots.add(new Option(root, root))
      const width = el('plan-width') as HTMLSelectElement
      for (const option of Array.from(width.options)) option.disabled = Number(option.value) > snapshot.maxActive
      if (width.selectedOptions[0]?.disabled) width.value = String(snapshot.maxActive)
      ;(el('new-plan') as HTMLDetailsElement).hidden = !hosts.some(host => host.available)
      if (!el('plan-builder').children.length && hosts.some(host => host.available)) addStep()
      el('plan-list').replaceChildren(...snapshot.plans.map((plan: any) => button(plan.title, () => { selected = plan.id; generation++; void refresh() })))
      if (selected) { const wanted = selected, plan = await read('plan/' + selected); if (request === generation && wanted === selected) show(plan) }
    } catch (error) { if (request === generation) el('plan-message').textContent = String(error) }
    finally { refreshing = false }
  }
  async function save() {
    if (busy || !pending) return
    busy = true; generation++
    try {
      const response = await fetch(endpoint('action'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(pending), signal: AbortSignal.timeout(45000) })
      if (!response.ok) { const message = await response.text(); if (response.status === 409) pending = undefined; throw new Error(message) }
      const plan = await response.json(); selected = plan.id; pending = undefined
      el('plan-message').textContent = 'Plan and draft steps saved. No run has started.'; (el('new-plan') as HTMLDetailsElement).open = false
      el('plan-form').querySelectorAll('input,textarea,select,button').forEach(input => (input as HTMLInputElement).disabled = false)
    } catch (error) { el('plan-message').replaceChildren(node('span', String(error) + (pending ? ' Save outcome unconfirmed. Retry the same request to reconcile.' : ''))); if (pending) el('plan-message').append(button('Retry unconfirmed plan save', () => { void save() })) }
    finally { busy = false; refreshing = false; void refresh() }
  }
  el('plan-add').addEventListener('click', addStep)
  el('plan-remove').addEventListener('click', () => { const builder = el('plan-builder'); if (builder.children.length > 1) builder.lastElementChild!.remove(); (el('plan-add') as HTMLButtonElement).disabled = builder.children.length >= 8; (el('plan-remove') as HTMLButtonElement).disabled = builder.children.length <= 1 })
  el('plan-form').addEventListener('submit', event => {
    event.preventDefault(); if (pending || busy) return
    const nodes = Array.from(el('plan-builder').children).map(box => {
      const value = (key: string) => box.querySelector<HTMLInputElement>('[data-field="' + key + '"]')!.value
      return { title: value('title'), task: value('task'), host: value('host'), paths: lines(box.querySelector('[data-field="paths"]')!), checks: lines(box.querySelector('[data-field="checks"]')!), dependsOn: Array.from(box.querySelectorAll<HTMLInputElement>('input[data-field=dependency]:checked')).map(input => Number(input.value)) }
    })
    pending = { action: 'plan-create', requestId: crypto.randomUUID(), plan: { title: (el('plan-title') as HTMLInputElement).value, root: (el('plan-root') as HTMLSelectElement).value, maxConcurrent: Number((el('plan-width') as HTMLSelectElement).value), nodes } }
    if (new TextEncoder().encode(JSON.stringify(pending)).length > 16384) { pending = undefined; el('plan-message').textContent = 'Plan exceeds 16 KiB. Shorten instructions, paths or checks.'; return }
    void save()
  })
  void refresh(); setInterval(() => { if (!document.hidden) void refresh() }, 3000)
}
