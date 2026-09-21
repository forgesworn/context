#!/usr/bin/env node
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { scanSourceGraph } from '@forgesworn/context-tools';
import { createNostrIdentity } from '@forgesworn/context/nostr';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(process.cwd());
const CLI = resolve('packages/context-tools/bin/encrypted-context.mjs');
const SDK_CLIENT = { name: 'z1p-dogfood', version: '0.1.0' };
const REQ_TIMEOUT = 30_000;
const SCAN_LIMITS = {
  maxFiles: 64,
  maxDepth: 8,
  maxBytes: 1_048_576,
  maxFileBytes: 262_144,
  maxRecords: 128,
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function callTool(client, name, args) {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: REQ_TIMEOUT });
  if (res.isError) {
    const err = new Error(`Tool ${name} returned isError`);
    err.code = 'DOGFOOD_TOOL_ERROR';
    throw err;
  }
  assert(res.content?.length === 1 && res.content[0].type === 'text', `Bad ${name} response`);
  return JSON.parse(res.content[0].text);
}

async function gitState() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' });
  return { head, dirty: status.trim() };
}

async function runClient(env, watch) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'mcp', '--identity', env.keyPath, '--expect-pubkey', env.pubkey, '--state', env.statePath, '--personal'],
    stderr: 'inherit',
    env: { PATH: env.PATH ?? '' },
  });
  const client = new Client(SDK_CLIENT, { capabilities: {} });
  watch.current = transport;
  try {
    await client.connect(transport);
    return { client, transport };
  } catch (e) {
    await transport.close().catch(() => {});
    throw e;
  }
}

