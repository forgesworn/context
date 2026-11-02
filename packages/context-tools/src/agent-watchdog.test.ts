import { expect, it } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const stopped = (pid: number) => {
  try { return /Z/.test(execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch { return true }
}
async function probe(duration: number, ignoreTerm: boolean, parentDeath: boolean) {
  const guard = fileURLToPath(new URL('../dist/agent-watchdog.js', import.meta.url))
  const script = `const{spawn,fork}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify((ignoreTerm ? "process.on('SIGTERM',()=>{});" : '') + 'setInterval(()=>{},1000)')}],{detached:true,stdio:'ignore'});const guard=fork(process.argv[1],[String(child.pid),process.argv[2]],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});guard.once('message',()=>process.stdout.write(JSON.stringify({child:child.pid,guard:guard.pid})+'\\n'));child.once('exit',()=>{if(guard.connected)guard.send('finished');process.exit(0)});process.stdin.resume();`
  const parent = spawn(process.execPath, ['--input-type=commonjs', '-e', script, guard, String(duration)], { stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = createInterface({ input: parent.stdout })
  let owned: { child: number; guard: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ready = await Promise.race([once(lines, 'line').then(([line]) => line), once(parent, 'exit').then(() => { throw new Error('Watchdog launcher exited before ready') }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Watchdog ready deadline')), 5000) })])
    clearTimeout(timer); owned = JSON.parse(ready)
    if (parentDeath) parent.kill('SIGKILL')
    const deadline = Date.now() + 6000
    while (Date.now() < deadline && (!stopped(owned!.child) || !stopped(owned!.guard))) await new Promise(resolve => setTimeout(resolve, 50))
    expect(stopped(owned!.child)).toBe(true)
    expect(stopped(owned!.guard)).toBe(true)
  } finally {
    clearTimeout(timer); lines.close()
    if (parent.exitCode === null && parent.signalCode === null) { const exit = once(parent, 'exit'); parent.kill('SIGKILL'); await exit }
    if (owned) for (const pid of [owned.child, owned.guard]) if (!stopped(pid)) { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
}

it('independently enforces the host wall clock and escalates an ignored termination signal', async () => { await probe(1000, true, false) }, 15000)
it('stops the owned host when its console parent disappears', async () => { await probe(30000, false, true) }, 15000)
