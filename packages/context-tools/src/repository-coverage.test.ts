import { describe, expect, it } from 'vitest'
import { analyseCoverage, coverageStatus, renderCoverage, type CoverageResult } from './repository-coverage.js'
import type { ExploreResult } from './repository-explore.js'

function explored(symbol: string, parts: Partial<Pick<ExploreResult, 'definitions' | 'references' | 'tests' | 'imports' | 'scanTruncated'>>): ExploreResult {
  return {
    trust: 'local-source-unsigned', generation: 'g1', revision: 'r'.repeat(64), freshness: 'current',
    policy: { freshness: 'current', digest: 'd' }, symbol, files: 0, matchedLines: 0, otherCaseLines: 0,
    scanTruncated: false, omitted: { definitions: 0, references: 0, tests: 0 }, lexicalFiles: 0,
    definitions: [], references: [], tests: [], imports: [], ...parts,
  }
}

const ref = (path: string, scope: string, line = 1) => ({ path, line, text: 'x', scope, resolved: scope !== '' })

describe('coverageStatus', () => {
  it('matches whole repository-relative paths only', () => {
    expect(coverageStatus('see src/a.ts.', 'src/a.ts')).toBe('cited')
    expect(coverageStatus('"path": "src/a.ts"', 'src/a.ts')).toBe('cited')
    expect(coverageStatus('./src/a.ts:12', 'src/a.ts')).toBe('cited')
    expect(coverageStatus('/src/a.ts', 'src/a.ts')).toBe('cited')
    expect(coverageStatus('lib/src/a.ts', 'src/a.ts')).toBe('missing')
    expect(coverageStatus('src/a.tsx', 'src/a.ts')).toBe('missing')
    expect(coverageStatus('xsrc/a.ts', 'src/a.ts')).toBe('missing')
    expect(coverageStatus('the a.ts helper', 'src/a.ts')).toBe('named')
    expect(coverageStatus('nothing here', 'src/a.ts')).toBe('missing')
    expect(coverageStatus('a.ts', 'a.ts')).toBe('cited')
  })
})

describe('analyseCoverage', () => {
  it('merges roles across symbols, orders missing first and keeps scopes', () => {
    const analysis = analyseCoverage('The contract is in src/log-redact.ts; forwarder.mjs calls it at startup.', [
      explored('shortId', {
        definitions: [{ path: 'src/log-redact.ts', sha256: 's', kind: 'function', name: 'shortId', exported: true, startLine: 1, endLine: 3, lines: [] }],
        references: [ref('server/forwarder.mjs', 'in start', 4), ref('server/forwarder.mjs', 'in start', 5)],
        tests: [ref('test/log-redaction-scan.test.ts', "in it('rejects full ids')"), ref('src/log-redact.test.ts', "in it('never returns more')")],
        imports: ['server/forwarder.mjs'],
      }),
      explored('redact', { references: [ref('src/log-redact.ts', 'top level')] }),
    ])
    expect(analysis.counts).toEqual({ missing: 2, named: 1, cited: 1 })
    expect(analysis.files.map((file) => [file.status, file.role, file.path])).toEqual([
      ['missing', 'test', 'src/log-redact.test.ts'],
      ['missing', 'test', 'test/log-redaction-scan.test.ts'],
      ['named', 'reference', 'server/forwarder.mjs'],
      ['cited', 'definition', 'src/log-redact.ts'],
    ])
    const forwarder = analysis.files.find((file) => file.path === 'server/forwarder.mjs')
    expect(forwarder).toMatchObject({ scopes: ['in start'], symbols: ['shortId'] })
    expect(analysis.files.find((file) => file.path === 'src/log-redact.ts')).toMatchObject({ symbols: ['redact', 'shortId'], scopes: ['defines shortId'] })
  })

  it('bounds scopes and reports truncated scans in the rendering', () => {
    const tests = Array.from({ length: 9 }, (_, i) => ref('t.test.ts', `in it('case ${i}')`, i + 1))
    const analysis = analyseCoverage('', [explored('big', { tests, scanTruncated: true })])
    expect(analysis.files[0]).toMatchObject({ scopes: tests.slice(0, 6).map((row) => row.scope), omittedScopes: 3 })
    const result: CoverageResult = { trust: 'local-source-unsigned', generation: 'g1', revision: 'r'.repeat(64), freshness: 'current', ...analysis }
    const text = renderCoverage(result)
    expect(text.split('\n')[0]).toBe('coverage big  1 files: 1 missing, 0 named, 0 cited  (scan truncated for big)  generation g1  revision rrrrrrrrrrrrrrrr  freshness current')
    expect(text).toContain("missing test t.test.ts  [big]  in it('case 0');")
    expect(text).toContain('; +3 more')
    expect(text).not.toContain('cited:')
  })

  it('omits the next hint when everything is cited', () => {
    const analysis = analyseCoverage('a.ts', [explored('x', { references: [ref('a.ts', 'top level')] })])
    const text = renderCoverage({ trust: 'local-source-unsigned', generation: 'g', revision: 'r', freshness: 'current', ...analysis })
    expect(text).toContain('cited: a.ts')
    expect(text).not.toContain('next:')
    expect(analysis.files[0].scopes).toEqual(['top level'])
  })
})
