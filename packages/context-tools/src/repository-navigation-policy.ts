import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';

const CONFIG_FILE = '.z1p-navigation.json';
const IGNORE_FILE = '.gitignore';
const MAX_POLICY_FILE_BYTES = 64 * 1024;
const MAX_POLICY_FILES = 256;
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_CONFIG_ENTRIES = 128;
const MAX_CONFIG_PATH_BYTES = 512;

export interface NavigationPolicyFile {
  path: string;
  sha256: string;
  bytes: number;
}

/** A policy/configuration failure that must fail refresh closed. */
export class NavigationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavigationPolicyError';
  }
}

export interface NavigationPolicySummary {
  configPath: string | null;
  includeMode: 'all' | 'prefixes' | 'none';
  include: number;
  exclude: number;
  policyFiles: number;
  policyBytes: number;
}

interface NavigationPolicyConfig {
  include: string[] | null;
  exclude: string[];
  configPath: string | null;
}

interface IgnoreLayer {
  directory: string;
  matcher: Ignore;
}

export interface NavigationPolicyScope {
  readonly directory: string;
  readonly layers: readonly IgnoreLayer[];
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('RepositoryNavigationPolicy: aborted');
}

function policyFailure(context: string, error: unknown): NavigationPolicyError | Error {
  if (error instanceof NavigationPolicyError) return error;
  if (error instanceof Error && error.message === 'RepositoryNavigationPolicy: aborted') return error;
  return new NavigationPolicyError(`RepositoryNavigationPolicy: ${context}: ${String(error)}`);
}

function assertRelativePath(value: unknown, field: string, allowDot: boolean): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: ${field} paths must be non-empty strings`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_CONFIG_PATH_BYTES) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: ${field} paths must be at most ${MAX_CONFIG_PATH_BYTES} bytes`);
  }
  if (/[\u0000-\u001f\u007f\\]/.test(value) || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: invalid ${field} path`);
  }
  if (value === '.') {
    if (allowDot) return value;
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: invalid ${field} path`);
  }
  if (value.startsWith('./') || value.endsWith('/') || value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: invalid ${field} path`);
  }
  return value;
}

function assertLiteralPrefix(value: string, field: string): void {
  if (/[*?[\]{}!]/.test(value)) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: ${field} paths are literal prefixes, not globs`);
  }
}

function assertRelativeDirectory(value: string): void {
  if (value === '') return;
  assertRelativePath(value, 'directory', false);
}

function isPrefix(prefix: string, target: string): boolean {
  return prefix === '.' || target === prefix || target.startsWith(`${prefix}/`);
}

function configAllows(config: NavigationPolicyConfig, relativePath: string, isDirectory: boolean): boolean {
  if (config.exclude.some(prefix => isPrefix(prefix, relativePath))) return false;
  if (config.include === null || config.include.includes('.')) return true;
  if (config.include.some(prefix => isPrefix(prefix, relativePath))) return true;
  // Directories which lead to an included path must be traversed.
  return isDirectory && config.include.some(prefix => prefix.startsWith(`${relativePath}/`));
}

function relativeFrom(directory: string, target: string): string {
  return directory === '' ? target : target.slice(directory.length + 1);
}

export class NavigationPolicy {
  private readonly root: string;
  private config: NavigationPolicyConfig;
  private readonly files = new Map<string, NavigationPolicyFile>();
  private policyBytes = 0;
  private rootScope: NavigationPolicyScope;

  private constructor(root: string, config: NavigationPolicyConfig) {
    this.root = root;
    this.config = config;
    this.rootScope = { directory: '', layers: [] };
  }

  static async load(root: string, signal?: AbortSignal): Promise<NavigationPolicy> {
    abortIfNeeded(signal);
    let canonicalRoot: string;
    let rootStat: import('node:fs').Stats;
    try {
      canonicalRoot = await fsp.realpath(root);
      rootStat = await fsp.lstat(canonicalRoot);
    } catch (error) {
      throw new NavigationPolicyError(`RepositoryNavigationPolicy: cannot inspect root: ${String(error)}`);
    }
    abortIfNeeded(signal);
    if (!rootStat.isDirectory()) throw new NavigationPolicyError('RepositoryNavigationPolicy: root must be a directory');

    const empty: NavigationPolicyConfig = { include: null, exclude: [], configPath: null };
    const policy = new NavigationPolicy(canonicalRoot, empty);
    const configText = await policy.readOptionalPolicyFile(CONFIG_FILE, signal);
    if (configText !== null) {
      policy.config = parseConfig(configText, CONFIG_FILE);
    }
    policy.rootScope = await policy.loadScope('', { directory: '', layers: [] }, signal);
    return policy;
  }

  async enterDirectory(
    relativeDir: string,
    parentScope: NavigationPolicyScope,
    signal?: AbortSignal,
  ): Promise<NavigationPolicyScope> {
    abortIfNeeded(signal);
    assertRelativeDirectory(relativeDir);
    const parentDirectory = relativeDir === '' ? '' : path.posix.dirname(relativeDir);
    if ((parentDirectory === '.' ? '' : parentDirectory) !== parentScope.directory) {
      throw new NavigationPolicyError('RepositoryNavigationPolicy: scope must be the direct parent directory');
    }
    if (parentScope.directory === '' && relativeDir === '') return parentScope;
    return this.loadScope(relativeDir, parentScope, signal);
  }

  rootDirectoryScope(): NavigationPolicyScope {
    return this.rootScope;
  }

