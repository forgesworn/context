import { open, realpath, lstat } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { dirname, isAbsolute, resolve } from 'node:path'
import { RepositoryNavigation } from './repository-navigation.js'
import { resolveCheckoutRoot } from './repository-navigation-mcp.js'
import { buildRepositoryGraph } from './repository-graph.js'
import { renderGraphViewer } from './graph-viewer.js'

export async function runGraphCli(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    out: { type: 'string' }, project: { type: 'string' }, 'path-prefix': { type: 'string' }, json: { type: 'boolean' },
  } })
  if (positionals.length !== 1 || !values.out || !isAbsolute(values.out) || resolve(values.out) !== values.out) throw new Error('graph requires one canonical checkout ROOT and --out ABS [--json] [--project REL] [--path-prefix REL]')
  const root = await realpath(positionals[0])
  if (root !== positionals[0] || await resolveCheckoutRoot(root) !== root) throw new Error('graph requires the canonical Git checkout root')
  // Existing, canonical ancestor chain. Never follow a symlink or overwrite.
  const parent = dirname(values.out)
  if (await realpath(parent) !== parent || !(await lstat(parent)).isDirectory()) throw new Error('graph output parent must be a canonical existing directory')
  const navigation = new RepositoryNavigation(root)
  await navigation.refresh()
  const graph = await buildRepositoryGraph(navigation, { project: values.project, pathPrefix: values['path-prefix'] })
  const output = values.json ? JSON.stringify(graph) + '\n' : renderGraphViewer(graph)
  if (Buffer.byteLength(output) > 16 * 1024 * 1024) throw new Error('graph export exceeds 16 MiB; narrow --path-prefix')
  const file = await open(values.out, 'wx', 0o600)
  try { await file.writeFile(output); await file.sync() } finally { await file.close() }
  return { status: 'written', format: values.json ? 'json' : 'offline-html', nodes: graph.nodes.length, edges: graph.edges.length,
    generation: graph.generation, revision: graph.revision, completeness: graph.completeness }
}
