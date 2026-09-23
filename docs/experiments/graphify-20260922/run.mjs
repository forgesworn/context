#!/usr/bin/env node
// Three-way retrieval comparison runner: plain tools, Graphify, Context.
// Usage: node run.mjs --local /private/local.json [--protocol DIR] [--task ID | --all] [--arms plain,graphify,context] [--skip-review]
// --protocol selects a directory holding protocol.json and context-instructions.txt (default: this directory).
// protocol.json may set "codeAcceptance": "checker-and-scope" to accept code tasks without the model reviewer,
// and "rubricDir" to review structured tasks against later rubrics (for example ../rubric-v2-20260923).
// local.json (private, machine-specific): { evidence, roots: { context, kithmoot }, node, contextCli, graphifyBin, graphifyAlwaysOn }
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkScope } from '../code-acceptance-20260923/scope.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const packDir = join(here, '..', 'd5-20260921')
const protocolFlag = process.argv.indexOf('--protocol')
const protocolDir = protocolFlag >= 0 && process.argv[protocolFlag + 1] ? resolve(process.argv[protocolFlag + 1]) : here
const protocol = JSON.parse(readFileSync(join(protocolDir, 'protocol.json'), 'utf8'))
const contextInstructions = readFileSync(join(protocolDir, 'context-instructions.txt'), 'utf8').trim()

function args() {
  const out = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '')
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[key] = argv[i + 1]; i += 1 } else out[key] = true
  }
  return out
}
const sha = (s) => createHash('sha256').update(s).digest('hex')
const now = () => new Date().toISOString()
const log = (evidence, line) => { const text = `${now()} ${line}\n`; process.stdout.write(text); appendFileSync(join(evidence, 'run.log'), text) }

function runSync(command, values, options = {}) {
  const started = Date.now()
  const r = spawnSync(command, values, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', seconds: (Date.now() - started) / 1000, error: r.error?.message }
}

function cleanEnv(extraPath) {
  const env = { ...process.env }
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_SUBAGENT_MODEL']) delete env[key]
  if (extraPath) env.PATH = `${extraPath}:${env.PATH}`
  return env
}

function loadTask(id) {
  const task = JSON.parse(readFileSync(join(packDir, 'tasks', `${id}.json`), 'utf8'))
  // protocol.rubricDir (optional, relative to the protocol directory) supplies later structured rubrics; the checker is unchanged.
  const override = protocol.rubricDir ? join(protocolDir, protocol.rubricDir, 'acceptance', `${id}.json`) : null
  const acceptance = JSON.parse(readFileSync(override && existsSync(override) ? override : join(packDir, 'acceptance', `${id}.json`), 'utf8'))
  return { task, acceptance }
}

function buildPrompt(task, arm) {
  const policy = JSON.stringify(task.selectionPolicy.include)
  const lines = [
    `You are working in the repository checkout at the current working directory, frozen at revision ${task.revision}. Task category: ${task.category}.`,
    '',
    `Retrieval: ${protocol.arms[arm].retrievalInstruction}`,
    '',
    task.prompt,
    '',
  ]
  if (task.answerSchema) {
    lines.push(
      'Output: write answer.json in the workspace root containing exactly {"summary": string, "findings": [{"id": string, "value": string}], "evidence": [{"path": string, "token": string}]}.',
      `findings must contain exactly these ids, one entry each: ${JSON.stringify(task.requiredFindingIds)}.`,
      'Each evidence path is repository-relative and each token must be an exact contiguous substring copied from that file, preserving whitespace. Cite implementation and focused tests. Do not edit any source file.',
      '',
    )
  } else {
    lines.push('Output: edit the source in place in this working directory. Do not commit. Do not write an answer file.', '')
  }
  lines.push(
    `Source discovery is confined to this selection policy (repository-relative prefixes): include = ${policy}.`,
    'Do not use network search, memory, sibling repositories or any acceptance or reference material. You may run the repository\'s compiler and tests. The trusted harness checks the final output after this session.',
  )
  return lines.join('\n')
}

function parseStream(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  const toolCalls = {}, toolResultBytes = {}, byId = {}, requests = []
  const seenMessages = new Set()
  let init = null, result = null, rateLimit = null
  for (const line of lines) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type === 'system' && event.subtype === 'init') init = { tools: event.tools, mcp_servers: event.mcp_servers, model: event.model, memory_paths: event.memory_paths, permissionMode: event.permissionMode, plugins: event.plugins }
    if (event.type === 'rate_limit_event') rateLimit = event.rate_limit_info ?? event
    if (event.type === 'assistant') {
      const message = event.message ?? {}
      for (const block of message.content ?? []) {
        if (block.type === 'tool_use') { toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1; byId[block.id] = block.name }
      }
      if (message.id && !seenMessages.has(message.id) && message.usage) {
        seenMessages.add(message.id)
        const u = message.usage
        requests.push({ input: u.input_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 })
      }
    }
    if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block.type === 'tool_result') {
          const name = byId[block.tool_use_id] ?? 'unknown'
          const size = typeof block.content === 'string' ? Buffer.byteLength(block.content) : Buffer.byteLength(JSON.stringify(block.content ?? ''))
          toolResultBytes[name] = (toolResultBytes[name] ?? 0) + size
        }
      }
    }
    if (event.type === 'result') result = event
  }
  const usage = result?.usage ?? null
  return {
    init,
    rateLimit,
    errors: result?.errors ?? null,
    subtype: result?.subtype ?? null,
    isError: result?.is_error ?? null,
    numTurns: result?.num_turns ?? null,
    durationMs: result?.duration_ms ?? null,
    durationApiMs: result?.duration_api_ms ?? null,
    totalCostUsd: result?.total_cost_usd ?? null,
    usage,
    inputTotal: usage ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) : null,
    inputUncached: usage ? (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : null,
    output: usage?.output_tokens ?? null,
    modelUsage: result?.modelUsage ?? null,
    requests: requests.length,
    toolCalls,
    toolCallsTotal: Object.values(toolCalls).reduce((a, b) => a + b, 0),
    toolResultBytes,
    resultText: typeof result?.result === 'string' ? result.result : null,
    structuredOutput: result?.structured_output ?? null,
  }
}

