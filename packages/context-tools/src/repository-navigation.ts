import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import {
  NavigationPolicy,
  type NavigationPolicySummary,
  type NavigationPolicyScope,
} from './repository-navigation-policy.js';

export interface NavigationLimits {
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  maxLocations: number;
  maxPostings: number;
  maxDepth: number;
}

export interface NavigationExclusions {
  symlinks: number;
  ignored: number;
  policy: number;
  unsupported: number;
  oversizedFiles: number;
  oversizedLines: number;
  maxDepth: number;
  visitedCap: number;
}

export interface NavigationStatus {
  root: string;
  generation: string | null;
  trust: 'local-source-unsigned';
  freshness: NavigationFreshness;
  freshnessError?: string;
  revision: string | null;
  policy: NavigationPolicyState;
  completeness: string;
  builtAt: number | null;
  counts: {
    files: number;
    bytes: number;
    locations: number;
    postings: number;
  };
  exclusions: NavigationExclusions;
  limits: NavigationLimits;
  cursors: number;
}

export type NavigationFreshness = 'unavailable' | 'current' | 'stale' | 'unknown';

export interface NavigationPolicyState {
  freshness: NavigationFreshness;
  digest: string | null;
  summary?: NavigationPolicySummary;
  error?: string;
}

export interface NavigationResultRecord {
  path: string;
  line: number;
  text: string;
  sha256: string;
}

export type NavigationStopReason =
  | 'exhausted'
  | 'max-results'
  | 'max-bytes'
  | 'max-visited';

export interface NavigationResult {
  trust: 'local-source-unsigned';
  generation: string;
  freshness: NavigationFreshness;
  freshnessError?: string;
  policy: NavigationPolicyState;
  term: string;
  results: NavigationResultRecord[];
  bytesUsed: number;
  maxBytes: number;
  visited: number;
  complete: boolean;
  stopReason: NavigationStopReason;
  nextCursor?: string;
}

export interface NavigationSearchOptions {
  term: string;
  maxBytes?: number;
  maxResults?: number;
  maxVisited?: number;
  cursor?: string;
}

const DEFAULT_LIMITS: NavigationLimits = {
  maxFiles: 10_000,
  maxBytes: 32 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxLocations: 100_000,
  maxPostings: 1_000_000,
  maxDepth: 16,
};

const EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.cs', '.rb', '.php', '.md',
]);

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out', 'vendor', 'target',
]);

const TOKEN_RE = /[a-zA-Z_][a-zA-Z0-9_]*/g;
const MAX_TOKEN_LEN = 128;
const MAX_LINE_BYTES = 2048;

const SEARCH_DEFAULTS = {
  maxBytes: 32_768,
  maxResults: 40,
  maxVisited: 1000,
};

const SEARCH_MIN_BYTES = 1024;
const SEARCH_MAX_BYTES = 262_144;
const SEARCH_MIN_RESULTS = 1;
const SEARCH_MAX_RESULTS = 100;
const SEARCH_MIN_VISITED = 1;
const SEARCH_MAX_VISITED = 10_000;

const CURSOR_TTL_MS = 5 * 60 * 1000;
// Cursors are single-use continuation handles: a cursor is consumed only when
// a search successfully commits its result (including the exhausted final
// page). Chains may be arbitrarily long; at most CURSOR_MAX_ENTRIES live
// (unconsumed) handles exist at any time.
const CURSOR_MAX_ENTRIES = 128;
const VISITED_ENTRIES_CAP = 100_000;
const YIELD_CHUNK = 100;

interface IndexedLocation {
  path: string;
  line: number;
  text: string;
  sha256: string;
}

interface IndexedFile {
  path: string;
  sha256: string;
  bytes: number;
  locations: IndexedLocation[];
}

