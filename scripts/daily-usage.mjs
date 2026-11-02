#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDailyUsageCli } from '../packages/context-tools/dist/daily-usage.mjs';
export { startUsage, finishUsage, importUsage, importWorkerUsage, importCliUsage, importKimiUsage, summariseUsage, reconcileTaskUsage } from '../packages/context-tools/dist/daily-usage.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runDailyUsageCli(process.argv.slice(2)); }
  catch { process.stderr.write('daily-usage: invalid, changing or inaccessible input/output\n'); process.exitCode = 2; }
}
