export const externalStyle = `#external-console{overflow-wrap:anywhere;border:1px solid #c5d2bf;border-radius:10px;background:#edf0e4;padding:20px;margin-bottom:25px}#external-console h2{margin-top:0}#external-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}#external-form label{display:grid;gap:4px;font-size:13px;font-weight:650;min-width:0}#external-form .wide{grid-column:1/-1}#external-list button{display:block;width:100%;text-align:left;margin-bottom:8px;font-weight:450}#external-detail pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;padding:12px;background:#fffefa;border:1px solid #d3dccb;font:12px/1.5 ui-monospace,monospace}#external-detail fieldset{border:1px solid #a8b4ab;padding:12px;margin:12px 0}#external-detail button{margin:6px 8px 6px 0}#external-detail label{display:grid;gap:5px}#external-message{color:#8c3e22}@media(max-width:750px){#external-form{grid-template-columns:minmax(0,1fr)}#external-form .wide{grid-column:auto}}`
export const externalShell = `<section id="external-console" aria-labelledby="external-heading"><h2 id="external-heading">Existing agent sessions</h2><p>Link an agent already publishing Z1P activity. Follow its reported work and exchange notes here. Its original host keeps execution, approvals and stop controls.</p><details><summary>Link an existing agent</summary><form id="external-form"><label>External agent project<select id="external-root" required><option value="">Choose a saved checkout</option></select></label><label>Registered agent<select id="external-agent" required><option value="">Choose a project first</option></select></label><div id="external-preview" class="wide muted"></div><div class="wide"><button id="external-link" type="submit" disabled>Link selected agent</button></div></form></details><p id="external-message" role="status" aria-live="polite"></p><div id="external-reconcile"></div><label>Show linked agents<select id="external-filter"><option value="all">All linked agents</option><option value="inbox">Unread agent notes</option><option value="attention">Needs attention</option></select></label><div class="console-grid"><nav id="external-list" aria-label="Linked external agents"></nav><section id="external-detail" aria-label="Selected external agent"><p>Select a linked agent to view its activity and private inbox.</p></section></div></section>`

