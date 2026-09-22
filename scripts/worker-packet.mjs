#!/usr/bin/env node
/** Deterministic, source-only handoff packets for the D4 worker workflow. */
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildPacket,
  buildPacketFromSpec,
  buildPacketInline,
  planPacket,
  planPacketInline,
  serializePacket,
  verifyPacket,
} from '../packages/context-tools/dist/source-packet.mjs';

export { buildPacket, buildPacketFromSpec, buildPacketInline, planPacket, planPacketInline, serializePacket, verifyPacket };

function assert(ok, message) { if (!ok) throw new Error(`worker-packet: ${message}`); }
async function writePrivateExclusive(output, packet) {
  assert(typeof output === 'string' && isAbsolute(output), 'out must be an absolute path');
  const parent = dirname(output);
  const parentState = await fs.lstat(parent).catch(() => { throw new Error('worker-packet: output parent does not exist'); });
  assert(parentState.isDirectory() && !parentState.isSymbolicLink(), 'output parent must be a non-symlink directory');
  const handle = await fs.open(output, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600).catch((error) => { throw new Error(`worker-packet: cannot create output exclusively: ${error.code ?? error.message}`); });
  try { await handle.writeFile(serializePacket(packet), 'utf8'); await handle.chmod(0o600); } finally { await handle.close(); }
}
function usage() { return `Usage: node scripts/worker-packet.mjs build --root ABS --spec ABS --out ABS\nUsage: node scripts/worker-packet.mjs plan --root ABS --spec ABS --out ABS\nUsage: node scripts/worker-packet.mjs verify --root ABS --packet ABS\n`; }
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return process.stdout.write(usage());
  if (args[0] === 'build' || args[0] === 'plan') {
    assert(args.length === 7 && args[1] === '--root' && args[3] === '--spec' && args[5] === '--out', usage().trim());
    const values = Object.fromEntries([[args[1], args[2]], [args[3], args[4]], [args[5], args[6]]]);
    const result = args[0] === 'build' ? { packet: await buildPacket({ root: values['--root'], spec: values['--spec'] }) } : await planPacket({ root: values['--root'], spec: values['--spec'] });
    await writePrivateExclusive(values['--out'], result.packet);
    process.stdout.write(JSON.stringify({ version: result.packet.version, gitHEAD: result.packet.gitHEAD, sources: result.packet.sources.length, allowedFiles: result.packet.allowedFiles.length, bytes: Buffer.byteLength(serializePacket(result.packet), 'utf8'), out: values['--out'], ...(result.coverage ? { coverage: result.coverage } : {}) }) + '\n');
    return;
  }
  assert(args[0] === 'verify' && args.length === 5 && args[1] === '--root' && args[3] === '--packet', usage().trim());
  process.stdout.write(JSON.stringify(await verifyPacket({ root: args[2], packet: args[4] })) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
