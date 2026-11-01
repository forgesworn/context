import { execFile } from 'node:child_process'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { WorkspaceStore, workspaceKey } from './workspace-store.js'
const exec=promisify(execFile)
export const gitEnvironment=()=>({...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_OPTIONAL_LOCKS:'0'})
export async function git(root:string,args:string[]) { return (await exec('git',['-C',root,...args],{env:gitEnvironment(),timeout:5000,maxBuffer:2*1024*1024})).stdout.trim() }
export interface Checkout {root:string;commonDirectory:string;branch:string|null;head:string|null}
export async function describeCheckout(input:string):Promise<Checkout> {
 const root=await realpath(input)
 if(!isAbsolute(input)||root!==input||await git(root,['rev-parse','--show-toplevel'])!==root)throw new Error('expectedRoot must be the canonical Git checkout root')
 const commonDirectory=await realpath(await git(root,['rev-parse','--path-format=absolute','--git-common-dir']))
 const head=await git(root,['rev-parse','--verify','HEAD']).catch(()=>null)
 const branch=await git(root,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>null)
 return {root,commonDirectory,branch,head}
}
export interface WorkspaceCatalogue {version:1;workspace:string;discoveredAt:number;repositories:Checkout[];skipped:{path:string;reason:string}[];scope:string}
export async function discoverWorkspace(workspace:string,store:WorkspaceStore):Promise<WorkspaceCatalogue> {
 if(await realpath(workspace)!==workspace)throw new Error('workspace must be a canonical absolute directory')
 const repositories=new Map<string,Checkout>(),skipped:WorkspaceCatalogue['skipped']=[]
 const within=(root:string)=>{const rel=relative(workspace,root);return rel===''||(!rel.startsWith('..')&&!isAbsolute(rel))}
 const candidates:{path:string;depth:number}[]=[{path:workspace,depth:0}]
 let visited=0
 while(candidates.length){
  const candidate=candidates.pop()!;if(++visited>10000)throw new Error('workspace discovery directory bound exceeded')
  let info
  try{info=await lstat(candidate.path)}catch{skipped.push({path:candidate.path,reason:'directory disappeared or is inaccessible'});continue}
  if(info.isSymbolicLink()||!info.isDirectory())continue
  let marker
  try{marker=await lstat(join(candidate.path,'.git'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){skipped.push({path:candidate.path,reason:'Git metadata is inaccessible'});continue}}
  if(marker){
   try{
    const checkout=await describeCheckout(candidate.path);repositories.set(checkout.root,checkout)
    const worktrees=await git(checkout.root,['worktree','list','--porcelain','-z'])
    for(const field of worktrees.split('\0'))if(field.startsWith('worktree ')){
     const p=field.slice(9);if(!within(p)){skipped.push({path:p,reason:'worktree outside selected workspace'});continue}
     if(repositories.has(p))continue
     try{const wt=await describeCheckout(p);repositories.set(wt.root,wt)}catch{skipped.push({path:p,reason:'unavailable or non-canonical worktree'})}
    }
   }catch{skipped.push({path:candidate.path,reason:'not an available canonical Git checkout'})}
   if(repositories.size>2000)throw new Error('workspace checkout bound exceeded')
   continue
  }
  if(candidate.depth>=3)continue
  let entries
  try{entries=await readdir(candidate.path,{withFileTypes:true})}catch{skipped.push({path:candidate.path,reason:'directory disappeared or cannot be listed'});continue}
  if(entries.length>10000)throw new Error('workspace discovery entry bound exceeded')
  for(const entry of entries)if(entry.isDirectory()&&!entry.isSymbolicLink()&&!['node_modules','target','dist','build','vendor','.git','.cache'].includes(entry.name)){
   candidates.push({path:join(candidate.path,entry.name),depth:candidate.depth+1})
  }
 }
 const result:WorkspaceCatalogue={version:1,workspace,discoveredAt:Date.now(),repositories:[...repositories.values()].sort((a,b)=>a.root.localeCompare(b.root)),skipped,
  scope:'directories to depth 3, stopping at Git checkouts; registered worktrees within the selected workspace; no symlink traversal or source execution; nested independent repos inside a checkout are not inferred'}
 store.put(workspaceKey('catalogue',workspace),'catalogue',result);return result
}
