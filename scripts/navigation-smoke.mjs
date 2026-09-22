#!/usr/bin/env node
/**
 * Stdio MCP smoke for an installed encrypted-context CLI's `navigate` mode.
 * It writes only an owned temporary fixture and its receipt.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CLIENT = { name: 'forgesworn-navigation-smoke', version: '0.1.0' };
const REQUEST_TIMEOUT_MS = 30_000;
const WATCHDOG_MS = 120_000;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI = resolve(SCRIPT_DIR, '../packages/context-tools/bin/encrypted-context.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function usage() {
  return `Usage: ${process.execPath} ${process.argv[1]} [absolute-cli-path]\n\n` +
    'Starts the CLI in navigate mode against an owned temporary fixture. The default CLI is\n' +
    `${DEFAULT_CLI}\n`;
}

function parseCli() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(usage());
    process.exit(0);
  }
  assert(args.length <= 1, usage().trim());
  const cli = args[0] === undefined ? DEFAULT_CLI : args[0];
  assert(isAbsolute(cli), 'CLI path must be absolute. See --help.');
  return cli;
}

async function sha256(path) {
  return createHash('sha256').update(await (await import('node:fs/promises')).readFile(path)).digest('hex');
}

async function call(client, name, args, { expectError = false } = {}) {
  // Search, explore, coverage and packet default to compact text; this smoke test reads JSON.
  const json = ['repository_search', 'repository_explore', 'repository_coverage', 'repository_packet'].includes(name) ? { format: 'json' } : {};
  const response = await client.callTool({ name, arguments: { ...args, ...json } }, undefined, { timeout: REQUEST_TIMEOUT_MS });
  const item = response.content?.[0];
  assert(response.content?.length === 1 && item?.type === 'text' && typeof item.text === 'string', `invalid ${name} response`);
  if (expectError) {
    assert(response.isError === true, `${name} should have rejected`);
    return item.text;
  }
  assert(response.isError !== true, `${name} failed: ${item.text}`);
  return JSON.parse(item.text);
}

async function connect(cli, fixture) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'navigate', fixture] });
  const client = new Client(CLIENT, { capabilities: {} });
  try {
    await client.connect(transport);
    return { client, transport };
  } catch (error) {
    await transport.close().catch(() => {});
    throw error;
  }
}

async function close(connection) {
  if (!connection) return;
  await connection.client.close().catch(() => {});
  await connection.transport.close().catch(() => {});
}

function evidence(result) {
  return result.results.map(({ path, line, text, sha256: fileSha256 }) => ({ path, line, text, sha256: fileSha256 }));
}

async function main() {
  const cli = parseCli();
  const cliStats = await stat(cli);
  assert(cliStats.isFile(), `CLI is not a file: ${cli}`);
  const fixture = await mkdtemp(join(tmpdir(), 'forgesworn-navigation-smoke-'));
  await chmod(fixture, 0o700);
  const receiptPath = join(fixture, 'navigation-smoke-receipt.json');
  const startedAt = Date.now();
  const checks = {};
  let active;
  const watchdog = setTimeout(() => {
    process.stderr.write(`Watchdog exceeded ${WATCHDOG_MS}ms; closing active MCP transport.\n`);
    const forcedExit = setTimeout(() => {
      process.stderr.write('Watchdog cleanup exceeded 2000ms; forcing exit.\n');
      process.exit(1);
    }, 2_000);
    void close(active).finally(() => {
      clearTimeout(forcedExit);
      process.exit(1);
    });
  }, WATCHDOG_MS);

  try {
    await writeFile(join(fixture, 'source.ts'), 'navToken first\nnavToken second\nnavToken third\n', { mode: 0o600 });
    active = await connect(cli, fixture);
    const names = (await active.client.listTools()).tools.map((tool) => tool.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['repository_coverage', 'repository_explore', 'repository_packet', 'repository_refresh', 'repository_search', 'repository_status']), 'unexpected MCP tool set');

    const unavailable = await call(active.client, 'repository_status', {});
    assert(unavailable.freshness === 'unavailable' && unavailable.generation === null, 'session 1 did not start unavailable');
    checks.session1Unavailable = true;

    const firstCurrent = await call(active.client, 'repository_refresh', {});
    assert(firstCurrent.freshness === 'current' && typeof firstCurrent.generation === 'string', 'initial refresh was not current');
    const initialSearch = await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096 });
    assert(initialSearch.results.length === 1 && typeof initialSearch.nextCursor === 'string', 'initial search did not produce a cursor');
    assert(initialSearch.bytesUsed === Buffer.byteLength(JSON.stringify(initialSearch), 'utf8'), 'search byte count is not exact UTF-8');
    const staleCursor = initialSearch.nextCursor;
    checks.initialSearchUtf8Bytes = true;

    await writeFile(join(fixture, 'added.ts'), 'navToken added\n', { mode: 0o600 });
    const staleAfterAdd = await call(active.client, 'repository_status', {});
    assert(staleAfterAdd.freshness === 'stale' && staleAfterAdd.generation === firstCurrent.generation, 'adding a fixture file did not make the index stale');
    const staleSearch = await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096, cursor: staleCursor });
    assert(staleSearch.freshness === 'stale' && staleSearch.results.length === 1 && typeof staleSearch.nextCursor === 'string', 'old snapshot was not searchable while stale');
    checks.staleAfterAddAndOldSnapshotSearch = true;

    const afterAdd = await call(active.client, 'repository_refresh', {});
    assert(afterAdd.freshness === 'current' && afterAdd.generation !== firstCurrent.generation, 'refresh after add did not create a new current generation');
    await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096, cursor: staleSearch.nextCursor }, { expectError: true });
    checks.oldCursorRejectedAfterRefresh = true;

    await writeFile(join(fixture, 'source.ts'), 'navToken first edited\nnavToken second\nnavToken third\n', { mode: 0o600 });
    const staleAfterEdit = await call(active.client, 'repository_status', {});
    assert(staleAfterEdit.freshness === 'stale' && staleAfterEdit.generation === afterAdd.generation, 'editing a fixture file did not make the index stale');
    const afterEdit = await call(active.client, 'repository_refresh', {});
    assert(afterEdit.freshness === 'current' && afterEdit.generation !== afterAdd.generation, 'refresh after edit did not create a new current generation');

    await unlink(join(fixture, 'added.ts'));
    const staleAfterDelete = await call(active.client, 'repository_status', {});
    assert(staleAfterDelete.freshness === 'stale' && staleAfterDelete.generation === afterEdit.generation, 'deleting a fixture file did not make the index stale');
    const afterDelete = await call(active.client, 'repository_refresh', {});
    assert(afterDelete.freshness === 'current' && afterDelete.generation !== afterEdit.generation, 'refresh after delete did not create a new current generation');

    await rename(join(fixture, 'source.ts'), join(fixture, 'renamed.ts'));
    const staleAfterRename = await call(active.client, 'repository_status', {});
    assert(staleAfterRename.freshness === 'stale' && staleAfterRename.generation === afterDelete.generation, 'renaming a fixture file did not make the index stale');
    const secondCurrent = await call(active.client, 'repository_refresh', {});
    assert(secondCurrent.freshness === 'current' && secondCurrent.generation !== afterDelete.generation, 'refresh after rename did not create a new current generation');
    checks.staleAfterEditDeleteAndRename = true;

    const paged = await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096 });
    assert(typeof paged.nextCursor === 'string', 'paging cursor unavailable');
    await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 1, cursor: paged.nextCursor }, { expectError: true });
    const followup = await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096, cursor: paged.nextCursor });
    assert(followup.results.length === 1, 'valid follow-up did not work after rejected budget');
    checks.invalidBudgetRejectedAndCursorRetained = true;

    const preserved = await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096 });
    assert(typeof preserved.nextCursor === 'string', 'preservation cursor unavailable');
    await writeFile(join(fixture, 'bad.ts'), Buffer.from([0xff, 0xfe, 0x00, 0x80]), { mode: 0o600 });
    await call(active.client, 'repository_refresh', {}, { expectError: true });
    const unknown = await call(active.client, 'repository_status', {});
    assert(unknown.generation === secondCurrent.generation, 'failed UTF-8 refresh replaced the prior generation');
    const preservedSearch = await call(active.client, 'repository_search', { term: 'navToken', maxResults: 1, maxBytes: 4096, cursor: preserved.nextCursor });
    assert(preservedSearch.generation === secondCurrent.generation, 'failed UTF-8 refresh invalidated prior cursor');
    checks.invalidUtf8PreservesGeneration = true;

    await rm(join(fixture, 'bad.ts'));
    const recovered = await call(active.client, 'repository_refresh', {});
    assert(recovered.freshness === 'current' && recovered.generation !== secondCurrent.generation, 'removing invalid UTF-8 did not recover current index');
    const session1Evidence = evidence(await call(active.client, 'repository_search', { term: 'navToken', maxResults: 3, maxBytes: 4096 }));
    assert(session1Evidence.length === 3, 'recovered search lacks expected source evidence');
    checks.recoveredAfterInvalidUtf8 = true;

    await close(active);
    active = undefined;
    active = await connect(cli, fixture);
    const secondUnavailable = await call(active.client, 'repository_status', {});
    assert(secondUnavailable.freshness === 'unavailable' && secondUnavailable.generation === null, 'session 2 did not start unavailable');
    const session2Current = await call(active.client, 'repository_refresh', {});
    assert(session2Current.freshness === 'current' && session2Current.generation !== recovered.generation, 'session 2 did not create a fresh generation');
    assert(session2Current.revision === recovered.revision, 'session 2 manifest revision differs for the same source');
    const session2Evidence = evidence(await call(active.client, 'repository_search', { term: 'navToken', maxResults: 3, maxBytes: 4096 }));
    assert(JSON.stringify(session2Evidence) === JSON.stringify(session1Evidence), 'session 2 search evidence differs for the same source');
    checks.session2FreshGenerationAndEvidence = true;

    const receipt = {
      client: CLIENT,
      node: process.version,
      cli: { path: cli, sha256: await sha256(cli) },
      fixture,
      source: { path: 'renamed.ts', evidence: session2Evidence },
      revisions: { initial: firstCurrent.revision, refreshed: secondCurrent.revision, recovered: recovered.revision, session2: session2Current.revision },
      generations: { initial: firstCurrent.generation, refreshed: secondCurrent.generation, recovered: recovered.generation, session2: session2Current.generation },
      counts: session2Current.counts,
      timingsMs: { total: Date.now() - startedAt },
      checks,
      usage: { input: null, output: null, cache: null, cost: null },
      limits: { requestTimeoutMs: REQUEST_TIMEOUT_MS, watchdogMs: WATCHDOG_MS },
      scope: ['SDK stdio MCP smoke only', 'not desktop acceptance', 'does not measure or infer inference savings', 'cancellation robustness remains covered by unit tests and is not exercised here'],
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await chmod(receiptPath, 0o600);
    process.stdout.write(`${JSON.stringify({ ok: true, receiptPath, fixture, checks, cli: receipt.cli, timingsMs: receipt.timingsMs }, null, 2)}\n`);
  } finally {
    await close(active);
    clearTimeout(watchdog);
  }
}

main().catch((error) => {
  process.stderr.write(`navigation smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
