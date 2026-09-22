import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFile = promisify(execFileCb);

const TERM_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const REQUIRED_TOOLS = [
  'repository_status',
  'repository_refresh',
  'repository_search',
  'repository_packet',
] as const;

const CLI = fileURLToPath(new URL('../bin/encrypted-context.mjs', import.meta.url));
const CLIENT_NAME = 'context-repository-doctor';
const CLIENT_VERSION = '1';
const PER_REQUEST_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 90_000;
const STDERR_LIMIT = 2048;

type ToolName = (typeof REQUIRED_TOOLS)[number];

interface McpTextContent {
  type: 'text';
  text: string;
}

interface McpCallResult {
  isError?: boolean;
  content?: unknown;
}

interface ListToolsResult {
  tools?: Array<{ name?: unknown; inputSchema?: unknown }>;
}

interface StatusPayload {
  root: string;
  generation: unknown;
  freshness: string;
  revision: unknown;
  policy?: { freshness?: string } | undefined;
  counts: unknown;
  exclusions: unknown;
}

interface SearchHit {
  path: string;
  line: number;
  text: string;
  sha256: string;
}

interface SearchPayload {
  generation: unknown;
  freshness: string;
  policy?: { freshness?: string } | undefined;
  results: SearchHit[];
}

interface DoctorReport {
  version: 1;
  ok: true;
  root: string;
  gitHEAD: string;
  node: string;
  binding: {
    command: string;
    args: string[];
    enabled_tools: ToolName[];
  };
  tools: ToolName[];
  generation: string;
  revision: string;
  counts: Record<string, unknown>;
  exclusions: Record<string, unknown>;
  evidence: {
    path: string;
    line: number;
    sha256: string;
  };
  clientAcceptance: 'not-tested';
  nextStep: string;
}

class DoctorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoctorError';
  }
}