async function main() {
  const query = (process.argv[2] ?? 'source scan').trim();
  assert(process.argv.length <= 3, 'Too many arguments');
  assert(query.length > 0 && query.length <= 500, 'Query must be 1-500 chars');

  const before = await gitState();
  const scanStart = Date.now();
  const scan = await scanSourceGraph(ROOT, {
    ...SCAN_LIMITS,
    observedAt: Math.floor(Date.now() / 1000),
  });
  const scanMs = Date.now() - scanStart;
  const afterScan = await gitState();
  assert(before.head === afterScan.head, 'HEAD changed during scan');
  assert(before.dirty === afterScan.dirty, 'Dirty status changed during scan');

  const candidates = scan.filesScanned + scan.symbolsFound;
  const omitted = Math.max(0, candidates - scan.records.length);

  const dir = await mkdtemp(join(tmpdir(), 'z1p-dogfood-'));
  await chmod(dir, 0o700);
  const keyPath = join(dir, 'secret.key');
  const statePath = join(dir, 'state.json');
  const receiptPath = join(dir, 'receipt.json');
  const secret = randomBytes(32);
  await writeFile(keyPath, secret.toString('hex'), { mode: 0o600 });
  const identity = createNostrIdentity(secret);
  const pubkey = identity.pubkey;
  console.error(`Created tempdir: ${dir}`);

  const env = {
    PATH: process.env.PATH,
  };
  const watch = { current: null };
  const watchdog = setTimeout(() => {
    console.error('Watchdog: dogfood exceeded 120s');
    const forcedExit = setTimeout(() => {
      console.error('Watchdog: forced exit after 2s');
      process.exit(1);
    }, 2000);
    Promise.resolve()
      .then(() => watch.current?.close())
      .catch(() => {})
      .then(() => {
        clearTimeout(forcedExit);
        process.exit(1);
      });
  }, 120_000);
  let client1, transport1, client2, transport2;
  try {
    ({ client: client1, transport: transport1 } = await runClient({ ...env, keyPath, pubkey, statePath }, watch));
    const tools = await client1.listTools();
    const toolNames = new Set(tools.tools.map(t => t.name));
    for (const required of ['context_create', 'context_append_batch', 'context_list', 'context_retrieve', 'context_read']) {
      assert(toolNames.has(required), `Missing required tool: ${required}`);
    }

    const create = await callTool(client1, 'context_create', { title: 'Z1P dogfood snapshot', scope: 'personal' });
    assert(create.id && create.head, 'Bad create response');
    const collection = create.id;

    const append = await callTool(client1, 'context_append_batch', {
      collection,
      expectedHead: create.head,
      records: scan.records,
    });
    assert(append.id === collection && append.head && Array.isArray(append.records), 'Bad append response');
    assert(append.records.length === scan.records.length, 'Append record count mismatch');

    const list = await callTool(client1, 'context_list', {});
    assert(Array.isArray(list), 'List is not array');
    assert(list.some(c => c.id === collection), 'Collection not in list');

    const queryStart = Date.now();
    const retrieval = await callTool(client1, 'context_retrieve', {
      collection,
      query,
      maxBytes: 8192,
      maxRecords: 8,
    });
    const queryMs = Date.now() - queryStart;
    assert(retrieval.records && Array.isArray(retrieval.records), 'Bad retrieve records');
    assert(typeof retrieval.head === 'string', 'Bad retrieve head');
    assert(retrieval.head === append.head, 'Retrieve head mismatch');
    const payloadBytes = Buffer.byteLength(JSON.stringify(retrieval));
    assert(payloadBytes === retrieval.bytesUsed, `bytesUsed mismatch: ${payloadBytes} vs ${retrieval.bytesUsed}`);
    assert(payloadBytes <= 8192, 'Retrieval exceeds budget');

    let invalidIsError = false;
    try {
      await callTool(client1, 'context_retrieve', {
        collection,
        query,
        maxBytes: 1,
        maxRecords: 8,
      });
    } catch (e) {
      if (e?.code === -32602 || e?.code === 'DOGFOOD_TOOL_ERROR') invalidIsError = true;
      else throw e;
    }
    assert(invalidIsError, 'Invalid retrieve did not error as expected');

    const recheck = await callTool(client1, 'context_retrieve', {
      collection,
      query,
      maxBytes: 8192,
      maxRecords: 8,
    });
    assert(recheck.head === retrieval.head && recheck.bytesUsed === retrieval.bytesUsed, 'Recheck retrieve mismatch');
    assert(Buffer.byteLength(JSON.stringify(recheck)) === recheck.bytesUsed, 'Recheck bytesUsed mismatch');
    assert(Buffer.byteLength(JSON.stringify(recheck)) <= 8192, 'Recheck exceeds budget');

    await client1.close();
    await transport1.close();
    client1 = transport1 = null;
    watch.current = null;

    ({ client: client2, transport: transport2 } = await runClient({ ...env, keyPath, pubkey, statePath }, watch));
    const read = await callTool(client2, 'context_read', { collection });
    assert(read.head === append.head, 'Restart head mismatch');
    assert(Array.isArray(read.records) && read.records.length === append.records.length, 'Restart record count mismatch');

    const receipt = {
      commit: before.head,
      dirtyStatus: before.dirty,
      scannerLimits: SCAN_LIMITS,
      scannerStats: {
        filesScanned: scan.filesScanned,
        filesSkipped: scan.filesSkipped,
        bytesRead: scan.bytesRead,
        symbolsFound: scan.symbolsFound,
        importsFound: scan.importsFound,
        callsFound: scan.callsFound,
        recordsRetained: scan.records.length,
        recordsOmitted: omitted,
      },
      collection: { id: collection, head: read.head },
      sdkClient: {
        ...SDK_CLIENT,
        sdkVersion: '1.30.0',
      },
      warnings: [
        'Bounded navigation, not whole-repository coverage; excluded files are not counted as omissions.',
        'Git status equality does not prove unchanged dirty contents.',
        'Retained local keys/cache; retrieval receipt is plaintext. Read actual source before edits.',
      ],
      checks: { invalidRetrieveRejected: invalidIsError, restartPersistence: true },
      retrieval,
      timings: { scanMs, queryMs },
      inferenceUsage: null,
      billing: null,
      pairedTrial: 'not run',
    };
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });

    const summary = {
      query,
      commit: before.head,
      dirty: before.dirty ? 'yes' : 'no',
      filesScanned: scan.filesScanned,
      filesSkipped: scan.filesSkipped,
      recordsRetained: scan.records.length,
      recordsOmitted: omitted,
      collection,
      retrieval,
      timings: { scanMs, queryMs },
      receiptPath,
      tempdir: dir,
      reproducibleCommand: {
        command: process.execPath,
        args: [CLI, 'mcp', '--identity', keyPath, '--expect-pubkey', pubkey, '--state', statePath, '--personal'],
      },
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    for (const c of [client1, client2]) if (c) await c.close().catch(() => {});
    for (const t of [transport1, transport2]) if (t) await t.close().catch(() => {});
    if (watch.current) await watch.current.close().catch(() => {});
    clearTimeout(watchdog);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
