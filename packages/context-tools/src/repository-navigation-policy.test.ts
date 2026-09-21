import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { NavigationPolicy, NavigationPolicyError } from './repository-navigation-policy.js';

const owned: string[] = [];
async function fixture(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'repo-policy-'));
  owned.push(root);
  return root;
}
async function write(root: string, rel: string, value: string | Buffer): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, value);
}
afterEach(async () => {
  vi.restoreAllMocks();
  while (owned.length) await fsp.rm(owned.pop()!, { recursive: true, force: true });
});

describe('NavigationPolicy', () => {
  it('applies root and nested ignores, with nested rules overriding ancestors for entered directories', async () => {
    const root = await fixture();
    await write(root, '.gitignore', 'skip/\n*.tmp\n');
    await write(root, 'nested/.gitignore', '!keep.tmp\n');
    const policy = await NavigationPolicy.load(root);
    const rootScope = policy.rootDirectoryScope();
    expect(policy.allows('skip', true, rootScope)).toBe(false);
    expect(policy.allows('a.tmp', false, rootScope)).toBe(false);
    const nested = await policy.enterDirectory('nested', rootScope);
    expect(policy.allows('nested/drop.tmp', false, nested)).toBe(false);
    expect(policy.allows('nested/keep.tmp', false, nested)).toBe(true);
  });

  it('does not permit a child ignore to reinclude a directory that discovery pruned', async () => {
    const root = await fixture();
    await write(root, '.gitignore', 'gone/\n');
    await write(root, 'gone/.gitignore', '!wanted.ts\n');
    const policy = await NavigationPolicy.load(root);
    expect(policy.allows('gone', true, policy.rootDirectoryScope())).toBe(false);
  });

  it('matches gitignore rules case-sensitively', async () => {
    const root = await fixture();
    await write(root, '.gitignore', 'Readme.md\n');
    const policy = await NavigationPolicy.load(root);
    const scope = policy.rootDirectoryScope();
    expect(policy.allows('Readme.md', false, scope)).toBe(false);
    expect(policy.allows('README.md', false, scope)).toBe(true);
  });

  it('keeps include ancestors, while exclude wins over include', async () => {
    const root = await fixture();
    await write(root, '.z1p-navigation.json', JSON.stringify({ version: 1, include: ['src/kept'], exclude: ['src/kept/private'] }));
    const policy = await NavigationPolicy.load(root);
    const scope = policy.rootDirectoryScope();
    expect(policy.allows('src', true, scope)).toBe(true);
    expect(policy.allows('src/kept', true, scope)).toBe(true);
    expect(policy.allows('src/other.ts', false, scope)).toBe(false);
    expect(policy.allows('src/kept/a.ts', false, scope)).toBe(true);
    expect(policy.allows('src/kept/private', true, scope)).toBe(false);
  });

  it.each([
    '{"version":1,"unknown":true}',
    '{"version":2}',
    '{"version":1,"include":["../escape"]}',
    '{"version":1,"exclude":["a\\\\b"]}',
  ])('rejects malformed or escaping configuration %s', async config => {
    const root = await fixture();
    await write(root, '.z1p-navigation.json', config);
    await expect(NavigationPolicy.load(root)).rejects.toBeInstanceOf(NavigationPolicyError);
  });

  it('treats an explicit empty include list as deny-all and rejects globs and Windows paths', async () => {
    const root = await fixture();
    await write(root, '.z1p-navigation.json', JSON.stringify({ version: 1, include: [] }));
    const policy = await NavigationPolicy.load(root);
    expect(policy.allows('src', true, policy.rootDirectoryScope())).toBe(false);
    expect(policy.summary().includeMode).toBe('none');
    await write(root, '.z1p-navigation.json', JSON.stringify({ version: 1, exclude: ['secret*'] }));
    await expect(NavigationPolicy.load(root)).rejects.toBeInstanceOf(NavigationPolicyError);
    await write(root, '.z1p-navigation.json', JSON.stringify({ version: 1, exclude: ['C:/secret'] }));
    await expect(NavigationPolicy.load(root)).rejects.toBeInstanceOf(NavigationPolicyError);
  });

  it('reports all when include is omitted and prefixes when it is non-empty', async () => {
    const root = await fixture();
    expect((await NavigationPolicy.load(root)).summary().includeMode).toBe('all');
    await write(root, '.z1p-navigation.json', JSON.stringify({ version: 1, include: ['src'] }));
    expect((await NavigationPolicy.load(root)).summary().includeMode).toBe('prefixes');
  });

  it('fails closed if a policy disappears after lstat and rejects a directory before open', async () => {
    const root = await fixture();
    await write(root, '.gitignore', 'private/\n');
    const open = vi.spyOn(fsp, 'open').mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    await expect(NavigationPolicy.load(root)).rejects.toBeInstanceOf(NavigationPolicyError);
    open.mockRestore();

    const directoryRoot = await fixture();
    await fsp.mkdir(path.join(directoryRoot, '.gitignore'));
    const directoryOpen = vi.spyOn(fsp, 'open');
    await expect(NavigationPolicy.load(directoryRoot)).rejects.toBeInstanceOf(NavigationPolicyError);
    expect(directoryOpen).not.toHaveBeenCalled();
  });

  it('enforces aggregate policy-file and byte caps', async () => {
    const fileCapRoot = await fixture();
    await write(fileCapRoot, '.gitignore', 'root\n');
    let fileRelative = '';
    for (let i = 0; i < 255; i++) {
      fileRelative = `d${i}`;
      await write(fileCapRoot, `${fileRelative}/.gitignore`, 'rule\n');
    }
    // Re-load through one complete scope chain so each policy file contributes to the cap.
    let capped = await NavigationPolicy.load(fileCapRoot);
    let scope = capped.rootDirectoryScope();
    let relative = '';
    for (let i = 0; i < 255; i++) {
      relative = `d${i}`;
      scope = await capped.enterDirectory(relative, scope);
      scope = capped.rootDirectoryScope();
    }
    relative = 'overflow';
    await write(fileCapRoot, `${relative}/.gitignore`, 'rule\n');
    await expect(capped.enterDirectory(relative, scope)).rejects.toThrow(/file cap/);

    const byteCapRoot = await fixture();
    const block = 'x'.repeat(64 * 1024);
    await write(byteCapRoot, '.gitignore', block);
    const bytePolicy = await NavigationPolicy.load(byteCapRoot);
    let byteScope = bytePolicy.rootDirectoryScope();
    let byteRelative = '';
    for (let i = 0; i < 15; i++) {
      byteRelative = `b${i}`;
      await write(byteCapRoot, `${byteRelative}/.gitignore`, block);
      byteScope = await bytePolicy.enterDirectory(byteRelative, byteScope);
      byteScope = bytePolicy.rootDirectoryScope();
    }
    byteRelative = 'overflow';
    await write(byteCapRoot, `${byteRelative}/.gitignore`, block);
    await expect(bytePolicy.enterDirectory(byteRelative, byteScope)).rejects.toThrow(/byte cap/);
  });

  it('does not echo invalid configuration content and closes after a mid-operation abort', async () => {
    const root = await fixture();
    const secret = 'do-not-echo-this-config';
    await write(root, '.z1p-navigation.json', `{${secret}`);
    await expect(NavigationPolicy.load(root)).rejects.not.toThrow(secret);

    const abortRoot = await fixture();
    await write(abortRoot, '.gitignore', 'rule\n');
    const controller = new AbortController();
    const open = vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      const handle = await openFile(...args);
      controller.abort();
      return handle;
    });
    await expect(NavigationPolicy.load(abortRoot, controller.signal)).rejects.toThrow(/aborted/);
    open.mockRestore();
  });

  it('fails closed for symlinked, oversized, and invalid UTF-8 policy files', async () => {
    const symlinkRoot = await fixture();
    await write(symlinkRoot, 'outside', '*.ts\n');
    await fsp.symlink(path.join(symlinkRoot, 'outside'), path.join(symlinkRoot, '.gitignore'));
    await expect(NavigationPolicy.load(symlinkRoot)).rejects.toBeInstanceOf(NavigationPolicyError);

    const oversizedRoot = await fixture();
    await write(oversizedRoot, '.gitignore', 'x'.repeat(64 * 1024 + 1));
    await expect(NavigationPolicy.load(oversizedRoot)).rejects.toBeInstanceOf(NavigationPolicyError);

    const utf8Root = await fixture();
    await write(utf8Root, '.gitignore', Buffer.from([0xff]));
    await expect(NavigationPolicy.load(utf8Root)).rejects.toBeInstanceOf(NavigationPolicyError);
  });

  it('includes policy-only changes in the deterministic manifest', async () => {
    const root = await fixture();
    await write(root, '.gitignore', 'one\n');
    const first = await NavigationPolicy.load(root);
    await write(root, '.gitignore', 'two\n');
    const second = await NavigationPolicy.load(root);
    expect(first.manifest()).toHaveLength(1);
    expect(second.manifest()[0].sha256).not.toBe(first.manifest()[0].sha256);
    expect(second.summary()).toMatchObject({ configPath: null, policyFiles: 1 });
  });

  it('honours cancellation before loading or entering a directory', async () => {
    const root = await fixture();
    const aborted = new AbortController();
    aborted.abort();
    await expect(NavigationPolicy.load(root, aborted.signal)).rejects.toThrow(/aborted/);
    const policy = await NavigationPolicy.load(root);
    const later = new AbortController();
    later.abort();
    await expect(policy.enterDirectory('child', policy.rootDirectoryScope(), later.signal)).rejects.toThrow(/aborted/);
  });
});
