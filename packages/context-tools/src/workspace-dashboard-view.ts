import { createHash } from 'node:crypto'
import type { DashboardTicket, readWorkspaceDashboard } from './workspace-dashboard.js'
import { consoleClient, consoleShell, consoleStyle } from './agent-console-view.js'
type Snapshot = Awaited<ReturnType<typeof readWorkspaceDashboard>>

export function renderWorkspaceDashboard(control = false) {
  const script = `(${dashboard.toString()})();` + (control ? `(${consoleClient.toString()})();` : '')
  const css = (control ? consoleStyle : '') + `:root{font:15px/1.5 system-ui,sans-serif;color:#242c30;background:#f4f3ed;color-scheme:light}*{box-sizing:border-box}body{margin:0}header{background:#202e2b;color:#f4f3ed;padding:26px 4vw}header .eyebrow{color:#b4c9bc}h1{font-size:28px;letter-spacing:-1px;margin:3px 0}p{margin:6px 0}.eyebrow{font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:2px}main{padding:24px 4vw 40px}.toolbar{display:flex;align-items:end;gap:16px;flex-wrap:wrap;margin-bottom:20px}.field{display:grid;gap:5px;flex:1 1 240px;min-width:0}input,select{width:100%;min-width:0}.field label{font-size:13px;font-weight:650}input,select,button{font:inherit;border:1px solid #a8b4ab;background:#fffefa;border-radius:6px;padding:10px 12px;color:inherit}button{cursor:pointer;font-weight:650;background:#e9efdf}button:hover{background:#d8e4c7}:focus-visible{outline:3px solid #396c60;outline-offset:3px}#observation{font-size:13px;color:#536059}#error{background:#ffe7d9;border:1px solid #b75832;padding:14px;border-radius:8px}#stats{display:flex;gap:28px;flex-wrap:wrap;margin:20px 0 24px}#stats strong{display:block;font-size:26px;line-height:1.1}#stats span{font-size:12px;color:#536059}.board{display:grid;grid-template-columns:repeat(5,minmax(230px,1fr));gap:15px;overflow-x:auto;padding:3px 3px 18px}.lane{min-width:0}.lane h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between;border-top:3px solid #8eaa96;padding-top:10px}.lane[data-lane=blocked] h2{border-color:#bd6542}.lane[data-lane=reviewing] h2{border-color:#a28bb7}.lane[data-lane=done] h2{border-color:#6a8783}.lane[data-lane=inactive] h2{border-color:#a8a9a3}.ticket{background:#fffefa;border:1px solid #deded4;border-radius:9px;padding:15px;margin-bottom:12px;box-shadow:0 2px 3px #202e2b08;overflow-wrap:anywhere}.ticket h3{font-size:16px;line-height:1.4;margin:8px 0 12px}.badge{display:inline-block;font-size:11px;font-weight:650;background:#edf0e4;color:#3c5843;border-radius:4px;padding:3px 6px}.girnel{background:#eee6f2;color:#644d72}.agent{font-size:13px;border-top:1px solid #eeeee7;margin-top:10px;padding-top:10px}.muted,.empty{font-size:13px;color:#626a62}.empty{padding:12px 0}.ticket summary{font-size:12px;cursor:pointer;margin-top:12px}code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}ul{padding-left:19px}a{color:#335f51;text-underline-offset:3px}small{font-size:12px}.panels{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:22px}.panel{background:#eaece3;border:1px solid #d6dccf;border-radius:9px;padding:18px;min-width:0;overflow-wrap:anywhere}.panel h2{font-size:17px;margin-top:0}.panel h3{font-size:14px}.panel details{border-top:1px solid #d2d9ca;margin-top:12px;padding-top:12px}.warning{color:#8c3e22}footer{border-top:1px solid #d4dacf;margin-top:28px;padding-top:15px;font-size:12px;color:#59675d}#limits{margin-top:16px;font-size:13px}@media(min-width:1700px){main,header{padding-left:max(4vw,calc((100vw - 1700px)/2));padding-right:max(4vw,calc((100vw - 1700px)/2))}}@media(max-width:750px){.board{grid-template-columns:1fr;overflow:visible}.panels{grid-template-columns:1fr}header{padding:20px}main{padding:18px}.lane h2{margin-top:22px}.toolbar button{width:100%}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`
  const hash = (value: string) => createHash('sha256').update(value).digest('base64')
  const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(css)}'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`
  return { csp, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Z1P · Work in view</title><style>${css}</style></head><body><header><div class="eyebrow">Z1P / Local workspace</div><h1>Work in view.</h1><p>Agent activity, shared paths and the next handover.</p></header><main>${control ? consoleShell : ''}<div class="toolbar"><div class="field"><label for="project">Project</label><select id="project"><option value="">All saved checkouts</option></select></div><div class="field"><label for="search">Find work or an agent</label><input type="search" id="search" placeholder="Task, agent, branch or path"></div><button id="refresh" type="button">Refresh observations</button></div><p id="observation" role="status" aria-live="polite">Loading local observations…</p><p id="error" role="alert" hidden></p><div id="stats"></div><div id="board" class="board" role="region" aria-label="Reported agent progress"></div><div id="limits"></div><div class="panels"><section class="panel" aria-labelledby="overlap-heading"><h2 id="overlap-heading">Shared paths</h2><p class="muted">Intended file claims can overlap across branches. These are advisory observations.</p><div id="overlaps"></div></section><section class="panel" aria-labelledby="context-heading"><h2 id="context-heading">Context & handovers</h2><div id="context"></div><div id="checkpoints"></div></section></div><footer>${control ? 'Local task control is enabled; the selected host owns execution and approvals.' : 'Local, read-only observations.'} A lease is not process liveness; reported completion is not acceptance. Girnel remains the source of ticket status. ${control ? 'Review shows selected working-tree changes; agent inboxes stay private.' : 'No source excerpts or agent inboxes are displayed.'}</footer></main><script>${script}</script></body></html>` }
}

function dashboard() {
  const el = (id: string) => document.getElementById(id)!
  const project = el('project') as HTMLSelectElement, search = el('search') as HTMLInputElement
  let snapshot: Snapshot | undefined, loading = false
  const node = (tag: string, text = '', className = '') => { const value = document.createElement(tag); value.textContent = text; value.className = className; return value }
  const date = (time: number | string) => new Date(time).toLocaleString()
  const lanes: [DashboardTicket['lane'], string][] = [['working', 'Working'], ['blocked', 'Blocked'], ['reviewing', 'Reviewing'], ['done', 'Reported finished'], ['inactive', 'No recent activity']]
  function draw() {
    if (!snapshot) return
    const data = snapshot, root = project.value, query = search.value.trim().toLowerCase()
    const open = new Set(Array.from(document.querySelectorAll<HTMLDetailsElement>('details[open][data-key]')).map(item => item.dataset.key))
    const tickets = data.tickets.filter(ticket => (!root || ticket.checkoutRoots.includes(root)) && JSON.stringify(ticket).toLowerCase().includes(query))
    el('stats').replaceChildren()
    for (const [count, label] of [[tickets.length, 'tickets in view'], [tickets.reduce((n, t) => n + t.agents.filter(a => a.active).length, 0), 'active leases'], [data.overlaps.rows.length, 'reported overlaps']] as const) {
      const stat = node('div'); stat.append(node('strong', String(count)), node('span', label)); el('stats').append(stat)
    }
    el('board').replaceChildren()
    for (const [state, label] of lanes) {
      const lane = node('section', '', 'lane'); lane.dataset.lane = state
      const shown = tickets.filter(ticket => ticket.lane === state), heading = node('h2', label)
      heading.append(node('span', String(shown.length))); lane.append(heading)
      for (const ticket of shown) {
        const card = node('article', '', 'ticket')
        card.append(node('span', ticket.girnel ? 'GIRNEL CARD' : 'AGENT ACTIVITY', 'badge' + (ticket.girnel ? ' girnel' : '')), node('h3', ticket.title))
        if (ticket.girnel) {
          card.append(node('p', 'Girnel: ' + ticket.girnel.column, 'muted'), node('p', 'Card metadata supplied ' + date(ticket.girnel.observedAt), 'muted'))
          const link = node('a', 'Open card in Girnel') as HTMLAnchorElement
          link.href = ticket.girnel.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link)
        }
        for (const agent of ticket.agents) {
          const info = node('div', '', 'agent'); info.append(node('strong', agent.label), node('p', (agent.active ? 'Lease active' : agent.state === 'done' ? 'Reported finished' : 'Lease expired') + ' · ' + agent.state, 'muted'), node('p', agent.checkoutRoot.split('/').pop() + ' / ' + (agent.branch ?? 'detached HEAD'), 'muted')); card.append(info)
        }
        if (!ticket.agents.length) card.append(node('p', 'No published activity linked to this selected card.', 'muted'))
        const details = node('details') as HTMLDetailsElement; details.dataset.key = ticket.id; details.open = open.has(ticket.id)
        details.append(node('summary', 'Task, files & provenance'))
        for (const agent of ticket.agents) {
          details.append(node('p', agent.task), node('p', agent.checkoutRoot, 'muted'), node('code', 'HEAD ' + (agent.head ?? 'unknown')), node('p', 'Published ' + date(agent.updatedAt) + ' · lease ends ' + date(agent.expiresAt), 'muted'))
          const paths = node('ul'); for (const path of agent.paths) paths.append(node('li', path)); details.append(paths)
        }
        card.append(details); lane.append(card)
      }
      if (!shown.length) lane.append(node('p', 'No reported work here.', 'empty'))
      el('board').append(lane)
    }
    el('overlaps').replaceChildren()
    const overlaps = data.overlaps.rows.filter(overlap => !root || overlap.checkouts.includes(root))
    for (const overlap of overlaps) { const item = node('div'); item.append(node('h3', overlap.first + ' + ' + overlap.second), node('p', overlap.paths.join(', '), 'warning')); el('overlaps').append(item) }
    if (!overlaps.length) el('overlaps').append(node('p', data.activity.complete && data.overlaps.complete ? 'No overlapping claims in this observation.' : 'No overlaps found in the available partial observation.', 'muted'))
    el('context').replaceChildren()
    const projects = data.projects.filter(item => !root || item.root === root)
    el('context').append(node('p', projects.filter(item => item.cachedIndex).length + ' of ' + projects.length + ' saved checkouts have a cached index.'))
    const checked = projects.find(item => item.checkedAt !== null)
    if (checked) el('context').append(node('p', 'Selected checkout: ' + checked.freshness + ' · checked ' + date(checked.checkedAt!) + '. ' + (checked.freshness === 'current' ? 'Freshness covers the bounded indexed manifest, not the whole repository.' : 'Refresh or inspect this checkout with repository tools; no index is built by the viewer.'), 'muted'))
    else el('context').append(node('p', 'Source freshness not checked across the workspace. Start with --repo for a live check of one selected checkout; a cached index alone does not establish current context.', 'muted'))
    el('checkpoints').replaceChildren()
    const checkpoints = data.checkpoints.filter(item => !root || item.root === root)
    for (const group of checkpoints) {
      for (const checkpoint of group.rows) {
        const details = node('details') as HTMLDetailsElement; details.dataset.key = group.root + '/' + checkpoint.name; details.open = open.has(details.dataset.key)
        details.append(node('summary', checkpoint.name))
        if ('error' in checkpoint) details.append(node('p', checkpoint.error, 'warning'))
        else {
          details.append(node('p', checkpoint.task), node('p', group.root, 'muted'), node('p', checkpoint.status + ' · saved ' + date(checkpoint.savedAt), 'muted'), node('p', 'Next: ' + checkpoint.nextAction))
          const checks = node('ul'); for (const check of checkpoint.checks) checks.append(node('li', check.outcome + ': ' + check.criterion)); details.append(checks, node('p', 'Saved assertions; current sources and acceptance have not been verified here.', 'muted'))
        }
        el('checkpoints').append(details)
      }
      if (!group.complete) el('checkpoints').append(node('p', 'Checkpoint listing is partial or unavailable for ' + group.root, 'warning'))
      if ('retained' in group && group.retained && group.retained > 4) el('checkpoints').append(node('p', 'Showing the four newest of ' + group.retained + ' checkpoint files inspected.', 'muted'))
    }
    if (!data.checkpointScope.enabled) el('checkpoints').append(node('p', 'Checkpoint summaries are off. Start with --handover-base to include explicitly selected private storage.', 'muted'))
    else if (!checkpoints.some(item => item.rows.length)) el('checkpoints').append(node('p', 'No checkpoint summaries in the current selection.', 'muted'))
    const limits = el('limits'); limits.replaceChildren()
    if (!data.activity.complete) limits.append(node('p', 'Partial observation: ' + data.activity.stopReason + '. Inspected ' + data.activity.inspectedRoots + ' of ' + data.activity.catalogueRoots + ' saved checkouts.', 'warning'))
    if (!data.overlaps.complete) limits.append(node('p', 'Overlap analysis reached its bound; further overlaps may exist.', 'warning'))
    if (data.checkpointScope.enabled && data.checkpointScope.rootsRequested > data.checkpointScope.rootsRead) limits.append(node('p', 'Checkpoint summaries cover the first ' + data.checkpointScope.rootsRead + ' activity roots; narrow with --repo for another checkout.', 'warning'))
    for (const issue of data.activity.issues) limits.append(node('p', issue.root + ': ' + issue.reason, 'warning'))
    if (!data.girnel.configured) limits.append(node('p', 'Girnel linking is off. Supply --girnel-links with explicit card IDs and agent-slot bindings to group activity by ticket.', 'muted'))
  }
  async function refresh() {
    if (loading) return
    loading = true
    try {
      const response = await fetch(new URL('snapshot', location.href), { cache: 'no-store', signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error()
      const value: Snapshot = await response.json()
      snapshot = value
      const selected = project.value
      project.replaceChildren(new Option('All saved checkouts', ''), ...value.projects.map(item => new Option(item.root.split('/').pop() + ' — ' + item.root, item.root)))
      if (value.projects.some(item => item.root === selected)) project.value = selected
      el('observation').textContent = 'Observed ' + date(value.activity.observedAt) + ' · refreshes every 10 seconds · catalogue saved ' + date(value.activity.catalogueDiscoveredAt)
      el('error').hidden = true; draw()
    } catch {
      el('error').textContent = 'Could not refresh. Any displayed data is from a previous observation and may be stale. Check the local command and use Refresh observations to retry.'
      el('error').hidden = false
    } finally { loading = false }
  }
  project.addEventListener('change', draw); search.addEventListener('input', draw)
  el('refresh').addEventListener('click', () => { void refresh() })
  void refresh()
  setInterval(() => { if (!document.hidden) void refresh() }, 10000)
}
