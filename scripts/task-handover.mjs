#!/usr/bin/env node
/** Compatibility entrypoint; the installed tools package owns task continuity. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHandoverCli, formatHandoverError } from '../packages/context-tools/dist/task-handover.mjs';
export { saveHandover, resumeHandover } from '../packages/context-tools/dist/task-handover.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHandoverCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(formatHandoverError(error) + '\n');
    process.exitCode = 1;
  });
}
