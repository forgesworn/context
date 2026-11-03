import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { open, lstat, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const exec = promisify(execFile)
const arg = z.string().max(2048).refine(v => !v.includes('\0'))
const absolute = arg.refine(v => isAbsolute(v) && resolve(v) === v)
export const profileSchema = z.object({
  version: z.literal(1), python: absolute, helper: absolute, engineeringAdapter: absolute,
  endpoint: z.string().max(256).refine(value => {
    try { const u = new URL(value); return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !!u.port && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash } catch { return false }
  }),
  model: z.string().min(1).max(200), think: z.enum(['false', 'true', 'low', 'high', 'max']),
  maxOutput: z.number().int().min(1).max(65536), timeoutSeconds: z.number().int().min(1).max(850),
  routeReason: z.string().min(1).max(1000),
  verification: z.object({ executable: absolute, args: z.array(arg).max(32), timeoutSeconds: z.number().int().min(1).max(120) }).strict().refine(v => Buffer.byteLength(JSON.stringify(v)) <= 16000, 'Verification preview exceeds byte bound').nullable(),
}).strict()
export type OllamaProfile = z.infer<typeof profileSchema>
export const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
export async function boundedText(path: string, max: number, privateFile = false) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > max || (privateFile && (info.mode & 0o077))) throw new Error('Expected a bounded regular' + (privateFile ? ' private' : '') + ' file')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const bytes = await file.readFile(); if (bytes.length > max) throw new Error('File bound exceeded'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } finally { await file.close() }
}
export async function loadOllamaProfile(path: string, maxRunSeconds = 600) {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) throw new Error('Ollama profile must be an absolute canonical file')
  const p = profileSchema.parse(JSON.parse(await boundedText(path, 16384, true)))
  if (p.timeoutSeconds + 20 > maxRunSeconds) throw new Error('Ollama request timeout needs at least 20 seconds inside the host wall bound')
  for (const file of [p.python, p.helper, p.engineeringAdapter, ...(p.verification ? [p.verification.executable] : [])]) if (!(await lstat(await realpath(file))).isFile()) throw new Error('Ollama profile executables/scripts must exist')
  return p
}
export async function helper(p: OllamaProfile, args: string[], adapter = false, timeout = 15000) {
  const argv = adapter ? [p.engineeringAdapter, ...args, '--endpoint', p.endpoint, '--helper', p.helper] : [p.helper, '--endpoint', p.endpoint, ...args]
  try { return await exec(p.python, argv, { timeout, maxBuffer: 1048576, encoding: 'utf8' }) }
  catch (error) { throw new Error('Worker helper failed; inspect its retained receipt and pending marker. ' + String((error as { stderr?: string }).stderr ?? '').slice(0, 1000)) }
}
export async function ollamaEligibility(p: OllamaProfile) {
  const status = JSON.parse((await helper(p, ['status'])).stdout)
  if (status.endpoint !== p.endpoint || status.pending !== false) throw new Error('Ollama has an unresolved pending request; reconcile in the existing helper')
  const inventory = JSON.parse((await helper(p, ['inventory'])).stdout)
  if (inventory.endpoint !== p.endpoint || !Array.isArray(inventory.models) || !inventory.models.includes(p.model)) throw new Error('Configured Ollama model is not listed by this endpoint; no inference started')
}
