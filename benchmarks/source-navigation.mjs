import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { graphView } from '../packages/context/dist/graph.js'
import { scanSourceGraph } from '../packages/context-tools/dist/source-scan.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const scanRoot = resolve(root, 'packages')
const parityTarget = 71.5
const now = 1_800_000_000
const questions = [
  { id: 'retrieval', query: 'retrieveView bounded signed evidence records', required: ['context/src/retrieval.ts'] },
  { id: 'graph-view', query: 'graphView bounded relationship nodes', required: ['context/src/graph.ts'] },
  { id: 'blossom-upload', query: 'uploadEnvelope encrypted Blossom attachment', required: ['context/src/blossom.ts'] },
  { id: 'package-scan', query: 'scanPackageEcosystem workspace package manifests', required: ['context-tools/src/repository-scan.ts'] },
  { id: 'source-scan', query: 'scanSourceGraph TypeScript JavaScript syntax evidence', required: ['context-tools/src/source-scan.ts'] },
  { id: 'ecosystem-scan', query: 'scanEcosystem', required: ['context-tools/src/ecosystem-scan.ts'] },
  { id: 'mcp-server', query: 'serveContextMcp registered context tools', required: ['context-tools/src/context-mcp.ts'] },
]

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  }))
  return nested.flat()
}
function tokens(value) { return encode(typeof value === 'string' ? value : JSON.stringify(value)).length }
function percentile(values, fraction) { return values[Math.floor((values.length - 1) * fraction)] }

const ignoredDirectories = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', 'out'])
const sourceFiles = (await filesBelow(scanRoot)).filter(path => {
  const parts = relative(scanRoot, path).split('/')
  return /\.(?:[cm]?[jt]sx?)$/u.test(path) && !parts.some(part => part.startsWith('.') || ignoredDirectories.has(part))
}).sort()
const baselinePayload = await Promise.all(sourceFiles.map(async path => ({
  source: relative(scanRoot, path), text: await readFile(path, 'utf8'),
})))
const baselineTokens = tokens(baselinePayload)
const scan = await scanSourceGraph(scanRoot, { maxFiles: 64, maxDepth: 8, maxBytes: 8 * 1024 * 1024,
  maxFileBytes: 1024 * 1024, maxRecords: 128, observedAt: now })
const expectedFiles = new Set(sourceFiles.map(path => relative(scanRoot, path)))
const scannedFiles = new Set(scan.records.filter(record => !record.source.includes('#'))
  .map(record => record.source.slice('repo://'.length)))
const missingFiles = [...expectedFiles].filter(path => !scannedFiles.has(path))
if (missingFiles.length) throw new Error(`Source graph omitted scanned file records: ${missingFiles.join(', ')}`)

const records = scan.records.map(record => ({ ...record, author: '1d'.repeat(32),
  event: createHash('sha256').update(`event\0${JSON.stringify(record)}`).digest('hex') }))
const view = { id: '2e'.repeat(32), owner: '1d'.repeat(32), title: 'Context source-navigation benchmark',
  scope: 'personal', epoch: 1, head: '3f'.repeat(32), revision: 1, updatedAt: now,
  role: 'write', uploaded: false, records }
const results = questions.map(question => {
  const payload = graphView(view, { query: question.query, maxBytes: 4096, maxNodes: 1, maxDepth: 0 })
  const retrievedTokens = tokens(payload)
  const returned = [...new Set(payload.nodes.map(node => node.source.slice('repo://'.length).split('#')[0]))]
  const found = question.required.filter(source => returned.includes(source))
  return { id: question.id, query: question.query, requiredSources: question.required,
    returnedSources: returned, baselineTokens, retrievedTokens,
    multiplier: baselineTokens / retrievedTokens,
    reductionPercent: (1 - retrievedTokens / baselineTokens) * 100,
    evidenceRecall: found.length / question.required.length, bytesUsed: payload.bytesUsed,
    availableNodes: payload.availableNodes, omitted: payload.omitted }
})
const ratios = results.map(result => result.multiplier).sort((a, b) => a - b)
const totalBaselineTokens = baselineTokens * results.length
const totalRetrievedTokens = results.reduce((sum, result) => sum + result.retrievedTokens, 0)
const aggregateMultiplier = totalBaselineTokens / totalRetrievedTokens
const report = {
  benchmark: 'forgesworn-context-source-navigation-v1', contract: 'navigation-only-not-answer-evidence',
  tokenizer: 'o200k_base', corpus: { files: sourceFiles.length, baselineTokens,
    graphRecords: records.length, graphFiles: scannedFiles.size, droppedGraphRecords: scan.symbolsFound + scan.filesScanned - records.length },
  queries: results.map(result => ({ ...result, multiplier: Number(result.multiplier.toFixed(2)),
    reductionPercent: Number(result.reductionPercent.toFixed(2)) })),
  aggregate: { totalBaselineTokens, totalRetrievedTokens,
    multiplier: Number(aggregateMultiplier.toFixed(2)), minimumMultiplier: Number(ratios[0].toFixed(2)),
    medianMultiplier: Number(percentile(ratios, 0.5).toFixed(2)),
    reductionPercent: Number(((1 - totalRetrievedTokens / totalBaselineTokens) * 100).toFixed(2)),
    minimumEvidenceRecall: Math.min(...results.map(result => result.evidenceRecall)) },
  gates: { graphifyPublishedTargetMultiplier: parityTarget },
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

if (process.argv.includes('--check')) {
  const failures = []
  for (const result of results) if (result.evidenceRecall !== 1) failures.push(`${result.id} evidence recall was ${result.evidenceRecall}`)
  if (aggregateMultiplier < parityTarget) failures.push(`aggregate navigation reduction ${aggregateMultiplier.toFixed(2)}x was below ${parityTarget}x`)
  if (ratios[0] < parityTarget) failures.push(`minimum navigation reduction ${ratios[0].toFixed(2)}x was below ${parityTarget}x`)
  if (failures.length) throw new Error(`Source-navigation benchmark failed: ${failures.join('; ')}`)
}
