// Copy only the maintained skill resources into the recipient's built package.
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
for(const path of ['SKILL.md','references/coordination.md','references/handover.md','references/shell-connection.md','references/ollama.md','references/ollama-worker.md']) {
  const source=join(root,'skill',path),target=join(root,'packages/context-tools/dist/skill',path),info=await lstat(source);
  if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new Error('Invalid packaged skill resource');
  await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(source));
}