interface Generation {
  id: string;
  builtAt: number;
  revision: string;
  policyRevision: string;
  policySummary: NavigationPolicySummary;
  files: IndexedFile[];
  byToken: Map<string, number[]>;
  // Flat list of locations sorted by path then line, indexable by number.
  locations: IndexedLocation[];
  counts: {
    files: number;
    bytes: number;
    locations: number;
    postings: number;
  };
  exclusions: NavigationExclusions;
  limits: NavigationLimits;
}

interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
}

interface Manifest {
  files: ManifestFile[];
  revision: string;
}

interface Discovery {
  files: { abs: string; rel: string }[];
  exclusions: NavigationExclusions;
  policy: NavigationPolicy;
  policyRevision: string;
  policySummary: NavigationPolicySummary;
}

interface FreshnessInspection {
  freshness: Exclude<NavigationFreshness, 'unavailable'>;
  error?: string;
  policy: NavigationPolicyState;
}

interface Cursor {
  generation: string;
  term: string;
  position: number;
  createdAt: number;
}

interface ResolvedLimits {
  limits: NavigationLimits;
  validated: boolean;
}

function isPositiveSafeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

function resolveLimits(partial?: Partial<NavigationLimits>): ResolvedLimits {
  const out: NavigationLimits = { ...DEFAULT_LIMITS };
  if (partial) {
    for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof NavigationLimits>) {
      const provided = partial[key];
      if (provided === undefined) continue;
      if (!isPositiveSafeInt(provided)) {
        throw new Error(`Invalid limit ${key}: must be positive safe integer`);
      }
      const hard = DEFAULT_LIMITS[key];
      if (provided > hard) {
        throw new Error(`Invalid limit ${key}: exceeds hard upper bound ${hard}`);
      }
      out[key] = provided;
    }
  }
  return { limits: out, validated: true };
}

function isHiddenName(name: string): boolean {
  return name.length > 0 && name.charCodeAt(0) === 46; // '.'
}

function isSupportedPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSIONS.has(ext);
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function isInsideRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(rootWithSep);
}

const yieldNow = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function utf8Len(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

function manifestRevision(files: readonly ManifestFile[]): string {
  return createHash('sha256')
    .update(JSON.stringify(files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes }))))
    .digest('hex');
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500) || 'RepositoryNavigation: freshness inspection failed';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('RepositoryNavigation: aborted');
  }
}

function makeFrozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const k of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[k];
      if (child && typeof child === 'object' && !Object.isFrozen(child)) {
        makeFrozen(child);
      }
    }
  }
  return value;
}


function makeFrozenRecord<T extends object>(value: T): Readonly<T> {
  // Deep-freeze shallow structures used for external output.
  Object.freeze(value);
  for (const k of Object.keys(value) as Array<keyof T>) {
    const child = value[k] as unknown;
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      Object.freeze(child);
    }
  }
  return value;
}

function tokenizeLine(text: string): string[] {
  const tokens: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const tok = m[0];
    if (tok.length <= MAX_TOKEN_LEN) {
      tokens.push(tok.toLowerCase());
    }
  }
  return tokens;
}

function normalizeTerm(term: string): string | null {
  const trimmed = term.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_TOKEN_LEN) return null;
  TOKEN_RE.lastIndex = 0;
  const m = TOKEN_RE.exec(trimmed);
  if (!m || m.index !== 0 || m[0].length !== trimmed.length) return null;
  return m[0].toLowerCase();
}

export class RepositoryNavigation {
  private readonly rootInput: string;
  private readonly limits: NavigationLimits;
  private generation: Generation | null = null;
  private canonicalRoot: string | null = null;
  private refreshInFlight = false;
  private readonly cursors = new Map<string, Cursor>();

  constructor(root: string, limits?: Partial<NavigationLimits>) {
    if (typeof root !== 'string' || root.length === 0) {
      throw new Error('RepositoryNavigation: root must be a non-empty string');
    }
    const resolved = resolveLimits(limits);
    this.limits = resolved.limits;
    this.rootInput = root;
  }