function claude(evidenceDir, name, { cwd, prompt, extraArgs, env, mcpConfig, appendSystem, model, effort, maxTurns, maxBudget, jsonSchema, disallowedTools, shellPath }) {
  const streamPath = join(evidenceDir, `${name}.stream.jsonl`)
  const errPath = join(evidenceDir, `${name}.stderr.txt`)
  // The client's Bash tool rebuilds PATH from the login profile; a settings env entry is the only way that survives.
  const settings = { ...protocol.executor.settingsOverride, env: { PATH: shellPath } }
  const argv = ['-p', '--model', model, '--effort', effort, '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions',
    '--strict-mcp-config', '--mcp-config', mcpConfig, '--disable-slash-commands', '--no-session-persistence',
    '--setting-sources', protocol.executor.settingSources, '--settings', JSON.stringify(settings),
    '--max-turns', String(maxTurns),
    '--disallowedTools', (disallowedTools ?? protocol.executor.disallowedTools).join(','), ...(extraArgs ?? [])]
  if (maxBudget) argv.push('--max-budget-usd', String(maxBudget))
  if (appendSystem) argv.push('--append-system-prompt', appendSystem)
  if (jsonSchema) argv.push('--json-schema', JSON.stringify(jsonSchema))
  writeFileSync(join(evidenceDir, `${name}.argv.json`), JSON.stringify({ argv, cwd, promptSha256: sha(prompt) }, null, 2))
  writeFileSync(join(evidenceDir, `${name}.prompt.txt`), prompt)
  const started = Date.now()
  return new Promise((resolveRun) => {
    const child = spawn('claude', argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [], err = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('close', (code) => {
      writeFileSync(streamPath, Buffer.concat(out))
      writeFileSync(errPath, Buffer.concat(err))
      resolveRun({ exitCode: code, seconds: (Date.now() - started) / 1000, streamPath, startedAt: new Date(started).toISOString() })
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

function excerpt(workspace, path, token, radius = 12) {
  const text = readFileSync(join(workspace, path), 'utf8')
  const index = text.indexOf(token)
  if (index < 0) return null
  const lines = text.split('\n')
  let line = text.slice(0, index).split('\n').length - 1
  const start = Math.max(0, line - radius), end = Math.min(lines.length, line + token.split('\n').length + radius)
  return { path, startLine: start + 1, endLine: end, text: lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n').slice(0, 3000) }
}

const reviewSchema = {
  type: 'object',
  properties: {
    accepted: { type: 'boolean' },
    dimensions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, pass: { type: 'boolean' }, note: { type: 'string' } }, required: ['id', 'pass', 'note'] } },
    materialIssues: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['accepted', 'dimensions', 'materialIssues', 'summary'],
}

function reviewerPrompt({ task, acceptance, workspace, answer, checker, diff }) {
  const lines = [
    'You are the independent acceptance reviewer for one coding-agent output. You see only this output, the task, the private rubric, the deterministic checker result and bounded excerpts of the frozen source. Judge correctness and completeness against the rubric. Do not reward length. A dimension passes only when the answer states the rubric\'s substance correctly; partial or contradictory statements fail. Accept only when every dimension passes and there is no material correctness, security or scope regression.',
    '',
    `Task (${task.category}, repository ${task.repository} at ${task.revision}):`,
    task.prompt,
    '',
  ]
  if (acceptance.kind === 'structured') {
    if (acceptance.reviewerRules) {
      lines.push('Review rules:')
      for (const rule of acceptance.reviewerRules) lines.push(`- ${rule}`)
      lines.push('')
    }
    lines.push('Private rubric (dimension id: expected substance):')
    for (const [id, text] of Object.entries(acceptance.reviewerRubric)) lines.push(`- ${id}: ${text}`)
    lines.push('', 'Reference evidence the rubric author expected (absence is not automatic failure if the claim is supported by other cited source):')
    for (const e of acceptance.requiredEvidence ?? []) lines.push(`- ${e.path}: ${JSON.stringify(e.token)}`)
    lines.push('', `Deterministic checker: ${checker.passed ? 'PASSED' : 'FAILED'}${checker.passed ? '' : `\n${checker.output.slice(0, 2000)}`}`, '')
    lines.push('Agent answer.json:', '```json', JSON.stringify(answer, null, 2).slice(0, 20000), '```', '')
    lines.push('Excerpts of the frozen source around each cited token (line-numbered):')
    let budget = 40000
    for (const e of answer?.evidence ?? []) {
      let ex = null
      try { ex = excerpt(workspace, e.path, e.token) } catch { ex = null }
      if (!ex) { lines.push(`- ${e.path}: token not found or file unreadable`); continue }
      const block = `--- ${ex.path} lines ${ex.startLine}-${ex.endLine} ---\n${ex.text}`
      if (budget - block.length < 0) { lines.push('[excerpt budget exhausted]'); break }
      budget -= block.length
      lines.push(block, '')
    }
  } else {
    lines.push(`Private rubric: ${acceptance.reviewerRubric}`, '', 'Required behaviour:')
    for (const b of acceptance.behaviour ?? []) lines.push(`- ${b}`)
    lines.push('', `Deterministic checker (build, focused tests and behaviour probes): ${checker.passed ? 'PASSED' : 'FAILED'}`, '```', checker.output.slice(0, 8000), '```', '')
    lines.push('Agent diff against the frozen tree:', '```diff', (diff ?? '').slice(0, 40000), '```', '')
    lines.push('Dimensions to report: one per required behaviour, using ids b1..bN in order, plus "scope" for no unrelated or weakening changes.')
  }
  lines.push('', 'Return JSON only, matching the provided schema.')
  return lines.join('\n')
}

async function runArm({ taskId, arm, orderIndex, local, evidence, skipReview }) {
  const { task, acceptance } = loadTask(taskId)
  const armDir = join(evidence, taskId, arm)
  const workspace = join(armDir, 'workspace')
  const receiptPath = join(armDir, 'receipt.json')
  if (existsSync(receiptPath)) { log(evidence, `${taskId}/${arm}: receipt exists, skipping`); return JSON.parse(readFileSync(receiptPath, 'utf8')) }
  mkdirSync(armDir, { recursive: true })
  const receipt = { experimentId: protocol.experimentId, task: taskId, category: task.category, repository: task.repository, revision: task.revision, arm, orderIndex, startedAt: now(), executor: protocol.executor, reviewer: protocol.reviewer }
  const write = () => writeFileSync(receiptPath + '.partial', JSON.stringify(receipt, null, 2))

  log(evidence, `${taskId}/${arm}: preparing workspace`)
  const prepare = runSync(local.node, [join(packDir, 'prepare-arm.mjs'), '--pair', taskId, '--arm', arm === 'context' ? 'assisted' : 'baseline', '--source-root', local.roots[task.repository], '--output', workspace])
  if (prepare.status !== 0) throw new Error(`prepare failed: ${prepare.stderr}`)
  receipt.prepared = JSON.parse(prepare.stdout)
  write()

  log(evidence, `${taskId}/${arm}: npm ci`)
  const npmCi = runSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: workspace, env: cleanEnv() })
  receipt.setup = { npmCiSeconds: npmCi.seconds, npmCiStatus: npmCi.status }
  if (npmCi.status !== 0) log(evidence, `${taskId}/${arm}: npm ci failed (${npmCi.stderr.slice(0, 300)})`)
  write()

  let mcpConfig = { mcpServers: {} }
  let appendSystem = protocol.arms.plain.systemPromptAppendix
  let extraPath = null
  const gitEnv = {}
  if (arm === 'graphify') {
    // Keep graphify-out/ out of Git's untracked view without touching any hashed file in the frozen tree.
    const excludes = join(armDir, 'git-excludes')
    writeFileSync(excludes, 'graphify-out/\n')
    Object.assign(gitEnv, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.excludesFile', GIT_CONFIG_VALUE_0: excludes })
    log(evidence, `${taskId}/${arm}: graphify update`)
    const build = runSync(join(local.graphifyBin, 'graphify'), ['update', workspace], { cwd: workspace, env: { ...cleanEnv(local.graphifyBin), ...gitEnv } })
    let graph = null
    try { const g = JSON.parse(readFileSync(join(workspace, 'graphify-out', 'graph.json'), 'utf8')); graph = { nodes: g.nodes?.length ?? null, edges: g.links?.length ?? g.edges?.length ?? null } } catch {}
    receipt.setup.graphify = { seconds: build.seconds, status: build.status, stdoutTail: build.stdout.slice(-600), graph }
    const instruction = readFileSync(local.graphifyAlwaysOn, 'utf8')
    if (sha(instruction) !== protocol.arms.graphify.instructionSha256) throw new Error('graphify instruction text hash mismatch')
    appendSystem = instruction.trim()
    extraPath = local.graphifyBin
  }
  if (arm === 'context') {
    mcpConfig = { mcpServers: { 'z1p-repository': { command: local.node, args: [local.contextCli, 'navigate', workspace] } } }
    appendSystem = contextInstructions
  }
  const mcpPath = join(armDir, 'mcp.json')
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2))
  receipt.systemPromptAppendixSha256 = sha(appendSystem)
  write()

  const prompt = buildPrompt(task, arm)
  receipt.promptSha256 = sha(prompt)
  const basePath = `${dirname(local.node)}:${process.env.PATH}`
  const shellPath = extraPath ? `${extraPath}:${basePath}` : basePath
  receipt.shellPathPrefix = extraPath ? [extraPath, dirname(local.node)] : [dirname(local.node)]
  log(evidence, `${taskId}/${arm}: executor session`)
  // protocol.executor.env (optional) routes the executor only, e.g. an Anthropic-compatible gateway; reviewers keep the default provider.
  const exec = await claude(armDir, 'executor', { cwd: workspace, prompt, env: { ...cleanEnv(extraPath), ...gitEnv, ...(protocol.executor.env ?? {}) }, mcpConfig: mcpPath, appendSystem, model: protocol.executor.model, effort: protocol.executor.effort, maxTurns: protocol.executor.maxTurns, maxBudget: protocol.executor.maxBudgetUsd, shellPath })
  const parsed = parseStream(exec.streamPath)
  receipt.executorRun = { ...exec, ...parsed }
  log(evidence, `${taskId}/${arm}: executor done exit=${exec.exitCode} subtype=${parsed.subtype} mode=${parsed.init?.permissionMode} mcp=${JSON.stringify(parsed.init?.mcp_servers)} turns=${parsed.numTurns} toolCalls=${parsed.toolCallsTotal} input=${parsed.inputTotal} output=${parsed.output} cost=${parsed.totalCostUsd} s=${exec.seconds.toFixed(1)}`)
  write()
  if (parsed.init && parsed.init.permissionMode !== 'bypassPermissions') throw new Error(`${taskId}/${arm}: permission mode was ${parsed.init.permissionMode}; tools would be denied, stopping`)
  if (arm === 'context' && !(parsed.init?.mcp_servers ?? []).some(s => s.name === 'z1p-repository' && s.status === 'connected')) throw new Error(`${taskId}/${arm}: z1p-repository MCP server not connected: ${JSON.stringify(parsed.init?.mcp_servers)}`)
  const stderrText = readFileSync(join(armDir, 'executor.stderr.txt'), 'utf8')
  const blocked = /rate.?limit|429|out_of_credits|usage limit|overloaded|authentication|401/i
  if (parsed.subtype === null || (parsed.isError && !['error_max_turns', 'error_max_budget_usd'].includes(parsed.subtype)) || blocked.test(stderrText) || (parsed.rateLimit?.status && parsed.rateLimit.status !== 'allowed')) {
    receipt.aborted = { reason: 'provider or client failure; no retry', subtype: parsed.subtype, errors: parsed.errors, rateLimit: parsed.rateLimit, stderrHead: stderrText.slice(0, 500) }
    receipt.finishedAt = now()
    writeFileSync(join(armDir, 'receipt.aborted.json'), JSON.stringify(receipt, null, 2))
    throw new Error(`${taskId}/${arm}: executor did not complete (${parsed.subtype ?? 'no result'}); stopping without retry`)
  }

  log(evidence, `${taskId}/${arm}: deterministic checker`)
  const answerPath = join(workspace, 'answer.json')
  const checkArgs = [join(packDir, 'accept.mjs'), '--pair', taskId, '--workspace', workspace]
  if (acceptance.kind === 'structured') checkArgs.push('--answer', answerPath)
  const check = runSync(local.node, checkArgs, { cwd: workspace, env: { ...cleanEnv(), ...gitEnv } })
  const checker = { passed: check.status === 0, output: `${check.stdout}\n${check.stderr}`.trim(), seconds: check.seconds }
  receipt.checker = checker
  let answer = null
  if (acceptance.kind === 'structured') { try { answer = JSON.parse(readFileSync(answerPath, 'utf8')) } catch { answer = null } }
  const diff = acceptance.kind === 'code' ? runSync('git', ['diff'], { cwd: workspace, env: { ...cleanEnv(), ...gitEnv } }).stdout : null
  if (diff !== null) writeFileSync(join(armDir, 'diff.patch'), diff)
  receipt.answerSha256 = answer ? sha(JSON.stringify(answer)) : null
  log(evidence, `${taskId}/${arm}: checker ${checker.passed ? 'passed' : 'failed'}`)
  write()

  // protocol.codeAcceptance 'checker-and-scope' (optional) accepts code tasks on the behaviour checker plus a
  // deterministic scope check, with no model reviewer; protocols without it keep the reviewer.
  const deterministicCode = acceptance.kind === 'code' && protocol.codeAcceptance === 'checker-and-scope'
  if (deterministicCode) {
    receipt.scope = checkScope({ workspace, include: task.selectionPolicy.include, env: { ...cleanEnv(), ...gitEnv } })
    log(evidence, `${taskId}/${arm}: scope ${receipt.scope.passed ? 'passed' : `failed (${receipt.scope.reasons.join('; ')})`}`)
  }
  if (!skipReview && !deterministicCode) {
    const rprompt = reviewerPrompt({ task, acceptance, workspace, answer, checker, diff })
    const attempts = []
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      log(evidence, `${taskId}/${arm}: reviewer session attempt ${attempt}`)
      const review = await claude(armDir, attempt === 1 ? 'reviewer' : `reviewer-attempt${attempt}`, { cwd: armDir, prompt: rprompt, env: cleanEnv(), mcpConfig: mcpPath.replace('mcp.json', 'mcp-empty.json'), model: protocol.reviewer.model, effort: protocol.reviewer.effort, maxTurns: protocol.reviewer.maxTurns, jsonSchema: reviewSchema, disallowedTools: [...protocol.executor.disallowedTools, ...protocol.reviewer.disallowedTools], shellPath: basePath })
      const rparsed = parseStream(review.streamPath)
      let verdict = rparsed.structuredOutput
      if (!verdict && rparsed.resultText) { try { verdict = JSON.parse(rparsed.resultText.replace(/^```json\s*|```\s*$/g, '')) } catch { verdict = null } }
      attempts.push({ ...review, ...rparsed, verdict })
      log(evidence, `${taskId}/${arm}: reviewer accepted=${verdict?.accepted ?? 'unparsed'} input=${rparsed.inputTotal} output=${rparsed.output} s=${review.seconds.toFixed(1)}`)
      if (verdict) break
    }
    const last = attempts[attempts.length - 1]
    receipt.reviewerRun = { ...last, attempts: attempts.length, seconds: attempts.reduce((a, r) => a + r.seconds, 0), inputTotal: attempts.reduce((a, r) => a + (r.inputTotal ?? 0), 0), output: attempts.reduce((a, r) => a + (r.output ?? 0), 0), allAttempts: attempts.map(r => ({ subtype: r.subtype, inputTotal: r.inputTotal, output: r.output, seconds: r.seconds, parsed: Boolean(r.verdict) })) }
  }
  receipt.acceptanceRule = deterministicCode ? 'checker-and-scope' : 'checker-and-reviewer'
  receipt.accepted = deterministicCode ? checker.passed && receipt.scope.passed : checker.passed && receipt.reviewerRun?.verdict?.accepted === true && (receipt.reviewerRun?.verdict?.materialIssues?.length ?? 1) === 0
  receipt.armSeconds = (receipt.setup.graphify?.seconds ?? 0) + exec.seconds + checker.seconds + (receipt.reviewerRun?.seconds ?? 0)
  receipt.finishedAt = now()
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2))
  return receipt
}