  allows(relativePath: string, isDirectory: boolean, scope: NavigationPolicyScope): boolean {
    assertRelativePath(relativePath, 'candidate', false);
    if (scope.directory !== '' && !relativePath.startsWith(`${scope.directory}/`)) {
      throw new NavigationPolicyError('RepositoryNavigationPolicy: candidate is outside scope');
    }
    if (!configAllows(this.config, relativePath, isDirectory)) return false;
    let allowed = true;
    for (const layer of scope.layers) {
      if (layer.directory !== '' && !relativePath.startsWith(`${layer.directory}/`)) continue;
      const local = relativeFrom(layer.directory, relativePath) + (isDirectory ? '/' : '');
      const outcome = layer.matcher.test(local);
      if (outcome.ignored) allowed = false;
      else if (outcome.unignored) allowed = true;
    }
    return allowed;
  }

  manifest(): NavigationPolicyFile[] {
    return [...this.files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }

  summary(): NavigationPolicySummary {
    return {
      configPath: this.config.configPath,
      includeMode: this.config.include === null ? 'all' : this.config.include.length === 0 ? 'none' : 'prefixes',
      include: this.config.include?.length ?? 0,
      exclude: this.config.exclude.length,
      policyFiles: this.files.size,
      policyBytes: this.policyBytes,
    };
  }

  private async loadScope(
    directory: string,
    parentScope: NavigationPolicyScope,
    signal?: AbortSignal,
  ): Promise<NavigationPolicyScope> {
    const policyPath = directory === '' ? IGNORE_FILE : `${directory}/${IGNORE_FILE}`;
    const content = await this.readOptionalPolicyFile(policyPath, signal);
    if (content === null) return { directory, layers: parentScope.layers };
    let matcher: Ignore;
    try {
      matcher = ignore({ ignorecase: false }).add(content);
    } catch {
      throw new NavigationPolicyError(`RepositoryNavigationPolicy: invalid ignore rules in ${policyPath}`);
    }
    return { directory, layers: [...parentScope.layers, { directory, matcher }] };
  }

  private async readOptionalPolicyFile(relativePath: string, signal?: AbortSignal): Promise<string | null> {
    abortIfNeeded(signal);
    const absolute = path.join(this.root, ...relativePath.split('/'));
    let expected: import('node:fs').Stats;
    try {
      expected = await fsp.lstat(absolute);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new NavigationPolicyError(`RepositoryNavigationPolicy: cannot inspect ${relativePath}: ${String(error)}`);
    }
    if (expected.isSymbolicLink() || !expected.isFile()) {
      throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy is not a regular file: ${relativePath}`);
    }
    let handle: import('node:fs/promises').FileHandle;
    try {
      handle = await fsp.open(absolute, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
    } catch (error: unknown) {
      throw new NavigationPolicyError(`RepositoryNavigationPolicy: cannot read ${relativePath}: ${String(error)}`);
    }
    try {
      abortIfNeeded(signal);
      const before = await handle.stat();
      abortIfNeeded(signal);
      if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino) {
        throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy changed before open: ${relativePath}`);
      }
      if (before.size > MAX_POLICY_FILE_BYTES) throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy exceeds ${MAX_POLICY_FILE_BYTES} bytes: ${relativePath}`);
      if (this.files.size >= MAX_POLICY_FILES && !this.files.has(relativePath)) {
        throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy file cap exceeded (${MAX_POLICY_FILES})`);
      }
      if (this.policyBytes + before.size > MAX_POLICY_BYTES && !this.files.has(relativePath)) {
        throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy byte cap exceeded (${MAX_POLICY_BYTES})`);
      }
      const raw = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < raw.length) {
        abortIfNeeded(signal);
        const { bytesRead } = await handle.read(raw, offset, raw.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      abortIfNeeded(signal);
      const after = await handle.stat();
      abortIfNeeded(signal);
      if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy changed during read: ${relativePath}`);
      }
      const exact = raw.subarray(0, offset);
      let text: string;
      try { text = new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(exact); } catch (error) {
        throw new NavigationPolicyError(`RepositoryNavigationPolicy: policy is not valid UTF-8: ${relativePath}: ${String(error)}`);
      }
      if (!this.files.has(relativePath)) this.policyBytes += exact.byteLength;
      this.files.set(relativePath, {
        path: relativePath,
        bytes: exact.byteLength,
        sha256: createHash('sha256').update(exact).digest('hex'),
      });
      return text;
    } catch (error) {
      throw policyFailure(`cannot read ${relativePath}`, error);
    } finally {
      try {
        await handle.close();
        abortIfNeeded(signal);
      } catch (error) {
        throw policyFailure(`cannot close ${relativePath}`, error);
      }
    }
  }
}

function parseConfig(text: string, configPath: string): NavigationPolicyConfig {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: invalid JSON in ${configPath}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: ${configPath} must be an object`);
  }
  const object = raw as Record<string, unknown>;
  if (Object.keys(object).some(key => key !== 'version' && key !== 'include' && key !== 'exclude') || object.version !== 1) {
    throw new NavigationPolicyError(`RepositoryNavigationPolicy: ${configPath} must contain only version: 1, include, and exclude`);
  }
  const parseList = (field: 'include' | 'exclude'): string[] | null => {
    const input = object[field];
    if (input === undefined) return field === 'include' ? null : [];
    if (!Array.isArray(input) || input.length > MAX_CONFIG_ENTRIES) {
      throw new NavigationPolicyError(`RepositoryNavigationPolicy: ${field} must contain at most ${MAX_CONFIG_ENTRIES} paths`);
    }
    return input.map(value => {
      const parsed = assertRelativePath(value, field, field === 'include');
      assertLiteralPrefix(parsed, field);
      return parsed;
    });
  };
  const include = parseList('include');
  const exclude = parseList('exclude');
  return { include, exclude: exclude!, configPath };
}
