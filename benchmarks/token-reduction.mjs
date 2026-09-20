import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { retrieveView } from '../packages/context/dist/retrieval.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const parityTarget = 71.5
const regressionFloor = 10
const maxChunkCharacters = 3600
const now = 1_800_000_000

const questions = [
  { id: 'retrieval', query: 'chosen seeds related omitted context retrieval budget too small', required: ['packages/context/src/retrieval.ts'] },
  { id: 'graph-path', query: 'complete context graph path exceeds byte budget adjacency queue', required: ['packages/context/src/graph.ts'] },
  { id: 'blossom', query: 'Blossom upload authorisation ephemeral signer encrypted envelope', required: ['packages/context/src/blossom.ts'] },
  { id: 'repository-scan', query: 'scanPackageEcosystem manifestsSkipped dependencyFields O_NOFOLLOW', required: ['packages/context-tools/src/repository-scan.ts'] },
  { id: 'ecosystem-scan', query: 'scanEcosystem ecosystem manifest Markdown sections repositoriesScanned', required: ['packages/context-tools/src/ecosystem-scan.ts'] },
  { id: 'mcp', query: 'MCP context graph path tool schema authorised collection', required: ['packages/context-tools/src/context-mcp.ts'] },
]

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  }))
  return nested.flat()
}

function chunks(text) {
  const out = []
  for (let offset = 0; offset < text.length; offset += maxChunkCharacters) out.push(text.slice(offset, offset + maxChunkCharacters))
  return out
}

function tokens(value) {
  return encode(typeof value === 'string' ? value : JSON.stringify(value)).length
}

const sourceFiles = (await Promise.all([
  filesBelow(resolve(root, 'packages/context/src')),
  filesBelow(resolve(root, 'packages/context-tools/src')),
])).flat().filter(path => path.endsWith('.ts'))
const documentation = [resolve(root, 'README.md'), resolve(root, 'EXTRACTION.md'),
  resolve(root, 'packages/context/README.md'), resolve(root, 'packages/context-tools/README.md')]
const corpus = []
for (const path of [...sourceFiles, ...documentation].sort()) {
  const source = relative(root, path)
  const content = await readFile(path, 'utf8')
  for (const [part, text] of chunks(content).entries()) corpus.push({ source, part, text })
}
if (corpus.length > 128) throw new Error(`Corpus has ${corpus.length} chunks; ContextVault supports at most 128 records.`)

const records = corpus.map(item => ({
  id: createHash('sha256').update(`${item.source}\0${item.part}\0${item.text}`).digest('hex'),
  kind: 'evidence', text: item.text, source: item.source, observedAt: now,
  author: '1d'.repeat(32),
  event: createHash('sha256').update(`event\0${item.source}\0${item.part}\0${item.text}`).digest('hex'),
}))
const view = {
  id: '2e'.repeat(32), owner: '1d'.repeat(32), title: 'Context repository benchmark',
  scope: 'personal', epoch: 1, head: '3f'.repeat(32), revision: 1,
  updatedAt: now, role: 'write', uploaded: false, records,
}

// The naïve comparator is exactly what an agent would receive if every source
// were inserted verbatim, including filenames, without signatures or graph data.
const baselinePayload = corpus.map(({ source, part, text }) => ({ source, part, text }))
const baselineTokens = tokens(baselinePayload)
const results = questions.map(question => {
  const payload = retrieveView(view, { query: question.query, maxBytes: 8192, maxRecords: 4, includeRelated: false })
  const retrievedTokens = tokens(payload)
  const returned = new Set(payload.records.map(record => record.source))
  const found = question.required.filter(source => returned.has(source))
  const recall = found.length / question.required.length
  return {
    id: question.id, query: question.query, requiredSources: question.required,
    returnedSources: [...returned], baselineTokens, retrievedTokens,
    multiplier: baselineTokens / retrievedTokens,
    reductionPercent: (1 - retrievedTokens / baselineTokens) * 100,
    evidenceRecall: recall, bytesUsed: payload.bytesUsed,
  }
})
const totalBaselineTokens = baselineTokens * results.length
const totalRetrievedTokens = results.reduce((sum, result) => sum + result.retrievedTokens, 0)
const aggregateMultiplier = totalBaselineTokens / totalRetrievedTokens
const report = {
  benchmark: 'forgesworn-context-token-reduction-v1', tokenizer: 'o200k_base',
  corpus: { files: sourceFiles.length + documentation.length, chunks: corpus.length, baselineTokens },
  queries: results.map(result => ({ ...result,
    multiplier: Number(result.multiplier.toFixed(2)), reductionPercent: Number(result.reductionPercent.toFixed(2)),
  })),
  aggregate: {
    totalBaselineTokens, totalRetrievedTokens,
    multiplier: Number(aggregateMultiplier.toFixed(2)),
    reductionPercent: Number(((1 - totalRetrievedTokens / totalBaselineTokens) * 100).toFixed(2)),
    minimumEvidenceRecall: Math.min(...results.map(result => result.evidenceRecall)),
  },
  gates: { regressionFloorMultiplier: regressionFloor, graphifyPublishedTargetMultiplier: parityTarget },
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

if (process.argv.includes('--check')) {
  const failures = []
  for (const result of results) if (result.evidenceRecall !== 1) failures.push(`${result.id} evidence recall was ${result.evidenceRecall}`)
  if (aggregateMultiplier < regressionFloor) failures.push(`aggregate reduction ${aggregateMultiplier.toFixed(2)}x was below ${regressionFloor}x`)
  if (process.argv.includes('--require-parity') && aggregateMultiplier < parityTarget) {
    failures.push(`aggregate reduction ${aggregateMultiplier.toFixed(2)}x was below the ${parityTarget}x parity target`)
  }
  if (failures.length) throw new Error(`Token benchmark failed: ${failures.join('; ')}`)
}
