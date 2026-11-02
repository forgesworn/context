// Optional real-browser check: node test/graph-browser-probe.mjs GRAPH.html SCREENSHOT.png
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const profile = await mkdtemp(join(tmpdir(), 'context-graph-browser-'));
const chrome = spawn(process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions',`--user-data-dir=${profile}`],
  { stdio: ['ignore','ignore','pipe','pipe','pipe'] });
let sequence = 0, pending = new Map(), buffer = '', sessionId;
const exceptions = [], requests = [];
let stderr = '';
chrome.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
chrome.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  for (;;) {
    const boundary = buffer.indexOf('\0'); if (boundary < 0) break;
    const message = JSON.parse(buffer.slice(0,boundary)); buffer = buffer.slice(boundary+1);
    if (message.id && pending.has(message.id)) { const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result); }
    else if (message.method==='Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    else if (message.method==='Network.requestWillBeSent') requests.push(message.params.request.url);
  }
});
const send = (method,params={},target=sessionId) => new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}; ${stderr}`));},15000);
  pending.set(id,{resolve,reject,timer});chrome.stdio[3].write(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})})+'\0');
});
const evaluate = async expression => {
  const r=await send('Runtime.evaluate',{expression,returnByValue:true});
  if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;
};
try {
  const version=await send('Browser.getVersion');
  const target=await send('Target.createTarget',{url:'about:blank'});
  sessionId=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:pathToFileURL(resolve(process.argv[2])).href});
  let ready=false;
  for(let i=0;i<50;i++){if(await evaluate("Boolean(document.querySelector('#nodes button'))")){ready=true;break;}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'viewer did not render');
  const before=await evaluate("({title:document.querySelector('h1').textContent,buttons:document.querySelectorAll('#nodes button').length,languages:document.querySelector('#language').options.length})");
  assert.equal(before.title,'Z1P local code graph');assert.ok(before.buttons>0);assert.ok(before.languages>1);
  await evaluate("document.querySelector('#search').value='buildRepositoryGraph';document.querySelector('#search').dispatchEvent(new Event('input'))");
  const matches=await evaluate("document.querySelectorAll('#nodes button').length");assert.ok(matches>0);
  await evaluate("document.querySelector('#nodes button').click()");
  const selected=await evaluate("({name:document.querySelector('#name').textContent,source:document.querySelector('#source').textContent.length,graph:document.querySelectorAll('svg circle').length,relationships:document.querySelectorAll('#relationships button').length})");
  assert.equal(selected.name,'buildRepositoryGraph');assert.ok(selected.source>0);assert.ok(selected.graph>1);assert.ok(selected.relationships>0);
  await evaluate("document.querySelector('#relationships button').click()");
  assert.notEqual(await evaluate("document.querySelector('#name').textContent"),selected.name);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'),false);
  assert.deepEqual(exceptions,[]);assert.ok(requests.every(url=>url.startsWith('file:')),'viewer made an external request');
  const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(process.argv[3],Buffer.from(screenshot.data,'base64'),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({browser:version.product,before,selected,matches,exceptions,externalRequests:requests.filter(url=>!url.startsWith('file:')),mobileNoHorizontalOverflow:true}));
} finally {
  await send('Browser.close',{},undefined).catch(()=>{});chrome.kill('SIGTERM');
  await new Promise(resolve=>{if(chrome.exitCode!==null)resolve();else chrome.once('exit',resolve);});
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser closed'));}pending.clear();
  await rm(profile,{recursive:true,force:true});
}