  async status(signal?: AbortSignal): Promise<NavigationStatus> {
    throwIfAborted(signal);
    const gen = this.generation;
    if (!gen) {
      return this.makeStatus(null, 'unavailable', undefined, { freshness: 'unavailable', digest: null });
    }
    const freshness = await this.inspectFreshness(gen, signal);
    // A refresh may have published while the bounded inspection was running.
    // Report a self-consistent snapshot rather than attaching an old revision
    // to the new generation.
    if (this.generation !== gen) {
      const current = this.generation;
      if (!current) return this.makeStatus(null, 'unavailable', undefined, { freshness: 'unavailable', digest: null });
      return this.makeStatus(
        current,
        'unknown',
        'RepositoryNavigation: generation changed during freshness inspection',
        { freshness: 'unknown', digest: current.policyRevision, summary: current.policySummary, error: 'RepositoryNavigation: generation changed during freshness inspection' },
      );
    }
    return this.makeStatus(gen, freshness.freshness, freshness.error, freshness.policy);
  }

  private makeStatus(
    gen: Generation | null,
    freshness: NavigationFreshness,
    freshnessError?: string,
    policy: NavigationPolicyState = gen
      ? { freshness: 'current', digest: gen.policyRevision, summary: gen.policySummary }
      : { freshness: 'unavailable', digest: null },
  ): NavigationStatus {
    const exclusions: NavigationExclusions = gen
      ? gen.exclusions
      : {
          symlinks: 0,
          ignored: 0,
          policy: 0,
          unsupported: 0,
          oversizedFiles: 0,
          oversizedLines: 0,
          maxDepth: 0,
          visitedCap: 0,
        };
    const counts = gen
      ? gen.counts
      : { files: 0, bytes: 0, locations: 0, postings: 0 };
    return makeFrozenRecord({
      root: this.canonicalRoot ?? this.rootInput,
      generation: gen ? gen.id : null,
      trust: 'local-source-unsigned' as const,
      freshness,
      ...(freshnessError ? { freshnessError } : {}),
      revision: gen ? gen.revision : null,
      policy: { ...policy, ...(policy.summary ? { summary: { ...policy.summary } } : {}) },
      completeness:
        'scoped to allowlisted extensions under explicit root; excludes listed dirs and hidden entries; not exhaustive coverage of repository',
      builtAt: gen ? gen.builtAt : null,
      counts: { ...counts },
      exclusions: { ...exclusions },
      limits: { ...this.limits },
      cursors: this.cursors.size,
    });
  }

  async refresh(signal?: AbortSignal): Promise<NavigationStatus> {
    if (this.refreshInFlight) {
      throw new Error('RepositoryNavigation: refresh already in progress');
    }
    throwIfAborted(signal);
    this.refreshInFlight = true;
    try {
      const canonical = await this.resolveRoot(signal);
      throwIfAborted(signal);

      const gen = await this.buildGeneration(canonical, signal);
      throwIfAborted(signal);

      // Publish atomically. Successful refresh invalidates all cursors.
      this.canonicalRoot = canonical;
      this.generation = gen;
      this.cursors.clear();
      return this.makeStatus(gen, 'current', undefined, {
        freshness: 'current', digest: gen.policyRevision, summary: gen.policySummary,
      });
    } finally {
      this.refreshInFlight = false;
    }
  }

