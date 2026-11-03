import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { describeCheckout, gitEnvironment } from './workspace-catalogue.js'

const exec = promisify(execFile)
export interface ConsoleWorktree { root: string; branch: string; baseHead: string; state: 'preparing' | 'ready' | 'unknown' }

/** Git operations here must not execute repository hooks, filters or diff tools. */
export async function reviewGit(root: string) {
  const base = ['-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false']
  const run = async (args: string[]) => (await exec('git', [...base, ...args], { env: gitEnvironment(), timeout: 10000, maxBuffer: 262144 })).stdout
  let keys = ''
  try { keys = await run(['config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$']) }
  catch (error) { if ((error as { code?: unknown }).code !== 1) throw error }
  const drivers = [...new Set(keys.trim().split('\n').filter(Boolean).map(key => key.slice(0, key.lastIndexOf('.'))))]
  if (drivers.length > 128 || drivers.some(driver => driver.length > 512)) throw new Error('Git filter configuration exceeds review bound')
  const disabled = drivers.flatMap(driver => ['-c', driver + '.clean=', '-c', driver + '.smudge=', '-c', driver + '.process=', '-c', driver + '.required=false'])
  return (args: string[]) => run([...disabled, ...args])
}

export async function worktreeLocation(directory: string, id: string, baseHead: string): Promise<ConsoleWorktree> {
  const parent = join(directory, 'worktrees')
  try { await mkdir(parent, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
  const info = await lstat(parent)
  if (await realpath(parent) !== parent || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('Worktree parent must be a canonical private directory')
  return { root: join(parent, id), branch: 'z1p/task-' + id, baseHead, state: 'preparing' }
}

export async function createWorktree(source: string, value: ConsoleWorktree) {
  // The caller journals "preparing" before this external effect. Never retry an
  // uncertain add or remove a path/branch that might contain another process's work.
  const git = await reviewGit(source)
  await git(['worktree', 'add', '-b', value.branch, '--', value.root, value.baseHead])
}

export async function verifyWorktree(directory: string, id: string, value: ConsoleWorktree, commonDirectory: string) {
  if (value.state !== 'ready' || value.root !== join(directory, 'worktrees', id) || value.branch !== 'z1p/task-' + id) throw new Error('Worktree preparation is uncertain; reconcile its saved path and branch manually')
  const checkout = await describeCheckout(value.root)
  if (checkout.commonDirectory !== commonDirectory || checkout.branch !== value.branch) throw new Error('Managed worktree identity or branch changed; reconcile before continuing')
  return checkout
}
