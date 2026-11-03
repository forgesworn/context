import { parseArgs } from 'node:util'
import { readFile, realpath } from 'node:fs/promises'
import type { ContextVaultOptions } from '@forgesworn/context'

export interface ContextCliOptions {
  name?: string
  /** Trusted application adapter, never read from CLI input. */
  configureVault?: (options: ContextVaultOptions) => ContextVaultOptions
}
export async function main(options: ContextCliOptions = {}): Promise<void> {
  if (process.argv[2] === 'workflow') {
    const { runWorkflowCli } = await import('./host-workflow-cli.js')
    process.stdout.write(JSON.stringify(await runWorkflowCli(process.argv.slice(3))) + '\n')
    return
  }
  if (process.argv[2] === 'startup') {
    const { runStartupHook } = await import('./startup-hook.js')
    process.stdout.write(await runStartupHook(process.argv.slice(3),[process.execPath,await realpath(process.argv[1])]))
    return
  }
  if (process.argv[2] === 'setup-hooks') {
    const { runHostHookSetup } = await import('./host-hooks.js')
    process.stdout.write(JSON.stringify(await runHostHookSetup(process.argv.slice(3),[process.execPath,await realpath(process.argv[1])]))+'\n')
    return
  }
  if (process.argv[2] === 'usage') {
    const { runDailyUsageCli } = await import('./daily-usage.mjs')
    try { runDailyUsageCli(process.argv.slice(3)) }
    catch { throw new Error('daily-usage: invalid, changing or inaccessible input/output') }
    return
  }
  if (process.argv[2] === 'graph') {
    const { runGraphCli } = await import('./graph-cli.js')
    process.stdout.write(JSON.stringify(await runGraphCli(process.argv.slice(3))) + '\n')
    return
  }
  if (process.argv[2] === 'setup') {
    const { runHostSetup } = await import('./host-startup.js')
    process.stdout.write(JSON.stringify(await runHostSetup(process.argv.slice(3), [process.execPath, await realpath(process.argv[1])])) + '\n')
    return
  }
  if (process.argv[2] === 'workspace') {
    const { runWorkspaceCli, WorkspaceCliText, WorkspaceCliJson } = await import('./workspace-cli.js')
    const result = await runWorkspaceCli(process.argv.slice(3))
    process.stdout.write(result instanceof WorkspaceCliText ? result.text : result instanceof WorkspaceCliJson ? JSON.stringify(result.value) + '\n' : JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (process.argv[2] === 'handover') {
    const { runHandoverCli, formatHandoverError } = await import('./task-handover.mjs')
    try { await runHandoverCli(process.argv.slice(3)) }
    catch (error) { throw new Error(formatHandoverError(error)) }
    return
  }
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    identity: { type: 'string' }, state: { type: 'string' }, room: { type: 'string' },
    'expect-pubkey': { type: 'string' }, personal: { type: 'boolean' },
    server: { type: 'string', multiple: true }, help: { type: 'boolean' },
    'max-packages': { type: 'string' }, 'max-depth': { type: 'string' }, 'observed-at': { type: 'string' },
    'max-files': { type: 'string' }, 'max-bytes': { type: 'string' },
    'max-file-bytes': { type: 'string' }, 'max-records': { type: 'string' },
    'max-repositories': { type: 'string' },
    project: { type: 'string' },
    term: { type: 'string' },
    'handover-dir': { type: 'string' },
    'handover-base': { type: 'string' },
    'cache-dir': { type: 'string' },
    task: { type: 'string' }, label: { type: 'string' }, path: { type: 'string', multiple: true },
  } })
  if (values.help) {
    process.stdout.write((options.name ?? 'encrypted-context') + ' mcp|call <tool> --identity <existing agent hex-key file> --expect-pubkey <agent hex pubkey> --state <encrypted cache> --room <room hex id> [--server <HTTPS origin> ...]\n' +
      (options.name ?? 'encrypted-context') + ' navigate [directory] [--handover-dir <existing private directory>]   (no directory: the Git checkout containing the working directory)\n' +
      (options.name ?? 'encrypted-context') + ' session [--handover-base <existing private directory>] [--cache-dir <initialised private directory>]   (any working folder; expectedRoot required on every call)\n' +
      (options.name ?? 'encrypted-context') + ' connect ROOT [--handover-base ABS] [--cache-dir ABS --label HOST --task TEXT [--path REL ...]]   (task-scoped JSON-lines shell connection; newline per request)\n' +
      (options.name ?? 'encrypted-context') + ' setup codex|claude|kimi [--config-dir ABS] [--cache-dir ABS] [--handover-base ABS] [--remove] [--apply]   (preview a managed global instruction section; --apply writes it)\n' +
      (options.name ?? 'encrypted-context') + ' setup-hooks codex|claude|kimi [--launcher ABS] [--config-dir ABS] [--cache-dir ABS] [--handover-base ABS] [--remove] [--apply]   (preview automatic context startup hooks; Codex requires hook trust)\n' +
      (options.name ?? 'encrypted-context') + ' graph ROOT --out ABS [--json] [--project REL] [--path-prefix REL]   (private offline graph export; never overwrites)\n' +
      (options.name ?? 'encrypted-context') + ' workflow init|plan|append|qualify --root ABS ...   (offline host workflow snapshots; see HOST-WORKFLOWS.md; no execution)\n' +
      (options.name ?? 'encrypted-context') + ' usage start|finish|import|import-worker|import-run|import-kimi|summary|task --input ABS --spec ABS --out ABS   (offline accounting; see DAILY-USAGE.md for command-specific options)\n' +
      (options.name ?? 'encrypted-context') + ' workspace init|discover ROOT|warm ROOT|status ROOT|index ROOT|forget-index ROOT --cache-dir ABS [--resume|--missing-only] [--priority ABS] [--max-repositories N] [--timeout-ms N]\n' +
      (options.name ?? 'encrypted-context') + ' workspace activity ROOT --cache-dir ABS [--all] [--json] [--repo ABS] [--limit 1-500] [--max-bytes 2048-262144] [--timeout-ms 1-30000]   (one-shot advisory leases; not process liveness or acceptance)\n' +
       (options.name ?? 'encrypted-context') + ' workspace dashboard ROOT --cache-dir ABS [--repo ABS] [--handover-base ABS] [--girnel-links ABS]   (local read-only ticket viewer; Ctrl-C to stop)\n' +
       '  Add --control-dir ABS for private notes to existing registered agents; optionally add --codex ABS, --claude ABS, --kimi ABS or --ollama-profile ABS [--max-run-seconds 10-900] [--max-active 1-4] to launch owned tasks.\n' +
      (options.name ?? 'encrypted-context') + ' handover save --root ABS --packet ABS --state ABS --out ABS | handover resume --root ABS --handover ABS\n' +
      (options.name ?? 'encrypted-context') + ' doctor <repository-root> --term <known-identifier>\n' +
      (options.name ?? 'encrypted-context') + ' scan <directory> [--max-packages 64] [--max-depth 4] [--observed-at <epoch-seconds>]\n' +
      (options.name ?? 'encrypted-context') + ' scan-source <directory> [--project REL] [--max-files 64] [--max-depth 8] [--max-bytes 1048576] [--max-file-bytes 262144] [--max-records 128] [--observed-at <epoch-seconds>]\n' +
      (options.name ?? 'encrypted-context') + ' scan-broad-source <directory> [--max-files 64] [--max-depth 8] [--max-bytes 1048576] [--max-file-bytes 262144] [--max-records 128] [--observed-at <epoch-seconds>]\n' +
      (options.name ?? 'encrypted-context') + ' scan-ecosystem <manifest.json> [--max-repositories 32] [--max-files 128] [--max-records 128] [--observed-at <epoch-seconds>]\nUse --personal instead of --room only for a separate private assistant. CLI call reads a JSON object from stdin. Scans need no identity. No key is generated and no network is contacted on startup.\n')
    return
  }
  const integer = (value: string | undefined): number | undefined => value === undefined ? undefined : Number(value)
  if (values.project !== undefined && positionals[0] !== 'scan-source') throw new Error('--project is only supported by scan-source and graph')
  if (positionals[0] === 'connect') {
    if (positionals.length !== 2 || Object.keys(values).some(key => !['handover-base', 'cache-dir', 'task', 'label', 'path'].includes(key))) throw new Error('connect requires one canonical checkout root and only its documented options. See --help.')
    if (values.task === undefined && (values.label !== undefined || values.path !== undefined)) throw new Error('connect --label and --path require --task')
    if (values.task !== undefined && (!values.task || !values.label || !values['cache-dir'])) throw new Error('connect --task requires --label and --cache-dir')
    const { runRepositoryShell } = await import('./repository-shell.js')
    await runRepositoryShell({ root: positionals[1], handoverBase: values['handover-base'], cacheDirectory: values['cache-dir'],
      task: values.task === undefined ? undefined : { label: values.label!, task: values.task, paths: values.path ?? [] },
    }, process.stdin, process.stdout)
    return
  }
  if (values.task !== undefined || values.label !== undefined || values.path !== undefined) throw new Error('--task, --label and --path are only supported by connect. See --help.')
  if (positionals[0] === 'session') {
    if (positionals.length !== 1 || Object.keys(values).some(key => key !== 'handover-base' && key !== 'cache-dir')) throw new Error('session only accepts --handover-base and --cache-dir. See --help.')
    const { serveRepositorySessionMcp } = await import('./repository-session-mcp.js')
    await serveRepositorySessionMcp({ handoverBase: values['handover-base'], cacheDirectory: values['cache-dir'] })
    return
  }
  if (values['cache-dir'] !== undefined) throw new Error('--cache-dir is only supported by session and workspace. See --help.')
  if (values['handover-base'] !== undefined) throw new Error('--handover-base is only supported by session. See --help.')
  if (positionals[0] === 'doctor') {
    if (positionals.length !== 2 || !values.term || Object.keys(values).some(key => key !== 'term')) {
      throw new Error('Choose one repository root and --term <known-identifier>. doctor takes no other flags. See --help.')
    }
    const { diagnoseRepository } = await import('./repository-doctor.js')
    process.stdout.write(JSON.stringify(await diagnoseRepository(positionals[1], values.term), null, 2) + '\n')
    return
  }
  if (values.term !== undefined) throw new Error('--term is only supported by doctor. See --help.')
  if (positionals[0] === 'navigate') {
    if (positionals.length > 2) throw new Error('Choose at most one directory to navigate.')
    if (Object.keys(values).some(key => key !== 'handover-dir')) throw new Error('navigate only accepts --handover-dir. See --help.')
    const { resolveCheckoutRoot, serveRepositoryNavigationMcp } = await import('./repository-navigation-mcp.js')
    // Resolved once: the process stays bound to this root even if the client later changes directory.
    await serveRepositoryNavigationMcp(positionals[1] ?? await resolveCheckoutRoot(process.cwd()), { handoverDirectory: values['handover-dir'] })
    return
  }
  if (values['handover-dir'] !== undefined) throw new Error('--handover-dir is only supported by navigate. See --help.')
  if (positionals[0] === 'scan-broad-source') {
    if (positionals.length !== 2) throw new Error('Choose one directory to scan.')
    const { scanBroadSourceGraph } = await import('./broad-source-scan.js')
    const result = await scanBroadSourceGraph(positionals[1], { maxFiles: integer(values['max-files']),
      maxDepth: integer(values['max-depth']), maxBytes: integer(values['max-bytes']), maxFileBytes: integer(values['max-file-bytes']),
      maxRecords: integer(values['max-records']), observedAt: integer(values['observed-at']) })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (positionals[0] === 'scan-ecosystem') {
    if (positionals.length !== 2) throw new Error('Choose one ecosystem manifest to scan.')
    const { scanEcosystem } = await import('./ecosystem-scan.js')
    const result = await scanEcosystem(positionals[1], { maxRepositories: integer(values['max-repositories']),
      maxFiles: integer(values['max-files']), maxDepth: integer(values['max-depth']), maxBytes: integer(values['max-bytes']),
      maxFileBytes: integer(values['max-file-bytes']), maxRecords: integer(values['max-records']), observedAt: integer(values['observed-at']) })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (positionals[0] === 'scan') {
    if (positionals.length !== 2) throw new Error('Choose one directory to scan.')
    const { scanPackageEcosystem } = await import('./repository-scan.js')
    const result = await scanPackageEcosystem(positionals[1], { maxPackages: integer(values['max-packages']),
      maxDepth: integer(values['max-depth']), observedAt: integer(values['observed-at']) })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (positionals[0] === 'scan-source') {
    if (positionals.length !== 2) throw new Error('Choose one directory to scan.')
    const { scanSourceGraph } = await import('./source-scan.js')
    const result = await scanSourceGraph(positionals[1], { project: values.project, maxFiles: integer(values['max-files']),
      maxDepth: integer(values['max-depth']), maxBytes: integer(values['max-bytes']),
      maxFileBytes: integer(values['max-file-bytes']), maxRecords: integer(values['max-records']),
      observedAt: integer(values['observed-at']) })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  if (!values.identity || !values.state || !values['expect-pubkey'] || (!!values.room === !!values.personal)) throw new Error('Supply --identity, --expect-pubkey, --state and exactly one of --room or --personal. See --help.')
  if (!['mcp', 'call'].includes(positionals[0]) || positionals.length !== (positionals[0] === 'call' ? 2 : 1)) throw new Error('Choose mcp, or call <tool>.')
  const [{ hexToBytes }, { createNostrIdentity }, { ContextFileStore }, { serveContextMcp, callContextTool }] = await Promise.all([
    import('@noble/hashes/utils'), import('@forgesworn/context/nostr'), import('./context-store.js'), import('./context-mcp.js'),
  ])
  const raw = (await readFile(values.identity, 'utf8')).trim()
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Identity file must contain an existing agent’s 32-byte hexadecimal key.')
  const sk = hexToBytes(raw), identity = createNostrIdentity(sk)
  if (identity.pubkey !== values['expect-pubkey']) throw new Error('Identity does not match the pinned agent pubkey.')
  const vaultOptions = { identity, room: values.room, servers: values.server }
  const store = new ContextFileStore(values.state, options.configureVault?.(vaultOptions) ?? vaultOptions)
  if (positionals[0] === 'mcp') { await serveContextMcp(store); return }
  let input = ''
  for await (const part of process.stdin) { input += part; if (input.length > 120000) throw new Error('Context request too large.') }
  let args
  try { args = JSON.parse(input || '{}') } catch { throw new Error('Invalid context request JSON.') }
  // Retrieval budgets its compact JSON payload, including provenance. Do not
  // inflate that payload with CLI-only indentation after measuring it.
  process.stdout.write(JSON.stringify(await callContextTool(store, positionals[1], args), null, positionals[1] === 'context_retrieve' ? undefined : 2) + '\n')
}