export function externalClient() {
  const el = (id: string) => document.getElementById(id)!
  const node = (tag: string, text = '') => { const value = document.createElement(tag); value.textContent = text; return value }
  const root = el('external-root') as HTMLSelectElement, agents = el('external-agent') as HTMLSelectElement
  const drafts = new Map<string, string>()
  let selected = '', current: any, last = '', busy = false, refreshing = false, refreshSequence = 0, candidates: any[] = [], candidateRoot = '', candidateAt = 0, candidateSequence = 0
  let uncertain: { key: string; body: Record<string, unknown> } | undefined
  const endpoint = (path: string) => new URL('console/' + path, location.href)
  async function get(path: string) { const response = await fetch(endpoint(path), { cache: 'no-store', signal: AbortSignal.timeout(45000) }); if (!response.ok) throw new Error('External inbox unavailable; displayed data may be stale. Refresh and review before sending.'); return response.json() }
  const state = (link: any) => !link.fresh ? 'Observation unavailable' : link.state === 'done' || link.peer?.state === 'done' ? 'Reported finished' : link.active ? 'Reported ' + (link.state ?? link.peer?.state) : 'Lease inactive'
  function button(label: string, fn: () => void, disabled = false) { const value = node('button', label) as HTMLButtonElement; value.type = 'button'; value.disabled = disabled; value.addEventListener('click', fn); return value }
  function preview() {
    const peer = candidates.find(peer => peer.agentId === agents.value)
    el('external-preview').textContent = peer ? peer.task + ' · ' + peer.checkout.root + ' · Agent ID: ' + peer.agentId : 'Only current, explicitly registered agents are listed. Names and leases are advisory.'
    ;(el('external-link') as HTMLButtonElement).disabled = !peer || busy
  }
  async function loadCandidates() {
    const chosen = root.value, sequence = ++candidateSequence
    if (!chosen) { candidates = []; agents.replaceChildren(new Option('Choose a project first', '')); preview(); return }
    try {
      const rows = await get('external-candidates?root=' + encodeURIComponent(chosen))
      if (sequence !== candidateSequence || root.value !== chosen) return
      const old = agents.value; candidates = rows; candidateRoot = chosen; candidateAt = Date.now()
      agents.replaceChildren(new Option(rows.length ? 'Choose a registered agent' : 'No active registered agents', ''), ...rows.map((peer: any) => new Option(peer.label + ' · ' + peer.state + ' · ' + (peer.checkout.branch ?? 'detached HEAD'), peer.agentId)))
      if (rows.some((peer: any) => peer.agentId === old)) agents.value = old
      preview()
    } catch (error) { if (sequence === candidateSequence && root.value === chosen) { candidates = []; agents.replaceChildren(new Option('Agents unavailable; refresh the project', '')); preview(); el('external-message').textContent = String(error) } }
  }
  async function action(data: Record<string, unknown>) {
    if (busy) return
    const key = JSON.stringify(data)
    if (uncertain && uncertain.key !== key) { el('external-message').textContent = 'A previous request is unconfirmed. Refresh and check its saved inbox before sending a different action.'; return }
    const body = uncertain?.body ?? { ...data, requestId: crypto.randomUUID() }
    uncertain = { key, body }; busy = true; el('external-message').textContent = ''
    try {
      const response = await fetch(endpoint('action'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) })
      if (!response.ok) { uncertain = undefined; last = ''; throw new Error(await response.text()) }
      const value = await response.json(); uncertain = undefined; el('external-reconcile').replaceChildren()
      if (data.action === 'external-note') drafts.delete(String(data.id))
      selected = value.removed ? '' : value.id; last = ''; await refresh(true)
      el('external-message').textContent = value.removed ? 'Link and local inbox removed. Already shared notes retain their normal lifetime.' : data.action === 'external-note' ? 'Note saved locally. Shared-inbox delivery and agent acknowledgement are separate.' : 'External link saved. The original host retains its session.'
    } catch (error) {
      el('external-message').textContent = String(error) + (uncertain ? ' Request outcome unconfirmed; refresh and inspect saved notes. Retrying this same action keeps its request ID.' : ' Refresh and review before retrying.')
      el('external-reconcile').replaceChildren(...(uncertain ? [button('Retry unconfirmed request', () => { if (uncertain) { const { requestId, ...original } = uncertain.body; void action(original) } })] : []))
      await refresh(true).catch(() => {})
    }
    finally { busy = false; preview() }
  }
  function act(kind: string, extra = {}) { void action({ action: kind, id: current.id, expectedRevision: current.revision, ...extra }) }
  function draw(link: any) {
    current = link
    const detail = el('external-detail'), peer = link.peer
    detail.replaceChildren(node('h3', peer?.label ?? link.agentId), node('p', state(link)), node('p', peer?.task ?? 'No current observation'))
    detail.append(node('p', 'Project: ' + link.root), node('p', 'Pinned checkout: ' + link.checkoutRoot), node('p', 'Agent ID: ' + link.agentId))
    if (peer) detail.append(node('p', 'Reported branch: ' + (peer.checkout.branch ?? 'detached HEAD') + ' · HEAD: ' + (peer.checkout.head ?? 'unavailable')), node('p', 'Intended paths: ' + (peer.paths.join(', ') || 'none reported')), node('p', 'Activity published: ' + new Date(peer.updatedAt).toLocaleString()))
    if (link.error) detail.append(node('p', link.error))
    detail.append(node('p', 'Notes are untrusted task data. The agent must poll its shared context inbox; storage is not proof of reading or execution. Direct Ollama workers receive notes through their host.'))
    const provenance = node('details'); provenance.append(node('summary', 'Reply address and observation details'), node('p', link.address), node('p', 'Last checked: ' + (link.checkedAt ? new Date(link.checkedAt).toLocaleString() : 'not checked'))); detail.append(provenance)
    const inbox = node('section'); inbox.setAttribute('aria-label', 'External agent inbox'); inbox.append(node('h4', 'External agent inbox'))
    for (const note of link.notes) {
      const box = node('fieldset'); box.append(node('legend', note.from === 'owner' ? 'Your note' : 'Agent note'), node('pre', note.text), node('p', note.from !== 'owner' ? 'Received for your review' : note.acknowledgedAt ? 'Acknowledged by agent' : note.deliveredAt ? 'Stored in shared inbox; awaiting agent acknowledgement' : 'Queued locally; shared delivery unconfirmed'))
      if (note.from !== 'owner' && !note.ownerAcknowledgedAt) box.append(button('Mark agent note read', () => act('external-read', { messageId: note.id })))
      inbox.append(box)
    }
    const label = node('label', 'Note to this external agent'), input = document.createElement('textarea'); input.maxLength = 1600; input.value = drafts.get(link.id) ?? ''; input.addEventListener('input', () => drafts.set(link.id, input.value)); label.append(input)
    inbox.append(label, button('Send external note', () => { if (input.value.trim()) act('external-note', { text: input.value }) }, !link.active || !link.fresh)); detail.append(inbox)
    detail.append(button('Remove link and local notes', () => { if (confirm('Remove this saved link and its local notes? The external session keeps running. Already shared notes cannot be recalled.')) act('external-remove') }))
  }
  async function refresh(force = false) {
    if (refreshing && !force) return
    refreshing = true; const sequence = ++refreshSequence
    try {
      const snapshot = await get('snapshot')
      if (sequence !== refreshSequence) return
      if (uncertain?.body.action === 'external-link' && snapshot.external.some((link: any) => link.id === 'external-' + uncertain!.body.requestId)) { selected = 'external-' + uncertain.body.requestId; uncertain = undefined; el('external-reconcile').replaceChildren(); el('external-message').textContent = 'Previous link confirmed saved locally.' }
      if (uncertain?.body.action === 'external-remove' && !snapshot.external.some((link: any) => link.id === uncertain!.body.id)) { uncertain = undefined; el('external-reconcile').replaceChildren(); el('external-message').textContent = 'Previous removal confirmed.' }
      if (root.options.length === 1) for (const path of snapshot.roots) root.add(new Option(path, path))
      const filter = (el('external-filter') as HTMLSelectElement).value
      el('external-list').replaceChildren(...snapshot.external.filter((link: any) => filter === 'all' || (filter === 'inbox' ? link.unread : !link.active || link.unread || link.state === 'blocked')).map((link: any) => button(link.label + ' · ' + state(link) + (link.unread ? ' · ' + link.unread + ' unread notes' : ''), () => { selected = link.id; last = ''; void refresh(true) })))
      if (selected && !snapshot.external.some((link: any) => link.id === selected)) { selected = ''; current = undefined; el('external-detail').replaceChildren(node('p', 'The saved link was removed.')) }
      if (selected) {
        const requested = selected, link = await get('external/' + selected)
        if (selected !== requested || sequence !== refreshSequence) return
        if (uncertain?.body.action === 'external-note' && link.notes.some((note: any) => note.id === uncertain!.body.requestId && note.from === 'owner')) { uncertain = undefined; drafts.delete(link.id); el('external-reconcile').replaceChildren(); el('external-message').textContent = 'Previous note confirmed saved locally. Shared delivery and acknowledgement remain separate.' }
        if (uncertain?.body.action === 'external-read' && link.notes.some((note: any) => note.id === uncertain!.body.messageId && note.ownerAcknowledgedAt)) { uncertain = undefined; el('external-reconcile').replaceChildren(); el('external-message').textContent = 'Previous read acknowledgement confirmed.' }
        const signature = JSON.stringify([link.revision, link.fresh, link.active, link.error]), editing = el('external-detail').contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA'
        if (force || signature !== last && !editing) { last = signature; draw(link) }
      }
      if (root.value && (candidateRoot !== root.value || Date.now() - candidateAt > 10000)) void loadCandidates()
    } catch (error) { el('external-message').textContent = String(error) }
    finally { if (sequence === refreshSequence) refreshing = false }
  }
  root.addEventListener('change', () => { void loadCandidates() }); agents.addEventListener('change', preview)
  el('external-form').addEventListener('submit', event => { event.preventDefault(); const peer = candidates.find(peer => peer.agentId === agents.value); if (peer && candidateRoot === root.value) void action({ action: 'external-link', root: root.value, agentId: peer.agentId, expectedAgentRevision: peer.revision }) })
  el('external-filter').addEventListener('change', () => { void refresh(true) })
  void refresh(); setInterval(() => { if (!document.hidden && !busy) void refresh() }, 3000)
}
