// Ground-truth probe for the diagnosis-context rubric. Copy into packages/context-tools/src of a prepared
// diagnosis-context workspace and run with vitest: the status test fails on the seeded tree and passes once
// setup/diagnosis-context.patch is reverted; the search test passes on both.
import { describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RepositoryNavigation } from './repository-navigation.js';

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'probe-'));
  await fsp.writeFile(path.join(root, 'secret.ts'), 'shared one\nshared two\n');
  return root;
}
function tightenOnOpen(root: string, source: string) {
  const originalOpen = fsp.open.bind(fsp);
  let tightened = false;
  vi.spyOn(fsp, 'open').mockImplementation(async (file: any, flags: any) => {
    const handle = await originalOpen(file, flags);
    if (!tightened && String(file) === source) { tightened = true; await fsp.writeFile(path.join(root, '.gitignore'), 'secret.ts\n'); }
    return handle;
  });
}
describe('probe', () => {
  it('status reports policy change made during freshness source reads', async () => {
    const root = await fixture();
    const source = await fsp.realpath(path.join(root, 'secret.ts'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    tightenOnOpen(root, source);
    const status = await nav.status();
    vi.restoreAllMocks();
    expect(status.policy.freshness).not.toBe('current');
  });
  it('search blocks at the start check, before traversal', async () => {
    const root = await fixture();
    const source = await fsp.realpath(path.join(root, 'secret.ts'));
    const nav = new RepositoryNavigation(root);
    await nav.refresh();
    const first = await nav.search({ term: 'shared', maxResults: 1 });
    tightenOnOpen(root, source);
    const err = await nav.search({ term: 'shared', cursor: first.nextCursor! }).catch((e) => e);
    const opens = (fsp.open as any).mock.calls.filter((c: any[]) => String(c[0]) === source).length;
    vi.restoreAllMocks();
    expect(String(err)).toMatch(/policy is stale/);
    expect(opens).toBe(1);
  });
});