const a = args()
if (!a.local) throw new Error('usage: --local /private/local.json (--task ID | --all) [--arms a,b,c] [--skip-review]')
const local = JSON.parse(readFileSync(resolve(a.local), 'utf8'))
const evidence = resolve(local.evidence)
mkdirSync(evidence, { recursive: true })
writeFileSync(join(evidence, 'mcp-empty.json'), '{"mcpServers":{}}')
const tasks = a.all ? protocol.tasks : [a.task]
if (!tasks[0]) throw new Error('missing --task or --all')
for (const taskId of tasks) {
  const index = protocol.tasks.indexOf(taskId)
  if (index < 0) throw new Error(`unknown task ${taskId}`)
  const order = a.arms ? a.arms.split(',') : protocol.armOrders[index % protocol.armOrders.length]
  for (let i = 0; i < order.length; i += 1) {
    const armDir = join(evidence, taskId, order[i])
    mkdirSync(armDir, { recursive: true })
    writeFileSync(join(armDir, 'mcp-empty.json'), '{"mcpServers":{}}')
    await runArm({ taskId, arm: order[i], orderIndex: a['order-index'] ? Number(a['order-index']) : i + 1, local, evidence, skipReview: Boolean(a['skip-review']) })
  }
}
log(evidence, 'done')