  async search(
    options: NavigationSearchOptions,
    signal?: AbortSignal,
  ): Promise<NavigationResult> {
    throwIfAborted(signal);
    const gen = this.generation;
    if (!gen) {
      throw new Error('RepositoryNavigation: no active generation; call refresh()');
    }
    if (!options || typeof options.term !== 'string') {
      throw new Error('RepositoryNavigation: term is required');
    }
    const token = normalizeTerm(options.term);
    if (!token || token.length > 128) {
      throw new Error(
        'RepositoryNavigation: term must be a single ASCII identifier token',
      );
    }

    const maxBytes = options.maxBytes === undefined ? 32768 : options.maxBytes;
    const maxResults = options.maxResults === undefined ? 40 : options.maxResults;
    const maxVisited = options.maxVisited === undefined ? 1000 : options.maxVisited;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 262144) {
      throw new Error('RepositoryNavigation: maxBytes must be integer in [1024, 262144]');
    }
    if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      throw new Error('RepositoryNavigation: maxResults must be integer in [1, 100]');
    }
    if (!Number.isSafeInteger(maxVisited) || maxVisited < 1 || maxVisited > 10000) {
      throw new Error('RepositoryNavigation: maxVisited must be integer in [1, 10000]');
    }
    // Capture freshness once, before cursor consumption or result traversal.
    // The response then describes precisely the generation the caller searched.
    const freshnessAtStart = await this.inspectFreshness(gen, signal);
    if (freshnessAtStart.policy.freshness !== 'current') {
      throw new Error(
        `RepositoryNavigation: search blocked because policy is ${freshnessAtStart.policy.freshness}` +
        (freshnessAtStart.policy.error ? `: ${freshnessAtStart.policy.error}` : ''),
      );
    }
    if (this.generation === null || this.generation.id !== gen.id) {
      throw new Error('RepositoryNavigation: generation changed during search');
    }

    let position = 0;
    let inputCursorKey: string | undefined;
    if (options.cursor !== undefined) {
      if (
        typeof options.cursor !== 'string' ||
        options.cursor.length === 0 ||
        options.cursor.length > 64
      ) {
        throw new Error('RepositoryNavigation: cursor must be a nonempty string of at most 64 characters');
      }
      this.pruneExpiredCursors();
      const cursor = this.cursors.get(options.cursor);
      if (!cursor) {
        throw new Error('RepositoryNavigation: unknown or expired cursor');
      }
      if (cursor.generation !== gen.id) {
        throw new Error('RepositoryNavigation: cursor bound to different generation');
      }
      if (cursor.term !== token) {
        throw new Error('RepositoryNavigation: cursor bound to different term');
      }
      position = cursor.position;
      inputCursorKey = options.cursor;
    }

    const generationAtStart = gen.id;
    const nextCursorToken = randomUUID().replace(/-/g, '');
    const postings = gen.byToken.get(token) ?? [];
    const results: NavigationResultRecord[] = [];

    const buildResult = (
      complete: boolean,
      stop: NavigationStopReason,
      visitedVal: number,
      withCursor: boolean,
    ): NavigationResult => ({
      trust: 'local-source-unsigned',
      generation: gen.id,
      freshness: freshnessAtStart.freshness,
      ...(freshnessAtStart.error ? { freshnessError: freshnessAtStart.error } : {}),
      policy: { freshness: freshnessAtStart.policy.freshness, digest: freshnessAtStart.policy.digest },
      term: token,
      results,
      bytesUsed: 0,
      maxBytes,
      visited: visitedVal,
      complete,
      stopReason: stop,
      ...(withCursor ? { nextCursor: nextCursorToken } : {}),
    });

    const settle = (r: NavigationResult): void => {
      let prev = -1;
      while (r.bytesUsed !== prev) {
        prev = r.bytesUsed;
        r.bytesUsed = utf8Len(JSON.stringify(r));
      }
    };

    await yieldNow();
    if (signal?.aborted) {
      throw new Error('RepositoryNavigation: aborted');
    }
    if (this.generation === null || this.generation.id !== generationAtStart) {
      throw new Error('RepositoryNavigation: generation changed during search');
    }

    let idx = position;
    let visited = 0;
    let examined = 0;
    let lastYield = 0;
    let stopReason: NavigationStopReason = 'exhausted';

    while (idx < postings.length) {
      if (results.length >= maxResults) {
        stopReason = 'max-results';
        break;
      }
      if (visited >= maxVisited) {
        stopReason = 'max-visited';
        break;
      }
      if (examined - lastYield >= 100) {
        lastYield = examined;
        await yieldNow();
        if (signal?.aborted) {
          throw new Error('RepositoryNavigation: aborted');
        }
        if (this.generation === null || this.generation.id !== generationAtStart) {
          throw new Error('RepositoryNavigation: generation changed during search');
        }
      }
      examined++;
      visited++;
      const loc = gen.locations[postings[idx]];
      results.push({
        path: loc.path,
        line: loc.line,
        text: loc.text,
        sha256: loc.sha256,
      });

      // Measure the candidate: complete-sized only if accepting it exhausts
      // the actual postings; otherwise reserve the cursor token and size
      // visited at maxVisited conservatively.
      const wouldExhaust = idx + 1 >= postings.length;
      const trial = wouldExhaust
        ? buildResult(true, 'exhausted', visited, false)
        : buildResult(false, 'max-results', maxVisited, true);
      settle(trial);

      if (trial.bytesUsed > maxBytes) {
        results.pop();
        // visited already counted the inspected posting; idx stays
        // unconsumed so a continuation retries this posting.
        if (results.length === 0) {
          throw new Error(
            'RepositoryNavigation: first record does not fit; increase maxBytes',
          );
        }
        stopReason = 'max-bytes';
        break;
      }
      idx++;
    }

    const complete = idx >= postings.length;
    if (!complete) {
      if (signal?.aborted) {
        throw new Error('RepositoryNavigation: aborted');
      }
      if (this.generation === null || this.generation.id !== generationAtStart) {
        throw new Error('RepositoryNavigation: generation changed during search');
      }
    }

    const result = buildResult(
      complete,
      complete ? 'exhausted' : stopReason,
      visited,
      !complete,
    );
    settle(result);
    if (result.bytesUsed > maxBytes) {
      throw new Error('RepositoryNavigation: result exceeds maxBytes; increase maxBytes');
    }

    // Commit phase: single-use semantics. Recheck that the input cursor is
    // still the registered one immediately before committing so that a
    // concurrent replay of the same cursor cannot double-consume; the loser
    // is rejected without consuming anything.
    const recheckInputCursor = (): void => {
      if (inputCursorKey === undefined) return;
      const cur = this.cursors.get(inputCursorKey);
      if (
        !cur ||
        cur.generation !== gen.id ||
        cur.term !== token ||
        cur.position !== position
      ) {
        throw new Error(
          'RepositoryNavigation: cursor already consumed by a concurrent continuation',
        );
      }
    };

    this.pruneExpiredCursors();
    if (inputCursorKey !== undefined) {
      recheckInputCursor();
    }
    if (complete) {
      // Exhausted continuation also consumes the input cursor.
      if (inputCursorKey !== undefined) {
        this.cursors.delete(inputCursorKey);
      }
    } else {
      // Failed searches never reach this point, so the input cursor remains
      // usable. When issuing a replacement, the input slot may be reused.
      const replacesInput =
        inputCursorKey !== undefined && this.cursors.has(inputCursorKey);
      if (this.cursors.size - (replacesInput ? 1 : 0) >= CURSOR_MAX_ENTRIES) {
        throw new Error(
          'RepositoryNavigation: cursor capacity reached; refresh or wait for expiry',
        );
      }
      if (inputCursorKey !== undefined) {
        this.cursors.delete(inputCursorKey);
      }
      this.cursors.set(nextCursorToken, {
        generation: gen.id,
        term: token,
        position: idx,
        createdAt: Date.now(),
      });
    }

    return makeFrozen(result);
  }


  private pruneExpiredCursors(): void {
    const now = Date.now();
    for (const [k, v] of this.cursors) {
      if (now - v.createdAt > CURSOR_TTL_MS) {
        this.cursors.delete(k);
      }
    }
  }

  private async resolveRoot(signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const absInput = path.resolve(this.rootInput);
    const lstat = await fsp.lstat(absInput);
    throwIfAborted(signal);
    if (lstat.isSymbolicLink()) {
      throw new Error('RepositoryNavigation: root must not be a symlink');
    }
    if (!lstat.isDirectory()) {
      throw new Error('RepositoryNavigation: root must be a directory');
    }
    const real = await fsp.realpath(absInput);
    throwIfAborted(signal);
    const realStat = await fsp.stat(real);
    throwIfAborted(signal);
    if (!realStat.isDirectory()) {
      throw new Error('RepositoryNavigation: root must be a directory');
    }
    return real;
  }

  private async inspectFreshness(
    generation: Generation,
    signal?: AbortSignal,
  ): Promise<FreshnessInspection> {
    let discovery: Discovery;
    try {
      throwIfAborted(signal);
      const root = await this.resolveRoot(signal);
      discovery = await this.discoverEligible(root, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = boundedError(error);
      return {
        freshness: 'unknown',
        error: message,
        policy: {
          freshness: 'unknown',
          digest: generation.policyRevision,
          summary: generation.policySummary,
          error: message,
        },
      };
    }
    const policy: NavigationPolicyState = {
      freshness: discovery.policyRevision === generation.policyRevision ? 'current' : 'stale',
      digest: generation.policyRevision,
      summary: generation.policySummary,
    };
    if (policy.freshness !== 'current') return { freshness: 'stale', policy };
    try {
      const manifest = await this.buildManifest(discovery, signal);
      throwIfAborted(signal);
      return {
        freshness: manifest.revision === generation.revision ? 'current' : 'stale',
        policy,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { freshness: 'unknown', error: boundedError(error), policy };
    }
  }

  private async buildManifest(discovery: Discovery, signal?: AbortSignal): Promise<Manifest> {
    const { files } = discovery;
    const manifestFiles: ManifestFile[] = [];
    let totalBytes = 0;
    for (const entry of files) {
      throwIfAborted(signal);
      await yieldNow();
      throwIfAborted(signal);
      const { raw } = await this.readSource(entry.abs, this.limits.maxFileBytes, signal);
      throwIfAborted(signal);
      if (totalBytes + raw.byteLength > this.limits.maxBytes) {
        throw new Error(`RepositoryNavigation: maxBytes quota exceeded (${this.limits.maxBytes})`);
      }
      totalBytes += raw.byteLength;
      manifestFiles.push({
        path: entry.rel,
        bytes: raw.byteLength,
        sha256: createHash('sha256').update(raw).digest('hex'),
      });
    }
    const allFiles = [...discovery.policy.manifest(), ...manifestFiles];
    return { files: allFiles, revision: manifestRevision(allFiles) };
  }

  private async discoverEligible(root: string, signal?: AbortSignal): Promise<Discovery> {
    const exclusions: NavigationExclusions = {
      symlinks: 0, ignored: 0, policy: 0, unsupported: 0, oversizedFiles: 0,
      oversizedLines: 0, maxDepth: 0, visitedCap: 0,
    };
    const files: { abs: string; rel: string }[] = [];
    let visitedEntries = 0;
    const policy = await NavigationPolicy.load(root, signal);
    const stack: { dir: string; rel: string; depth: number; scope: NavigationPolicyScope }[] = [
      { dir: root, rel: '', depth: 0, scope: policy.rootDirectoryScope() },
    ];
    while (stack.length > 0) {
      throwIfAborted(signal);
      const frame = stack.pop()!;
      let directory: import('node:fs').Stats;
      try { directory = await fsp.lstat(frame.dir); } catch (error) {
        throw new Error(`RepositoryNavigation: failed to lstat directory ${frame.dir}: ${String(error)}`);
      }
      throwIfAborted(signal);
      if (!directory.isDirectory()) {
        throw new Error(`RepositoryNavigation: directory changed between check and open: ${frame.dir}`);
      }
      let handle: import('node:fs').Dir;
      try { handle = await fsp.opendir(frame.dir); } catch (error) {
        throw new Error(`RepositoryNavigation: failed to opendir ${frame.dir}: ${String(error)}`);
      }
      const names: string[] = [];
      try {
        throwIfAborted(signal);
        for (;;) {
          const entry = await handle.read();
          throwIfAborted(signal);
          if (entry === null) break;
          if (++visitedEntries > VISITED_ENTRIES_CAP) {
            throw new Error(`RepositoryNavigation: visited entries cap exceeded (${VISITED_ENTRIES_CAP})`);
          }
          names.push(entry.name);
          if (names.length % YIELD_CHUNK === 0) {
            await yieldNow();
            throwIfAborted(signal);
          }
        }
      } finally { await handle.close(); }
      names.sort();
      const subdirs: { dir: string; rel: string; depth: number; scope: NavigationPolicyScope }[] = [];
      for (const name of names) {
        throwIfAborted(signal);
        if (isHiddenName(name)) { exclusions.ignored++; continue; }
        const full = path.join(frame.dir, name);
        let stat: import('node:fs').Stats;
        try { stat = await fsp.lstat(full); } catch (error) {
          throw new Error(`RepositoryNavigation: failed to lstat ${full}: ${String(error)}`);
        }
        throwIfAborted(signal);
        if (stat.isSymbolicLink()) { exclusions.symlinks++; continue; }
        const rel = toPosix(path.relative(root, full));
        if (stat.isDirectory()) {
          if (EXCLUDED_DIRS.has(name)) { exclusions.ignored++; continue; }
          if (!policy.allows(rel, true, frame.scope)) { exclusions.policy++; continue; }
          if (frame.depth + 1 > this.limits.maxDepth) { exclusions.maxDepth++; continue; }
          const real = await fsp.realpath(full);
          throwIfAborted(signal);
          if (!isInsideRoot(root, real)) { exclusions.symlinks++; continue; }
          const scope = await policy.enterDirectory(rel, frame.scope, signal);
          throwIfAborted(signal);
          subdirs.push({ dir: real, rel, depth: frame.depth + 1, scope });
          continue;
        }
        if (!stat.isFile()) { exclusions.unsupported++; continue; }
        if (!policy.allows(rel, false, frame.scope)) { exclusions.policy++; continue; }
        if (!isSupportedPath(full)) { exclusions.unsupported++; continue; }
        const real = await fsp.realpath(full);
        throwIfAborted(signal);
        if (!isInsideRoot(root, real)) { exclusions.symlinks++; continue; }
        if (files.length >= this.limits.maxFiles) {
          throw new Error(`RepositoryNavigation: maxFiles quota exceeded (${this.limits.maxFiles})`);
        }
        files.push({ abs: real, rel: toPosix(path.relative(root, real)) });
      }
      subdirs.reverse();
      for (const subdir of subdirs) stack.push(subdir);
    }
    files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    const policyFiles = policy.manifest();
    return {
      files,
      exclusions,
      policy,
      policyRevision: manifestRevision(policyFiles),
      policySummary: policy.summary(),
    };
  }

  private async buildGeneration(
    root: string,
    signal?: AbortSignal,
  ): Promise<Generation> {
    const limits = this.limits;
    const discovery = await this.discoverEligible(root, signal);
    const { files: discovered, exclusions } = discovery;

    const indexedFiles: IndexedFile[] = [];
    const locations: IndexedLocation[] = [];
    const byToken = new Map<string, number[]>();
    let postings = 0;
    let totalBytes = 0;

    for (const entry of discovered) {
      if (signal?.aborted) {
        throw new Error('RepositoryNavigation: aborted');
      }
      await yieldNow();
      if (signal?.aborted) {
        throw new Error('RepositoryNavigation: aborted');
      }
      const { content, raw } = await this.readSource(entry.abs, limits.maxFileBytes, signal);
      throwIfAborted(signal);
      const rawBytes = raw.byteLength;
      if (totalBytes + rawBytes > limits.maxBytes) {
        throw new Error(
          `RepositoryNavigation: maxBytes quota exceeded (${limits.maxBytes})`,
        );
      }
      totalBytes += rawBytes;
      const sha256 = createHash('sha256').update(raw).digest('hex');
      const lines = splitLines(content);
      const fileLocs: IndexedLocation[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (i % YIELD_CHUNK === 0) {
          await yieldNow();
          if (signal?.aborted) {
            throw new Error('RepositoryNavigation: aborted');
          }
        }
        const text = lines[i];
        if (text.length === 0) {
          continue;
        }
        if (utf8Len(text) > MAX_LINE_BYTES) {
          exclusions.oversizedLines++;
          continue;
        }
        const tokens = new Set(tokenizeLine(text));
        if (tokens.size === 0) {
          continue;
        }
        if (locations.length >= limits.maxLocations) {
          throw new Error(
            `RepositoryNavigation: maxLocations quota exceeded (${limits.maxLocations})`,
          );
        }
        if (postings + tokens.size > limits.maxPostings) {
          throw new Error(
            `RepositoryNavigation: maxPostings quota exceeded (${limits.maxPostings})`,
          );
        }
        const loc: IndexedLocation = {
          path: entry.rel,
          line: i + 1,
          text,
          sha256,
        };
        const locIndex = locations.length;
        locations.push(loc);
        fileLocs.push(loc);
        for (const token of tokens) {
          let list = byToken.get(token);
          if (list === undefined) {
            list = [];
            byToken.set(token, list);
          }
          list.push(locIndex);
          postings++;
        }
      }
      indexedFiles.push({
        path: entry.rel,
        sha256,
        bytes: rawBytes,
        locations: fileLocs,
      });
    }

    if (signal?.aborted) {
      throw new Error('RepositoryNavigation: aborted');
    }

    return {
      id: randomUUID(),
      builtAt: Date.now(),
      revision: manifestRevision([...discovery.policy.manifest(), ...indexedFiles]),
      policyRevision: discovery.policyRevision,
      policySummary: discovery.policySummary,
      files: indexedFiles,
      byToken,
      locations,
      counts: {
        files: indexedFiles.length,
        bytes: totalBytes,
        locations: locations.length,
        postings,
      },
      exclusions,
      limits: { ...limits },
    };
  }

  private async readSource(
    filePath: string,
    maxFileBytes: number,
    signal?: AbortSignal,
  ): Promise<{ content: string; raw: Buffer }> {
    throwIfAborted(signal);
    const handle = await fsp.open(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      throwIfAborted(signal);
      const before = await handle.stat();
      throwIfAborted(signal);
      if (!before.isFile()) {
        throw new Error(
          `RepositoryNavigation: not a regular file: ${filePath}`,
        );
      }
      if (before.size > maxFileBytes) {
        throw new Error(
          `RepositoryNavigation: file exceeds maxFileBytes quota (${maxFileBytes}): ${filePath}`,
        );
      }
      const cap = maxFileBytes;
      const buf = Buffer.alloc(cap + 1);
      let pos = 0;
      while (pos < buf.length) {
        const { bytesRead } = await handle.read(buf, pos, buf.length - pos, pos);
        throwIfAborted(signal);
        if (bytesRead === 0) {
          break;
        }
        pos += bytesRead;
      }
      if (pos > cap) {
        throw new Error(
          `RepositoryNavigation: file exceeds maxFileBytes quota (${maxFileBytes}): ${filePath}`,
        );
      }
      const after = await handle.stat();
      throwIfAborted(signal);
      if (
        pos !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      ) {
        throw new Error(
          `RepositoryNavigation: file observed changed during read: ${filePath}`,
        );
      }
      const raw = buf.subarray(0, pos);
      const decoder = new TextDecoder('utf8', { fatal: true, ignoreBOM: true });
      const content = decoder.decode(raw);
      return { content, raw };
    } finally {
      await handle.close();
    }
  }
}

function splitLines(content: string): string[] {
  // Split on \n; strip a trailing \r for CRLF files.
  const raw = content.split('\n');
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].endsWith('\r')) raw[i] = raw[i].slice(0, -1);
  }
  return raw;
}
