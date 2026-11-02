import { createCipheriv, createDecipheriv, randomBytes, randomUUID, createHash } from 'node:crypto'
import { constants, lstatSync, realpathSync, openSync, closeSync, readFileSync } from 'node:fs'
import { mkdir, open, link, unlink } from 'node:fs/promises'
import { isAbsolute, resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync, gunzipSync } from 'node:zlib'

export const WORKSPACE_CACHE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_VALUE = 32 * 1024 * 1024, MAX_PLAIN = 128 * 1024 * 1024
const FORMAT = Buffer.from('Z1P-local-cache-v1\0')
export const workspaceKey = (kind: string, root: string) => kind + ':' + createHash('sha256').update(root).digest('hex')
function privatePath(path: string, directory = false) {
 const info=lstatSync(path)
 if(!isAbsolute(path)||resolve(path)!==path||realpathSync(path)!==path||info.isSymbolicLink()||
   (directory?!info.isDirectory():!info.isFile())||(process.platform!=='win32'&&(info.mode&0o077))) throw new Error('workspace cache requires canonical private paths (0700 directory, 0600 files)')
}
export async function initialiseWorkspaceStore(directory: string) {
 await mkdir(directory,{recursive:true,mode:0o700});privatePath(directory,true)
 const keyPath=join(directory,'key')
 try { privatePath(keyPath) } catch(error) {
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
  const temporary=join(directory,'.key-'+randomUUID())
  const output=await open(temporary,'wx',0o600)
  try { await output.writeFile(randomBytes(32));await output.sync();await output.close();await link(temporary,keyPath).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e}) }
  finally { await output.close().catch(()=>{});await unlink(temporary) }
 }
 const store=new WorkspaceStore(directory);store.close()
}

/** Encrypted payloads in transactional SQLite. Hash keys/counts are metadata,
 * not access control. Same OS owner only; never a multi-user messaging service. */
export class WorkspaceStore {
 private readonly db: DatabaseSync
 private readonly key: Buffer
 private transactionOpen=false
 readonly directory: string
 constructor(directory: string, readonly budgetBytes=WORKSPACE_CACHE_BYTES, private readonly options: { readOnly?: boolean } = {}) {
  if(!Number.isSafeInteger(budgetBytes)||budgetBytes<1024||budgetBytes>WORKSPACE_CACHE_BYTES)throw new Error('invalid workspace cache budget')
  privatePath(directory,true);this.directory=directory
  const keyPath=join(directory,'key');privatePath(keyPath)
  if(lstatSync(keyPath).size!==32)throw new Error('workspace cache key must contain exactly 32 bytes')
  const keyFd=openSync(keyPath,constants.O_RDONLY|constants.O_NOFOLLOW)
  try{this.key=readFileSync(keyFd)}finally{closeSync(keyFd)}
  if(this.key.length!==32)throw new Error('workspace cache key must contain exactly 32 bytes')
  const file=join(directory,'workspace.sqlite')
  if(!options.readOnly){try{const fd=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);closeSync(fd)}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e}}
  privatePath(file)
  this.db=new DatabaseSync(file,{readOnly:options.readOnly===true})
  try {
   if(options.readOnly)this.db.exec('PRAGMA busy_timeout=1000; PRAGMA query_only=ON')
   else this.db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA auto_vacuum=FULL; PRAGMA max_page_count=1048576; CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, kind TEXT NOT NULL, value BLOB NOT NULL, updated INTEGER NOT NULL)')
  }catch(e){this.db.close();throw e}
 }
 private writable(){if(this.options.readOnly)throw new Error('workspace store is read-only')}
 private check(){privatePath(this.directory,true);privatePath(join(this.directory,'key'));privatePath(join(this.directory,'workspace.sqlite'))}
 get<T=unknown>(key: string): T | undefined {
  this.check()
  const row=this.db.prepare('SELECT value FROM documents WHERE key=? AND length(value)<=?').get(key,MAX_VALUE) as {value:Uint8Array}|undefined
  if(!row)return undefined
  try {
   const encrypted=Buffer.from(row.value), decipher=createDecipheriv('aes-256-gcm',this.key,encrypted.subarray(0,12))
   decipher.setAAD(Buffer.concat([FORMAT,Buffer.from(key)]));decipher.setAuthTag(encrypted.subarray(12,28))
   const bytes=Buffer.concat([decipher.update(encrypted.subarray(28)),decipher.final()])
   return JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_PLAIN}).toString('utf8')) as T
  } catch { throw new Error('cannot authenticate or decode workspace cache; preserve the key and inspect/reset this disposable entry') }
 }
 put(key: string, kind: 'index'|'board'|'catalogue'|'warm'|'console', value: unknown) {
  this.writable();this.check()
  const plain=Buffer.from(JSON.stringify(value));if(plain.length>MAX_PLAIN)throw new Error('workspace cache snapshot exceeds decoded byte limit')
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce)
  cipher.setAAD(Buffer.concat([FORMAT,Buffer.from(key)]))
  const encrypted=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()])
  const payload=Buffer.concat([nonce,cipher.getAuthTag(),encrypted])
  if(payload.length>MAX_VALUE||payload.length>this.budgetBytes)throw new Error('workspace cache entry exceeds byte budget')
  const update=()=>{
   this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,value=excluded.value,updated=excluded.updated').run(key,kind,payload,Date.now())
   let bytes=this.info().bytes
   while(bytes>this.budgetBytes){
    const oldest=this.db.prepare("SELECT key,length(value) AS bytes FROM documents WHERE kind='index' AND key<>? ORDER BY updated,key LIMIT 1").get(key) as {key:string,bytes:number}|undefined
    if(!oldest)throw new Error('workspace cache budget exhausted by retained coordination/catalogue data')
    this.db.prepare('DELETE FROM documents WHERE key=?').run(oldest.key);bytes-=oldest.bytes
   }
  }
  if(this.transactionOpen)update();else this.transaction(update)
 }
 transaction<T>(action:()=>T):T {
  this.writable();this.check();if(this.transactionOpen)throw new Error('nested workspace transactions are unsupported')
  this.db.exec('BEGIN IMMEDIATE');this.transactionOpen=true
  try{const value=action();this.db.exec('COMMIT');return value}catch(e){this.db.exec('ROLLBACK');throw e}finally{this.transactionOpen=false}
 }
 has(key:string){this.check();return this.db.prepare('SELECT 1 FROM documents WHERE key=?').get(key)!==undefined}
 remove(key:string){this.writable();this.check();this.db.prepare('DELETE FROM documents WHERE key=?').run(key)}
 info(){return this.db.prepare("SELECT count(*) AS entries, coalesce(sum(length(value)),0) AS bytes, coalesce(sum(kind='index'),0) AS indexes FROM documents").get() as {entries:number,bytes:number,indexes:number}}
 close(){this.db.close();this.key.fill(0)}
}
