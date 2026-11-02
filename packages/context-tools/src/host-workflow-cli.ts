import { constants } from 'node:fs'
import { open, lstat, realpath, link, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { appendWorkflowEvent, assessHostLifecycle, createWorkflow, planWorkflow } from './host-workflow.js'
import { resolveCheckoutRoot } from './repository-navigation-mcp.js'

const maxBytes = 2 * 1024 * 1024
async function canonicalPath(path: string, output = false) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(dirname(path)) !== dirname(path)) throw new Error('workflow paths must be canonical and absolute')
  if (!output && await realpath(path) !== path) throw new Error('workflow input cannot be a symlink')
}
async function readJson(path: string) {
  await canonicalPath(path)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > maxBytes) throw new Error('workflow input must be a bounded regular file')
    const bytes = Buffer.alloc(before.size)
    let length = 0
    while (length < bytes.length) {
      const part = await file.read(bytes, length, bytes.length - length, length)
      if (!part.bytesRead) break
      length += part.bytesRead
    }
    const after = await file.stat(), named = await lstat(path)
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
      named.isSymbolicLink() || named.ino !== before.ino || named.dev !== before.dev) throw new Error('workflow input changed while reading')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { await file.close() }
}
async function writeRecord(out: string, record: unknown) {
  await canonicalPath(out, true)
  const parent = await lstat(dirname(out))
  if (!parent.isDirectory() || (process.platform !== 'win32' && (parent.mode & 0o077))) throw new Error('workflow output directory must be private (0700)')
  const bytes = JSON.stringify(record) + '\n'
  if (Buffer.byteLength(bytes) > maxBytes) throw new Error('workflow record exceeds 2 MiB')
  const temporary = join(dirname(out), '.workflow-' + randomUUID() + '.tmp')
  let file
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined
    await canonicalPath(out, true)
    await link(temporary, out)
  } finally {
    try { await file?.close() } finally { await unlink(temporary).catch(() => {}) }
  }
  return { format: 'z1p-host-workflow-v1', status: 'written', bytes: Buffer.byteLength(bytes) }
}

/** Offline snapshot operations. No command, model, URL or worker is executed. */
export async function runWorkflowCli(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: Object.fromEntries(
    ['root', 'spec', 'record', 'event', 'observation', 'sequence', 'trace', 'out'].map(key => [key, { type: 'string' as const }]),
  ) })
  const command = positionals[0]
  const accepted: Record<string, string[]> = {
    init: ['root', 'spec', 'out'], plan: ['root', 'record', 'observation'],
    append: ['root', 'record', 'event', 'observation', 'sequence', 'out'], qualify: ['root', 'trace'],
  }
  const fields = accepted[command]
  if (positionals.length !== 1 || !fields || Object.keys(values).length !== fields.length || fields.some(key => !values[key])) {
    throw new Error('workflow requires init --root ABS --spec ABS --out ABS; plan --root ABS --record ABS --observation ABS; append --root ABS --record ABS --event ABS --observation ABS --sequence N --out ABS; or qualify --root ABS --trace ABS')
  }
  const selected = values.root!
  if (await realpath(selected) !== selected || await resolveCheckoutRoot(selected) !== selected) throw new Error('workflow requires the canonical selected Git checkout root')
  if (command === 'qualify') {
    const trace = await readJson(values.trace!)
    if (trace.root !== selected) throw new Error('workflow trace root mismatch')
    return assessHostLifecycle(trace)
  }
  if (command === 'init') {
    const record = createWorkflow(await readJson(values.spec!))
    if (record.spec.root !== selected) throw new Error('workflow spec root mismatch')
    return writeRecord(values.out!, record)
  }
  const record = await readJson(values.record!), observed = await readJson(values.observation!)
  if (record.spec?.root !== selected || observed.root !== selected) throw new Error('workflow record or observation root mismatch')
  if (command === 'plan') return planWorkflow(record, observed)
  if (!/^(0|[1-9][0-9]*)$/.test(values.sequence!) || !Number.isSafeInteger(Number(values.sequence))) throw new Error('workflow sequence must be a nonnegative safe integer')
  const appended = appendWorkflowEvent(record, await readJson(values.event!), Number(values.sequence), observed)
  return { ...await writeRecord(values.out!, appended), sequence: appended.events.length }
}
