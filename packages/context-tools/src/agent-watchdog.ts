// Independent wall clock and parent-death guard for this newly spawned host.
// Check process start identity before signalling; never act on a recycled PID.
import { execFileSync } from 'node:child_process'
const child = Number(process.argv[2]), duration = Number(process.argv[3])
if (!process.connected || !Number.isSafeInteger(child) || child <= 1 || !Number.isSafeInteger(duration) || duration < 1000 || duration > 900000 || process.platform === 'win32') process.exit(2)
const identity = () => {
  try { return execFileSync('ps', ['-p', String(child), '-o', 'lstart=,pgid='], { encoding: 'utf8', timeout: 1000 }).trim() } catch { return '' }
}
const initial = identity()
if (!initial || Number(initial.split(/\s+/).at(-1)) !== child) process.exit(2)
let stopping = false
const kill = (signal: NodeJS.Signals) => { if (initial === identity()) { try { process.kill(-child, signal) } catch {} } }
const stop = () => {
  if (stopping) return
  stopping = true; kill('SIGTERM')
  setTimeout(() => { kill('SIGKILL'); process.exit(0) }, 1500)
}
const timer = setTimeout(stop, duration)
process.on('disconnect', stop)
process.on('message', value => { if (value === 'finished') { clearTimeout(timer); process.exit(0) } })
process.send!('ready')
