import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { RepositoryNavigation } from './repository-navigation.js';

const owned: string[] = [];

async function mkFixture(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'repo-nav-'));
  owned.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (owned.length) {
    const d = owned.pop()!;
    try {
      await fsp.rm(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

async function writeFile(root: string, rel: string, content: string): Promise<string> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
  return full;
}

async function writeFileBuffer(root: string, rel: string, content: Buffer): Promise<string> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content);
  return full;
}

describe('RepositoryNavigation', () => {
  it('finds line 10001 in a >10000 line fixture', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 1; i <= 10050; i++) {
      lines.push(`line${i} alpha`);
    }
    await writeFile(root, 'big.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    const st = await nav.refresh();
    expect(st.generation).toBeTruthy();
    const res = await nav.search({ term: 'line10001' });
    expect(res.results.length).toBe(1);
    expect(res.results[0].line).toBe(10001);
    expect(res.results[0].text).toBe('line10001 alpha');
  });

  it('iterates entire common-token postings across small pages with no duplicates', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 1; i <= 200; i++) lines.push(`common token${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const res = await nav.search({
        term: 'common',
        maxBytes: 1024,
        maxResults: 5,
        maxVisited: 100,
        cursor,
      });
      for (const r of res.results) {
        const key = `${r.path}:${r.line}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (res.complete) break;
      expect(res.nextCursor).toBeTruthy();
      cursor = res.nextCursor;
    }
    expect(seen.size).toBe(200);
  });

  it('respects maxResults and maxBytes budgets', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) lines.push(`token shared payload_${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const r1 = await nav.search({ term: 'shared', maxResults: 3 });
    expect(r1.results.length).toBe(3);
    expect(r1.stopReason).toBe('max-results');
    expect(r1.complete).toBe(false);
    const r2 = await nav.search({ term: 'shared', maxBytes: 1024 });
    expect(r2.bytesUsed).toBeLessThanOrEqual(1024);
  });

  it('validates limits on constructor and search', async () => {
    expect(() => new RepositoryNavigation('/x', { maxFiles: 0 })).toThrow();
    expect(() => new RepositoryNavigation('/x', { maxFiles: 999999 })).toThrow();
    const root = await mkFixture();
    await writeFile(root, 'a.ts', 'hello world\n');
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    await expect(nav.search({ term: '' })).rejects.toThrow();
    await expect(nav.search({ term: 'two words' })).rejects.toThrow();
    await expect(nav.search({ term: 'ok', maxBytes: 10 })).rejects.toThrow();
    await expect(nav.search({ term: 'ok', maxResults: 0 })).rejects.toThrow();
    await expect(nav.search({ term: 'ok', maxVisited: 0 })).rejects.toThrow();
  });

  it('throws on oversized first record budget', async () => {
    const root = await mkFixture();
    const big = 'x'.repeat(1500) + ' uniqueverylongtoken';
    await writeFile(root, 'a.ts', big + '\n');
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    await expect(
      nav.search({ term: 'uniqueverylongtoken', maxBytes: 1024 }),
    ).rejects.toThrow(/increase maxBytes/i);
  });

  it('rejects wrong-term, stale, and unknown cursors', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) lines.push(`aaa shared ${i}`);
    for (let i = 0; i < 30; i++) lines.push(`bbb shared ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const r = await nav.search({ term: 'shared', maxResults: 2 });
    const cursor = r.nextCursor!;
    await expect(
      nav.search({ term: 'aaa', cursor }),
    ).rejects.toThrow(/different term/);
    await expect(
      nav.search({ term: 'shared', cursor: 'nope' }),
    ).rejects.toThrow(/unknown or expired/);
    // Refresh invalidates cursors.
    await nav.refresh();
    await expect(
      nav.search({ term: 'shared', cursor }),
    ).rejects.toThrow(/unknown or expired|different generation/);
  });

  it('refresh deletion removes records', async () => {
    const root = await mkFixture();
    const p = await writeFile(root, 'a.ts', 'alpha beta\n');
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    let res = await nav.search({ term: 'alpha' });
    expect(res.results.length).toBe(1);
    await fsp.unlink(p);
    await nav.refresh();
    res = await nav.search({ term: 'alpha' });
    expect(res.results.length).toBe(0);
  });

  it('failed overquota refresh retains old results and cursors', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(`shared line ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root, { maxFiles: 5 });
    await nav.refresh();
    const r = await nav.search({ term: 'shared', maxResults: 3 });
    expect(r.results.length).toBe(3);
    const cursor = r.nextCursor!;
    // Add a file that exceeds maxFiles.
    for (let i = 0; i < 10; i++) {
      await writeFile(root, `extra${i}.ts`, `shared ${i}\n`);
    }
    await expect(nav.refresh()).rejects.toThrow(/maxFiles/);
    const st = nav.status();
    expect(st.generation).toBeTruthy();
    const r2 = await nav.search({ term: 'shared', cursor });
    expect(r2.results.length).toBeGreaterThan(0);
  });

  it('failed refresh keeps prior generation and existing cursor usable', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push(`token shared ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root, { maxFiles: 3 });
    const st1 = await nav.refresh();
    const gen1 = st1.generation;
    expect(gen1).toBeTruthy();
    const r = await nav.search({ term: 'shared', maxResults: 2 });
    const cursor = r.nextCursor!;
    for (let i = 0; i < 5; i++) {
      await writeFile(root, `extra${i}.ts`, `shared ${i}\n`);
    }
    await expect(nav.refresh()).rejects.toThrow(/maxFiles/);
    const st2 = nav.status();
    expect(st2.generation).toBe(gen1);
    const r2 = await nav.search({ term: 'shared', cursor });
    expect(r2.results.length).toBeGreaterThan(0);
    expect(r2.generation).toBe(gen1);
  });

  it('skips symlinks', async () => {
    const root = await mkFixture();
    await writeFile(root, 'a.ts', 'alpha one\n');
    await fsp.symlink(path.join(root, 'a.ts'), path.join(root, 'link.ts'));
    const nav = new RepositoryNavigation(root);
    const st = await nav.refresh();
    expect(st.exclusions.symlinks).toBeGreaterThanOrEqual(1);
  });

  it('rejects root symlink', async () => {
    const target = await mkFixture();
    await writeFile(target, 'a.ts', 'alpha\n');
    const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'repo-nav-parent-'));
    owned.push(parent);
    const linkPath = path.join(parent, 'root-link');
    await fsp.symlink(target, linkPath, 'dir');
    const nav = new RepositoryNavigation(linkPath);
    await expect(nav.refresh()).rejects.toThrow();
  });

  it('handles Unicode line bytes correctly', async () => {
    const root = await mkFixture();
    await writeFile(root, 'a.ts', 'héllo wörld café\n');
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const res = await nav.search({ term: 'hello' });
    // "héllo" is not ASCII identifier; tokenizer finds "h", "llo" split? Actually
    // regex [a-zA-Z_] starts at ASCII; "héllo" -> "h" then "llo". So search "llo".
    const res2 = await nav.search({ term: 'llo' });
    expect(res2.results.length).toBe(1);
    expect(res2.results[0].text).toBe('héllo wörld café');
  });

  it('whole JSON utf8 length equals bytesUsed and fits maxBytes on every page (Unicode)', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      lines.push(`common café ${i} 日本語 🎉`);
    }
    await writeFile(root, 'u.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const maxBytes = 2048;
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 500; page++) {
      const res = await nav.search({
        term: 'common',
        maxBytes,
        maxResults: 3,
        maxVisited: 50,
        cursor,
      });
      const serialized = JSON.stringify(res);
      const utf8Len = Buffer.byteLength(serialized, 'utf8');
      expect(utf8Len).toBe(res.bytesUsed);
      expect(utf8Len).toBeLessThanOrEqual(maxBytes);
      for (const r of res.results) {
        const key = `${r.path}:${r.line}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (res.complete) break;
      cursor = res.nextCursor;
      expect(cursor).toBeTruthy();
    }
    expect(seen.size).toBe(300);
  });

  it('paginates with maxVisited=1 without missing or duplicate matches', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 25; i++) lines.push(`shared ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 500; page++) {
      const res = await nav.search({
        term: 'shared',
        maxResults: 100,
        maxVisited: 1,
        maxBytes: 4096,
        cursor,
      });
      for (const r of res.results) {
        const key = `${r.path}:${r.line}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (res.complete) break;
      expect(res.visited).toBeLessThanOrEqual(1);
      expect(res.stopReason).toBe('max-visited');
      expect(res.nextCursor).toBeTruthy();
      cursor = res.nextCursor;
    }
    expect(seen.size).toBe(25);
  });

  it('aborts pre-operation and mid-refresh', async () => {
    const root = await mkFixture();
    for (let i = 0; i < 100; i++) {
      await writeFile(root, `f${i}.ts`, `token${i} alpha\n`);
    }
    const nav = new RepositoryNavigation(root);
    const aborted = new AbortController();
    aborted.abort();
    await expect(nav.refresh(aborted.signal)).rejects.toThrow(/aborted/);
    const ctl = new AbortController();
    const p = nav.refresh(ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });

  it('cancelling refresh from setImmediate after start rejects and preserves previous generation', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 20000; i++) lines.push(`alpha shared ${i}`);
    await writeFile(root, 'big.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    const st1 = await nav.refresh();
    const gen1 = st1.generation;
    expect(gen1).toBeTruthy();
    const ctl = new AbortController();
    const p = nav.refresh(ctl.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    ctl.abort();
    await expect(p).rejects.toThrow(/aborted/);
    const st2 = nav.status();
    expect(st2.generation).toBe(gen1);
    const r = await nav.search({ term: 'alpha', maxResults: 1, maxBytes: 1024 });
    expect(r.results.length).toBe(1);
    expect(r.generation).toBe(gen1);
  });

  it('returns frozen outputs that do not mutate internal state', async () => {
    const root = await mkFixture();
    await writeFile(root, 'a.ts', 'alpha beta\n');
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const res = await nav.search({ term: 'alpha' });
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.results)).toBe(true);
    const rec = res.results[0] as { text: string };
    const original = rec.text;
    try {
      rec.text = 'hacked';
    } catch {
      /* frozen */
    }
    const res2 = await nav.search({ term: 'alpha' });
    expect(res2.results[0].text).toBe(original);
  });

  it('enforces maxLocations quota', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`token${i} shared`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root, { maxLocations: 10 });
    await expect(nav.refresh()).rejects.toThrow(/maxLocations/);
  });

  it('enforces maxPostings quota', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`k${i} shared here`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root, { maxPostings: 5 });
    await expect(nav.refresh()).rejects.toThrow(/maxPostings/);
  });

  it('enforces maxFileBytes quota', async () => {
    const root = await mkFixture();
    await writeFile(root, 'a.ts', 'x'.repeat(5000) + '\n');
    const nav = new RepositoryNavigation(root, { maxFileBytes: 1024 });
    await expect(nav.refresh()).rejects.toThrow(/maxFileBytes/);
  });

  it('enforces maxBytes total quota', async () => {
    const root = await mkFixture();
    for (let i = 0; i < 5; i++) {
      await writeFile(root, `f${i}.ts`, 'y'.repeat(2000) + '\n');
    }
    const nav = new RepositoryNavigation(root, { maxBytes: 4000 });
    await expect(nav.refresh()).rejects.toThrow(/maxBytes/);
  });

  it('does not create disk index files', async () => {
    const root = await mkFixture();
    await writeFile(root, 'a.ts', 'alpha beta\n');
    const before = (await fsp.readdir(root)).slice().sort();
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    await nav.search({ term: 'alpha' });
    const after = (await fsp.readdir(root)).slice().sort();
    expect(after).toEqual(before);
  });

  it('computes SHA256 over raw UTF-8 bytes matching node crypto (with BOM)', async () => {
    const root = await mkFixture();
    const raw = '\uFEFFalpha shared beta\n';
    const buf = Buffer.from(raw, 'utf8');
    await writeFileBuffer(root, 'a.ts', buf);
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const res = await nav.search({ term: 'shared' });
    expect(res.results.length).toBe(1);
    const expected = createHash('sha256').update(buf).digest('hex');
    expect(res.results[0].sha256).toBe(expected);
  });

  it('failed refresh on invalid UTF-8 preserves previous generation and cursors', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) lines.push(`alpha shared ${i}`);
    await writeFile(root, 'good.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    const st1 = await nav.refresh();
    const gen1 = st1.generation;
    expect(gen1).toBeTruthy();
    const r = await nav.search({ term: 'shared', maxResults: 2 });
    const cursor = r.nextCursor!;
    const bad = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x81, 0x82]);
    await writeFileBuffer(root, 'bad.ts', bad);
    await expect(nav.refresh()).rejects.toThrow();
    const st2 = nav.status();
    expect(st2.generation).toBe(gen1);
    const r2 = await nav.search({ term: 'shared', cursor });
    expect(r2.results.length).toBeGreaterThan(0);
    expect(r2.generation).toBe(gen1);
  });

  it('expires cursors after TTL > 5 minutes using Date.now spy with restore', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(`shared line ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const base = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const r = await nav.search({ term: 'shared', maxResults: 2 });
      const cursor = r.nextCursor!;
      // still valid immediately
      const ok = await nav.search({ term: 'shared', maxResults: 2, cursor });
      expect(ok.results.length).toBeGreaterThan(0);
      spy.mockReturnValue(base + 5 * 60 * 1000 + 1);
      await expect(
        nav.search({ term: 'shared', cursor: ok.nextCursor! }),
      ).rejects.toThrow(/unknown or expired/);
    } finally {
      spy.mockRestore();
    }
  });

  it('independent instances cannot reuse cursors', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(`shared line ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav1 = new RepositoryNavigation(root);
    await nav1.refresh();
    const r = await nav1.search({ term: 'shared', maxResults: 2 });
    const cursor = r.nextCursor!;
    const nav2 = new RepositoryNavigation(root);
    await nav2.refresh();
    await expect(nav2.search({ term: 'shared', cursor })).rejects.toThrow();
  });

  it('paginates 10050 lines in 40-result pages yielding 252 unique pages of 10050 lines', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 10_050; i++) lines.push(`shared item${i}`);
    await writeFile(root, 'big.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let total = 0;
    while (true) {
      const r = await nav.search({
        term: 'shared',
        maxResults: 40,
        ...(cursor ? { cursor } : {}),
      });
      pages++;
      total += r.results.length;
      for (const hit of r.results) {
        const key = `${hit.path}:${hit.line}:${hit.text}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (r.complete) break;
      expect(typeof r.nextCursor).toBe('string');
      cursor = r.nextCursor;
    }
    expect(pages).toBe(252);
    expect(total).toBe(10_050);
    expect(seen.size).toBe(10_050);
  });

  it('successfully used cursor is consumed and replay is rejected', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`shared line ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const first = await nav.search({ term: 'shared', maxResults: 10 });
    const cursor = first.nextCursor!;
    expect(typeof cursor).toBe('string');
    const second = await nav.search({ term: 'shared', maxResults: 10, cursor });
    expect(second.results.length).toBeGreaterThan(0);
    await expect(
      nav.search({ term: 'shared', maxResults: 10, cursor }),
    ).rejects.toThrow(/already consumed|unknown or expired/);
  });

  it('concurrent Promise.allSettled with same cursor yields exactly 1 fulfilled and 1 rejected', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`shared line ${i}`);
    await writeFile(root, 'a.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const first = await nav.search({ term: 'shared', maxResults: 10 });
    const cursor = first.nextCursor!;
    const settled = await Promise.allSettled([
      nav.search({ term: 'shared', maxResults: 10, cursor }),
      nav.search({ term: 'shared', maxResults: 10, cursor }),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('caps at 128 active chains; 129th start rejected then advancing one keeps 128', async () => {
    const root = await mkFixture();
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) lines.push(`shared item${i}`);
    await writeFile(root, 'big.ts', lines.join('\n'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const cursors: string[] = [];
    for (let i = 0; i < 128; i++) {
      const r = await nav.search({ term: 'shared', maxResults: 1 });
      expect(typeof r.nextCursor).toBe('string');
      cursors.push(r.nextCursor!);
    }
    expect(nav.status().cursors).toBe(128);
    await expect(
      nav.search({ term: 'shared', maxResults: 1 }),
    ).rejects.toThrow(/capacity reached/);
    const advanced = await nav.search({
      term: 'shared',
      maxResults: 1,
      cursor: cursors[0],
    });
    expect(advanced.results.length).toBeGreaterThan(0);
    expect(nav.status().cursors).toBe(128);
  });

  it('budget failure does not consume cursor: 1024 rejected then 4096 succeeds; 1-result then continuation works', async () => {
    const root = await mkFixture();
    const longLine = 'x'.repeat(1500) + ' shared';
    const content = `shared short\n${longLine}\n`;
    await writeFile(root, 'a.ts', content);
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const first = await nav.search({
      term: 'shared',
      maxResults: 1,
      maxBytes: 4096,
    });
    expect(first.results.length).toBe(1);
    const cursor = first.nextCursor!;
    expect(typeof cursor).toBe('string');
    await expect(
      nav.search({ term: 'shared', cursor, maxBytes: 1024 }),
    ).rejects.toThrow(/maxBytes/);
    const cont = await nav.search({ term: 'shared', cursor, maxBytes: 4096 });
    expect(cont.results.length).toBeGreaterThan(0);
  });

  it('byte budget: one 500-char line fits 1024, two do not; cursor continues to second line', async () => {
    const root = await mkFixture();
    const l1 = 'a'.repeat(500) + ' shared';
    const l2 = 'b'.repeat(500) + ' shared';
    await writeFile(root, 'a.ts', `${l1}\n${l2}\n`);
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const page = await nav.search({
      term: 'shared',
      maxResults: 100,
      maxBytes: 1024,
    });
    expect(page.results.length).toBe(1);
    expect(page.visited).toBe(2);
    expect(page.stopReason).toBe('max-bytes');
    expect(typeof page.nextCursor).toBe('string');
    expect(page.bytesUsed).toBeLessThanOrEqual(1024);
    const next = await nav.search({
      term: 'shared',
      maxResults: 100,
      maxBytes: 1024,
      cursor: page.nextCursor!,
    });
    expect(next.results.length).toBe(1);
    expect(next.results[0]!.text).toContain('b'.repeat(500));
  });

});
