import { afterEach, expect, it } from 'vitest'
import { mkdtemp, realpath, readFile, readdir, rm, chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialiseWorkspaceStore, WorkspaceStore } from './workspace-store.js'
const paths: string[] = []
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }) })
async function directory() { const p = await realpath(await mkdtemp(join(tmpdir(), 'z1p-store-'))); paths.push(p); await chmod(p, 0o700); return p }
it('persists authenticated encrypted records across connections, with no plaintext in database or journal', async () => {
 const dir=await directory(); await initialiseWorkspaceStore(dir)
 let store=new WorkspaceStore(dir); store.put('index:root','index',{source:'PRIVATE_SOURCE_MARKER_71829',root:'/private/project'})
 store.close(); store=new WorkspaceStore(dir)
 expect(store.get('index:root')).toEqual({source:'PRIVATE_SOURCE_MARKER_71829',root:'/private/project'})
 store.close()
 for(const name of await readdir(dir)) if(name!=='key') expect((await readFile(join(dir,name))).includes(Buffer.from('PRIVATE_SOURCE_MARKER_71829'))).toBe(false)
})
it('rolls back failed coordination updates and enforces a shared byte budget without deleting coordination', async () => {
 const dir=await directory(); await initialiseWorkspaceStore(dir)
 const a=new WorkspaceStore(dir, 4000), b=new WorkspaceStore(dir,4000)
 try {
  a.put('board:x','board',{revision:1})
  expect(()=>a.transaction(()=>{a.put('board:x','board',{revision:2});throw new Error('stop')})).toThrow('stop')
  expect(b.get('board:x')).toEqual({revision:1})
  for(let i=0;i<10;i++) a.put('index:'+i,'index',{data:Array.from({length:100},()=>Math.random().toString()).join('')})
  expect(a.info().bytes).toBeLessThanOrEqual(4000)
  expect(b.get('board:x')).toEqual({revision:1})
 }finally{a.close();b.close()}
})
it('rejects non-private storage and changed keys instead of silently creating plaintext state', async () => {
 const dir=await directory(); await initialiseWorkspaceStore(dir)
 const store=new WorkspaceStore(dir); store.put('index:x','index',{marker:'secret'});store.close()
 if(process.platform!=='win32') { await chmod(dir,0o755);expect(()=>new WorkspaceStore(dir)).toThrow();await chmod(dir,0o700) }
 await writeFile(join(dir,'key'),Buffer.alloc(32,7),{mode:0o600})
 const other=new WorkspaceStore(dir);try{expect(()=>other.get('index:x')).toThrow(/authenticate/)}finally{other.close()}
})