function boundDetail(value: unknown, limit = 400): string {
  let s: string;
  if (typeof value === 'string') {
    s = value;
  } else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  s = (s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_')) continue;
    env[k] = v;
  }
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

async function runGit(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile('git', ['-C', root, ...args], {
      env: gitEnv(),
      shell: false,
      timeout: 5_000,
      maxBuffer: 8_192,
      encoding: 'utf8',
    });
    return (stdout ?? '').trim();
  } catch (err) {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const detail = boundDetail(e.stderr ?? e.stdout ?? e.message ?? 'git failed');
    throw new DoctorError(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function parseTextPayload(result: McpCallResult, toolName: string): unknown {
  if (result && result.isError === true) {
    const text = Array.isArray(result.content)
      ? result.content
          .map((c) =>
            c && typeof c === 'object' && (c as McpTextContent).type === 'text'
              ? (c as McpTextContent).text
              : '',
          )
          .join(' ')
      : '';
    throw new DoctorError(
      `${toolName} reported error: ${boundDetail(text || 'unknown error')}`,
    );
  }
  if (!result || !Array.isArray(result.content) || result.content.length !== 1) {
    throw new DoctorError(`${toolName} returned unexpected content shape`);
  }
  const item = result.content[0] as McpTextContent | undefined;
  if (!item || item.type !== 'text' || typeof item.text !== 'string') {
    throw new DoctorError(`${toolName} returned non-text content`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.text);
  } catch {
    throw new DoctorError(`${toolName} returned invalid JSON`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new DoctorError(`${toolName} returned non-object payload`);
  }
  return parsed;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DoctorError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DoctorError(`${label} missing or not a string`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new DoctorError(`${label} missing or not a number`);
  }
  return value;
}

function requireHex(value: unknown, label: string, lens: number[]): string {
  const s = requireString(value, label);
  if (!lens.includes(s.length) || !/^[0-9a-f]+$/i.test(s)) {
    throw new DoctorError(`${label} is not a valid hex hash`);
  }
  return s;
}

function packetSchemaOk(schema: unknown): boolean {
  const s = schema as { type?: unknown; properties?: unknown } | undefined;
  if (!s || s.type !== 'object') return false;
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
  return 'mode' in props && 'spec' in props && 'expectedGeneration' in props;
}

export async function diagnoseRepository(
  directory: string,
  term: string,
): Promise<DoctorReport> {
  if (typeof term !== 'string' || !TERM_RE.test(term)) {
    throw new DoctorError(
      'term must match /^[A-Za-z_][A-Za-z0-9_]{0,127}$/',
    );
  }
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new DoctorError('directory must be a non-empty string');
  }

  let root: string;
  try {
    root = await realpath(directory);
  } catch (err) {
    throw new DoctorError(
      `cannot resolve directory: ${boundDetail((err as Error).message)}`,
    );
  }

  const toplevel = await runGit(root, ['rev-parse', '--show-toplevel']);
  let canonicalTop: string;
  try {
    canonicalTop = await realpath(toplevel);
  } catch {
    canonicalTop = toplevel;
  }
  if (canonicalTop !== root) {
    throw new DoctorError(
      `Directory ${root} is not the repository root. Required root is ${canonicalTop}. ` +
        `Re-run the command pointing at that root; subdirectories are not auto-retargeted.`,
    );
  }

  let gitHEAD: string;
  try {
    const head = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
    gitHEAD = requireHex(head, 'git HEAD (packets currently require SHA-1 repositories)', [40]).toLowerCase();
  } catch (err) {
    throw new DoctorError(
      `Repository HEAD cannot be verified. Select a repository with an existing commit and supported object format: ` +
        `${boundDetail((err as Error).message)}`,
    );
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'navigate', root],
    stderr: 'pipe',
    maxBufferSize: 262144,
  });

  let stderrBuf = '';
  const stderrStream = transport.stderr;
  if (stderrStream && typeof stderrStream.on === 'function') {
    stderrStream.on('data', (chunk: Buffer | string) => {
      if (stderrBuf.length >= STDERR_LIMIT) return;
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderrBuf = (stderrBuf + s).slice(0, STDERR_LIMIT);
    });
  }

  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });

  const abort = new AbortController();
  const overallTimer = setTimeout(() => abort.abort(), OVERALL_TIMEOUT_MS);

  const requestOpts = () => ({
    timeout: PER_REQUEST_TIMEOUT_MS,
    signal: abort.signal,
  });


  try {
    try {
      await client.connect(transport, {
        timeout: PER_REQUEST_TIMEOUT_MS,
        signal: abort.signal,
      });
    } catch (err) {
      const base = `MCP handshake failed: ${boundDetail((err as Error).message)}`;
      throw new DoctorError(
        stderrBuf ? `${base} (stderr: ${boundDetail(stderrBuf)})` : base,
      );
    }

    let listResult: ListToolsResult;
    try {
      listResult = (await client.listTools(undefined, requestOpts())) as ListToolsResult;
    } catch (err) {
      const base = `listTools failed: ${boundDetail((err as Error).message)}`;
      throw new DoctorError(
        stderrBuf ? `${base} (stderr: ${boundDetail(stderrBuf)})` : base,
      );
    }

    const tools = Array.isArray(listResult.tools) ? listResult.tools : [];
    const byName = new Map<string, { inputSchema?: unknown }>();
    for (const t of tools) {
      if (t && typeof t.name === 'string') {
        byName.set(t.name, { inputSchema: t.inputSchema });
      }
    }
    for (const name of REQUIRED_TOOLS) {
      if (!byName.has(name)) {
        throw new DoctorError(
          `required tool ${name} not advertised by server; cannot proceed`,
        );
      }
    }
    const packetTool = byName.get('repository_packet');
    if (!packetSchemaOk(packetTool?.inputSchema)) {
      throw new DoctorError(
        'repository_packet schema missing top-level object fields mode/spec/expectedGeneration',
      );
    }

    const callTool = async (name: ToolName, args: Record<string, unknown>) => {
      try {
        const res = (await client.callTool(
          { name, arguments: args },
          undefined,
          requestOpts(),
        )) as McpCallResult;
        return parseTextPayload(res, name);
      } catch (err) {
        if (err instanceof DoctorError) throw err;
          const base = `${name} call failed: ${boundDetail((err as Error).message)}`;
        throw new DoctorError(
          stderrBuf ? `${base} (stderr: ${boundDetail(stderrBuf)})` : base,
        );
      }
    };

    const statusRaw = requireObject(
      await callTool('repository_status', {}),
      'repository_status',
    );
    const status: StatusPayload = {
      root: requireString(statusRaw.root, 'status.root'),
      generation: statusRaw.generation,
      freshness: requireString(statusRaw.freshness, 'status.freshness'),
      revision: statusRaw.revision,
      policy: statusRaw.policy as StatusPayload['policy'],
      counts: statusRaw.counts,
      exclusions: statusRaw.exclusions,
    };
    let statusRoot: string;
    try {
      statusRoot = await realpath(status.root);
    } catch {
      statusRoot = status.root;
    }
    if (statusRoot !== root) {
      throw new DoctorError(
        `repository_status root ${statusRoot} does not match canonical target ${root}; refusing to proceed.`,
      );
    }

    const refreshRaw = requireObject(
      await callTool('repository_refresh', {}),
      'repository_refresh',
    );
    const refreshRoot = requireString(refreshRaw.root, 'refresh.root');
    let refreshCanonical: string;
    try {
      refreshCanonical = await realpath(refreshRoot);
    } catch {
      refreshCanonical = refreshRoot;
    }
    if (refreshCanonical !== root) {
      throw new DoctorError(
        `repository_refresh root ${refreshCanonical} does not match canonical target ${root}.`,
      );
    }
    if (refreshRaw.freshness !== 'current') {
      throw new DoctorError('repository_refresh did not report current freshness');
    }
    const refreshPolicy = (refreshRaw.policy ?? {}) as { freshness?: unknown };
    if (refreshPolicy.freshness !== 'current') {
      throw new DoctorError(
        'repository_refresh did not report current policy freshness',
      );
    }
    const refreshGeneration = requireString(refreshRaw.generation, 'refresh.generation');
    const refreshRevision = requireString(refreshRaw.revision, 'refresh.revision');
    const refreshCounts = requireObject(refreshRaw.counts, 'refresh.counts');
    const refreshExclusions = requireObject(refreshRaw.exclusions, 'refresh.exclusions');

    const searchRaw = requireObject(
      await callTool('repository_search', {
        term,
        maxResults: 1,
        maxBytes: 8192,
        maxVisited: 10000,
      }),
      'repository_search',
    );
    const search: SearchPayload = {
      generation: searchRaw.generation,
      freshness: requireString(searchRaw.freshness, 'search.freshness'),
      policy: searchRaw.policy as SearchPayload['policy'],
      results: Array.isArray(searchRaw.results)
        ? (searchRaw.results as SearchHit[])
        : [],
    };
    if (search.freshness !== 'current') {
      throw new DoctorError('repository_search did not report current freshness');
    }
    const searchPolicy = search.policy ?? {};
    if (searchPolicy.freshness !== 'current') {
      throw new DoctorError('repository_search policy not current');
    }
    if (search.generation !== refreshGeneration) {
      throw new DoctorError(
        'repository_search generation does not match refresh generation',
      );
    }
    if (search.results.length === 0) {
      throw new DoctorError(
        `repository_search returned no results for term ${term}. Try another known indexed identifier, or inspect repository exclusions in a separate step.`,
      );
    }
    const hitRaw = requireObject(search.results[0], 'search.results[0]');
    const hit: SearchHit = {
      path: requireString(hitRaw.path, 'search.results[0].path'),
      line: requireNumber(hitRaw.line, 'search.results[0].line'),
      text: requireString(hitRaw.text, 'search.results[0].text'),
      sha256: requireHex(hitRaw.sha256, 'search.results[0].sha256', [64]),
    };

    const spec = {
      version: 1,
      task: 'Verify repository setup',
      acceptanceChecks: ['Return one selected source line with matching provenance'],
      allowedFiles: [] as string[],
      sources: [
        {
          path: hit.path,
          startLine: hit.line,
          endLine: hit.line,
        },
      ],
      exclusions: ['Read-only setup check'],
      unresolvedQuestions: [] as string[],
    };
    const packetRaw = requireObject(
      await callTool('repository_packet', {
        mode: 'build',
        spec,
        expectedGeneration: refreshGeneration,
        maxBytes: 16384,
      }),
      'repository_packet',
    );
    const packet = requireObject(packetRaw.packet, 'packet.packet');
    const nav = requireObject(packetRaw.navigation, 'packet.navigation');
    const packetRootRaw = requireString(packet.canonicalRoot, 'packet.canonicalRoot');
    let packetRoot: string;
    try {
      packetRoot = await realpath(packetRootRaw);
    } catch {
      packetRoot = packetRootRaw;
    }
    if (packetRoot !== root) {
      throw new DoctorError(
        `repository_packet canonicalRoot ${packetRoot} does not match canonical target ${root}.`,
      );
    }
    const packetHEAD = requireHex(packet.gitHEAD, 'packet.gitHEAD', [40]).toLowerCase();
    if (packetHEAD !== gitHEAD) {
      throw new DoctorError(
        'repository_packet gitHEAD does not match preflight HEAD',
      );
    }
    if (nav.generation !== refreshGeneration) {
      throw new DoctorError(
        'repository_packet navigation.generation does not match refreshed generation',
      );
    }
    if (nav.revision !== refreshRevision) {
      throw new DoctorError(
        'repository_packet navigation.revision does not match refreshed revision',
      );
    }
    const navPolicy = (nav.policy ?? {}) as { freshness?: unknown };
    if (navPolicy.freshness !== 'current') {
      throw new DoctorError(
        'repository_packet navigation policy freshness is not current',
      );
    }
    const packetSources = Array.isArray(packet.sources)
      ? (packet.sources as unknown[])
      : [];
    if (packetSources.length !== 1) {
      throw new DoctorError(
        `repository_packet sources expected exactly 1, got ${packetSources.length}`,
      );
    }
    const source = requireObject(packetSources[0], 'packet.sources[0]');
    const sourcePath = requireString(source.path, 'packet.sources[0].path');
    const sourceSha = requireHex(source.sha256, 'packet.sources[0].sha256', [64]);
    const startLine = requireNumber(source.startLine, 'packet.sources[0].startLine');
    const endLine = requireNumber(source.endLine, 'packet.sources[0].endLine');
    if (sourcePath !== hit.path) {
      throw new DoctorError('packet source path does not match search hit path');
    }
    if (sourceSha !== hit.sha256) {
      throw new DoctorError('packet source sha256 does not match search hit sha256');
    }
    if (startLine !== hit.line || endLine !== hit.line) {
      throw new DoctorError(
        'packet source line range does not match search hit line',
      );
    }
    const sourceLines = Array.isArray(source.lines) ? (source.lines as unknown[]) : [];
    if (sourceLines.length !== 1) {
      throw new DoctorError(
        `packet source lines expected exactly 1, got ${sourceLines.length}`,
      );
    }
    const lineObj = requireObject(sourceLines[0], 'packet.sources[0].lines[0]');
    const returnedLine = requireNumber(lineObj.line, 'packet.sources[0].lines[0].line');
    const returnedContent = requireString(
      lineObj.content,
      'packet.sources[0].lines[0].content',
    );
    if (returnedLine !== hit.line) {
      throw new DoctorError('packet line number does not match search hit line');
    }
    if (returnedContent !== hit.text) {
      throw new DoctorError('packet line content does not match search hit text');
    }

    const report: DoctorReport = {
      version: 1,
      ok: true,
      root,
      gitHEAD,
      node: process.version,
      binding: {
        command: process.execPath,
        args: [CLI, 'navigate', root],
        enabled_tools: [...REQUIRED_TOOLS],
      },
      tools: [...REQUIRED_TOOLS],
      generation: refreshGeneration,
      revision: refreshRevision,
      counts: refreshCounts,
      exclusions: refreshExclusions,
      evidence: {
        path: hit.path,
        line: hit.line,
        sha256: hit.sha256,
      },
      clientAcceptance: 'not-tested',
      nextStep:
        'Merge binding into the selected project client configuration, reconnect, and verify all four tools in that client. Directory changes do not retarget the server.',
    };

    return report;
  } catch (err) {
    if (err instanceof DoctorError) throw err;
    const base = `repository doctor failed: ${boundDetail((err as Error).message)}`;
    throw new DoctorError(stderrBuf ? `${base} (stderr: ${boundDetail(stderrBuf)})` : base);
  } finally {
    clearTimeout(overallTimer);
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
  }
}
