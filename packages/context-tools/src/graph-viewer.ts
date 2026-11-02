import { createHash } from 'node:crypto'
import type { RepositoryGraph } from './repository-graph.js'

/** A self-contained export. The browser never opens project paths or contacts
 * a service; source inspection uses only the explicitly exported snapshot. */
export function renderGraphViewer(graph: RepositoryGraph): string {
  const payload = JSON.stringify(graph).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const script = `(${viewer.toString()})()`
  const scriptHash = createHash('sha256').update(script).digest('base64')
  const css = `:root{color-scheme:dark;font:15px system-ui;background:#10151d;color:#e7edf5}*{box-sizing:border-box}body{margin:0}header{padding:16px 22px;border-bottom:1px solid #344152}h1{font-size:21px;margin:0 0 8px}p{margin:5px 0;color:#b8c6d7}main{display:grid;grid-template-columns:280px minmax(300px,1fr) minmax(320px,40%);height:calc(100vh - 150px)}nav,section{padding:16px;overflow:auto;border-right:1px solid #344152}input,select,button{font:inherit;color:inherit;background:#202c3c;border:1px solid #53667e;border-radius:5px;padding:8px}input,select{width:100%;margin-bottom:9px}button{cursor:pointer}button:hover,button:focus-visible{background:#324765;outline:2px solid #78b9ff}.node{display:block;text-align:left;width:100%;margin:5px 0;overflow-wrap:anywhere}.muted{color:#a5b3c6;font-size:13px}svg{width:100%;height:440px}svg text{fill:#e7edf5;font:11px system-ui}svg circle{fill:#24577b;stroke:#99d4ff;stroke-width:2}svg line{stroke:#70879e}svg .candidate{stroke-dasharray:5 4}svg g{cursor:pointer}h2{font-size:17px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace;line-height:1.6;background:#17212e;padding:12px}.source-line{display:block}.selected{background:#304562}a{color:#99d4ff}#relationships button{display:block;margin:5px 0;text-align:left;width:100%}@media(max-width:1000px){main{grid-template-columns:240px 1fr}#details{grid-column:1/-1}main{height:auto}}@media(max-width:600px){main{display:block}svg{height:320px}}`
  const styleHash = createHash('sha256').update(css).digest('base64')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>Z1P local code graph</title><style>${css}</style></head><body><header><h1>Z1P local code graph</h1><p id="status"></p><p class="muted">Offline source snapshot. Dashed edges are candidates. Refresh the export after edits.</p></header><main><nav aria-label="Find code"><label for="search">Find a file or declaration</label><input id="search" type="search" placeholder="Name or path"><label for="language">Language</label><select id="language"><option value="">All languages</option></select><p id="matches" class="muted" aria-live="polite"></p><div id="nodes"></div></nav><section aria-label="Graph neighbourhood"><h2 id="graph-title">Select a node</h2><svg id="graph" role="img" aria-label="Selected code and connected nodes" viewBox="0 0 600 440"></svg><p id="graph-limit" class="muted"></p><h2>Relationships</h2><div id="relationships"></div></section><section id="details" aria-label="Source evidence"><h2 id="name">Source evidence</h2><p id="location"></p><p id="provenance" class="muted"></p><pre id="source"></pre><h2>Limits and unresolved evidence</h2><pre id="limits"></pre></section></main><script id="data" type="application/json">${payload}</script><script>${script}</script></body></html>`
}

function viewer() {
  const graph = JSON.parse(document.getElementById('data')!.textContent!)
  const el = (id: string) => document.getElementById(id)!
  const nodes: any[] = graph.nodes, edges: any[] = graph.edges
  const byId = new Map(nodes.map(node => [node.id, node]))
  const svgNS = 'http://www.w3.org/2000/svg'
  const set = (id: string, text: string) => { el(id).textContent = text }
  set('status', `${nodes.length} nodes · ${edges.length} relationships · revision ${graph.revision.slice(0, 16)}`)
  set('limits', JSON.stringify({ ...graph.completeness, caveat: graph.caveat, project: graph.project ?? null, dependencies: graph.dependencies }, null, 2))
  for (const language of [...new Set(nodes.map(node => node.language))].sort()) {
    const option = document.createElement('option'); option.value = language; option.textContent = language; el('language').append(option)
  }
  const button = (text: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', action); return b }
  const select = (node: any) => {
    location.hash = node.id
    set('name', node.name); set('location', `${node.path}:${node.startLine}–${node.endLine}`)
    set('provenance', `${node.language} · ${node.kind} · SHA-256 ${node.sha256}`)
    set('graph-title', node.name)
    const file = graph.sources.find((source: any) => source.path === node.path)
    const source = el('source'); source.replaceChildren()
    if (file) {
      const lines = file.text.split('\n'), start = Math.max(1, node.startLine - 2), end = Math.min(lines.length, node.endLine + 2, start + 399)
      for (let line = start; line <= end; line++) {
        const span = document.createElement('span'); span.className = `source-line${line >= node.startLine && line <= node.endLine ? ' selected' : ''}`
        span.textContent = `${line}: ${lines[line - 1]}`; source.append(span)
      }
      if (end < node.endLine) source.append(document.createTextNode(`\nSource display capped at 400 lines; declaration ends at ${node.endLine}.`))
    }
    const related = edges.filter(edge => edge.from === node.id || edge.to === node.id)
    const ids = [...new Set(related.map(edge => edge.from === node.id ? edge.to : edge.from))].slice(0, 24)
    set('graph-limit', `${ids.length} of ${new Set(related.map(edge => edge.from === node.id ? edge.to : edge.from)).size} neighbours shown. Relationship list capped at 100.`)
    const svg = el('graph'); svg.replaceChildren()
    const positions = new Map<string, [number, number]>([[node.id, [300, 220]]])
    ids.forEach((id, index) => { const angle = index * 2 * Math.PI / Math.max(1, ids.length); positions.set(id, [300 + 210 * Math.cos(angle), 220 + 180 * Math.sin(angle)]) })
    for (const edge of related) {
      const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) continue
      const line = document.createElementNS(svgNS, 'line'); line.setAttribute('x1', String(a[0])); line.setAttribute('y1', String(a[1])); line.setAttribute('x2', String(b[0])); line.setAttribute('y2', String(b[1])); if (edge.method === 'name-candidate') line.setAttribute('class', 'candidate'); svg.append(line)
    }
    for (const [id, [x, y]] of positions) {
      const item = byId.get(id); if (!item) continue
      const group = document.createElementNS(svgNS, 'g'); group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button'); group.setAttribute('aria-label', item.name)
      const circle = document.createElementNS(svgNS, 'circle'); circle.setAttribute('cx', String(x)); circle.setAttribute('cy', String(y)); circle.setAttribute('r', id === node.id ? '16' : '9')
      const label = document.createElementNS(svgNS, 'text'); label.setAttribute('x', String(x)); label.setAttribute('y', String(y + 24)); label.setAttribute('text-anchor', 'middle'); label.textContent = item.name.length > 24 ? item.name.slice(0, 23) + '…' : item.name
      group.append(circle, label); group.addEventListener('click', () => select(item)); group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(item) } }); svg.append(group)
    }
    el('relationships').replaceChildren(...related.slice(0, 100).map(edge => {
      const target = byId.get(edge.from === node.id ? edge.to : edge.from)
      return button(`${edge.from === node.id ? '→' : '←'} ${edge.kind} ${target?.name ?? 'unknown'} · ${edge.method} · ${edge.path}:${edge.line}`, () => { if (target) select(target) })
    }))
  }
  const filter = () => {
    const term = (el('search') as HTMLInputElement).value.toLowerCase(), language = (el('language') as HTMLSelectElement).value
    const matches = nodes.filter(node => (!language || node.language === language) && `${node.name} ${node.path}`.toLowerCase().includes(term))
    set('matches', `${matches.length} matches; showing ${Math.min(200, matches.length)}`)
    el('nodes').replaceChildren(...matches.slice(0, 200).map(node => { const b = button(`${node.name} · ${node.kind}`, () => select(node)); b.className = 'node'; return b }))
  }
  el('search').addEventListener('input', filter); el('language').addEventListener('change', filter)
  filter()
  const initial = byId.get(location.hash.slice(1)) ?? nodes[0]; if (initial) select(initial)
}
