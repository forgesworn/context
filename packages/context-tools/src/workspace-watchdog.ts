// A separate, short-lived timer survives loss of the warm-up parent. IPC loss
// means the index process ended: never retain a timer against a recycled PID.
const parent=Number(process.argv[2]),timeout=Number(process.argv[3])
if(!process.connected||!Number.isSafeInteger(parent)||parent<=1||process.ppid!==parent||!Number.isSafeInteger(timeout)||timeout<100||timeout>122000)process.exit(2)
const timer=setTimeout(()=>{if(process.connected&&process.ppid===parent){try{process.kill(parent,'SIGKILL')}catch{}}process.exit(0)},timeout)
const done=()=>{clearTimeout(timer);process.exit(0)}
process.on('disconnect',done)
process.on('message',message=>{if(message==='finished')done()})
process.send!('ready')
