import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setupHostHooks } from './host-hooks.js'
import { startupContext } from './startup-hook.js'
const owned:string[]=[]
afterEach(async()=>{for(const path of owned.splice(0))await rm(path,{recursive:true,force:true})})
async function fixture(){const dir=await realpath(await mkdtemp(join(tmpdir(),'z1p-hooks-')));owned.push(dir);await mkdir(join(dir,'skills/z1p-context'),{recursive:true});await writeFile(join(dir,'skills/z1p-context/SKILL.md'),'Shared skill');return dir}
const command=['/absolute/node','/absolute/cli.mjs']

it.each(['codex','claude']as const)('preserves other JSON settings and handlers during %s hook preview/apply/remove',async host=>{
  const configDirectory=await fixture(),path=join(configDirectory,host==='codex'?'hooks.json':'settings.json')
  const original='{\n  "custom" : "keep bytes",\n  "hooks": {"SessionStart": [{"matcher":"resume", "hooks":[{"type":"command", "command":"echo keep"}]}]}\n}\n'
  await writeFile(path,original)
  const opts={host,configDirectory,command}
  const preview=await setupHostHooks(opts);expect(preview.applied).toBe(false);expect(await readFile(path,'utf8')).toBe(original)
  await setupHostHooks({...opts,apply:true});const after=await readFile(path,'utf8')
  expect(after).toContain('"custom" : "keep bytes"');expect(after).toContain('{"matcher":"resume", "hooks":[{"type":"command", "command":"echo keep"}]}')
  expect(JSON.parse(after).hooks.SessionStart).toHaveLength(2)
  expect((await setupHostHooks({...opts,apply:true})).action).toBe('current')
  await setupHostHooks({...opts,remove:true,apply:true});expect(await readFile(path,'utf8')).toBe(original)
  expect(preview.trustReviewRequired).toBe(host==='codex')
})

it('keeps Kimi TOML bytes and unrelated hooks while installing prompt-context injection',async()=>{
  const configDirectory=await fixture(),path=join(configDirectory,'config.toml'),original='default_model = "keep"\n\n[[hooks]]\nevent="Notification"\ncommand="echo keep"\n'
  await writeFile(path,original)
  const opts={host:'kimi' as const,configDirectory,command,apply:true}
  await setupHostHooks(opts);const after=await readFile(path,'utf8');expect(after.startsWith(original)).toBe(true);expect(after).toContain('event = "UserPromptSubmit"')
  expect((await setupHostHooks(opts)).action).toBe('current')
  await setupHostHooks({...opts,remove:true});expect(await readFile(path,'utf8')).toBe(original)
})

it('restores a Kimi configuration with no final newline exactly',async()=>{
  const configDirectory=await fixture(),path=join(configDirectory,'config.toml'),original='default_model = "keep"'
  await writeFile(path,original)
  const opts={host:'kimi' as const,configDirectory,command,apply:true}
  await setupHostHooks(opts);await setupHostHooks({...opts,remove:true});expect(await readFile(path,'utf8')).toBe(original)
})

it('updates only its handler when an owner adds another handler in the managed group',async()=>{
  const configDirectory=await fixture(),path=join(configDirectory,'settings.json'),opts={host:'claude' as const,configDirectory,command,apply:true}
  await setupHostHooks(opts);const data=JSON.parse(await readFile(path,'utf8'));data.hooks.SessionStart[0].hooks.push({type:'command',command:'echo keep'});await writeFile(path,JSON.stringify(data))
  await setupHostHooks({...opts,command:['/new/node','/new/cli']});expect(JSON.parse(await readFile(path,'utf8')).hooks.SessionStart[0].hooks[1].command).toBe('echo keep')
  await setupHostHooks({...opts,remove:true});expect(JSON.parse(await readFile(path,'utf8')).hooks.SessionStart[0].hooks).toEqual([{type:'command',command:'echo keep'}])
})

it('refuses linked, duplicate-key and concurrently locked configuration',async()=>{
  const configDirectory=await fixture(),path=join(configDirectory,'hooks.json'),opts={host:'codex' as const,configDirectory,command,apply:true}
  await writeFile(path,'{"hooks":{},"ho\\u006fks":{}}');await expect(setupHostHooks(opts)).rejects.toThrow(/Duplicate/)
  await rm(path);await symlink(join(configDirectory,'skills/z1p-context/SKILL.md'),path);await expect(setupHostHooks(opts)).rejects.toThrow(/links/)
  await rm(path);await writeFile(path,'{}');await writeFile(path+'.z1p-startup.lock','active');await expect(setupHostHooks(opts)).rejects.toThrow();expect(await readFile(path,'utf8')).toBe('{}')
})

it('startup selects only the current Git checkout and leaves a parent workspace unselected',async()=>{
  const root=await fixture(),exec=promisify(execFile);await exec('git',['-C',root,'init','-q'])
  const opts={host:'claude' as const,skill:join(root,'skills/z1p-context/SKILL.md'),command}
  const result=JSON.parse(await startupContext({cwd:root,hook_event_name:'SessionStart'},opts))
  expect(result.hookSpecificOutput.additionalContext).toContain(JSON.stringify(root));expect(result.hookSpecificOutput.additionalContext).toContain('"sourceScanned":false')
  const parent=await fixture();const other=JSON.parse(await startupContext({cwd:parent,hook_event_name:'SessionStart'},opts))
  expect(other.hookSpecificOutput.additionalContext).toContain('"checkout":null');expect(other.hookSpecificOutput.additionalContext).not.toContain(JSON.stringify(root)+'\n')
  const kimi=await startupContext({cwd:root,hook_event_name:'UserPromptSubmit'},{...opts,host:'kimi'});expect(kimi.startsWith('Z1P repository context')).toBe(true)
  await expect(startupContext({cwd:root,hook_event_name:'PreToolUse'},opts)).rejects.toThrow(/input/)
})

it('respects Git discovery ceilings while ignoring environment redirects',async()=>{
  const root=await fixture(),other=await fixture(),exec=promisify(execFile)
  await exec('git',['-C',root,'init','-q']);await exec('git',['-C',other,'init','-q'])
  const parent=join(root,'workspace');await mkdir(parent);await mkdir(join(parent,'child'))
  await exec('git',['-C',join(parent,'child'),'init','-q'])
  const previous={ceiling:process.env.GIT_CEILING_DIRECTORIES,dir:process.env.GIT_DIR}
  process.env.GIT_CEILING_DIRECTORIES=root;process.env.GIT_DIR=join(other,'.git')
  try {
    const output=JSON.parse(await startupContext({cwd:parent,hook_event_name:'SessionStart'},{host:'claude',skill:join(root,'skills/z1p-context/SKILL.md'),command}))
    expect(output.hookSpecificOutput.additionalContext).toContain('"checkout":null')
    expect(output.hookSpecificOutput.additionalContext).toContain('"sourceFreshness":"not-checked"')
    expect(output.hookSpecificOutput.additionalContext).toContain("'ROOT'")
  } finally {
    for(const [key,value]of [['GIT_CEILING_DIRECTORIES',previous.ceiling],['GIT_DIR',previous.dir]]as const)if(value===undefined)delete process.env[key];else process.env[key]=value
  }
})
