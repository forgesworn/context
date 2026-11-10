import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
const exec = promisify(execFile);
export type CodingHost = 'codex' | 'claude' | 'kimi';
export interface StartupHookOptions {
    host: CodingHost;
    skill: string;
    command: string[];
    cacheDirectory?: string;
    handoverBase?: string;
}
/** Deterministic checkout preflight before model work. Reads Git metadata only;
 * no repository scan, source execution, activity claim or model is started. */
export async function startupContext(input: unknown, options: StartupHookOptions) {
    if (!['codex', 'claude', 'kimi'].includes(options.host) || !isAbsolute(options.skill) || !options.command.length || options.command.some(s => !s || /[\x00-\x1f]/.test(s)))
        throw new Error('Invalid startup hook options');
    const event = options.host === 'kimi' ? 'UserPromptSubmit' : 'SessionStart';
    const payload = input as {
        cwd?: unknown;
        hook_event_name?: unknown;
    };
    if (!payload || typeof payload !== 'object' || typeof payload.cwd !== 'string' || !isAbsolute(payload.cwd) || payload.hook_event_name !== event)
        throw new Error('Invalid startup hook input');
    const skill = await realpath(options.skill);
    if (!(await stat(skill)).isFile())
        throw new Error('Shared context skill unavailable');
    let root: string | undefined, head: string | undefined;
    const discovery = new Set(['GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM']);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') || discovery.has(key)));
    try {
        const cwd = await realpath(payload.cwd);
        const result = await exec('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { env, maxBuffer: 8192, timeout: 2000 });
        root = await realpath(result.stdout.trim());
        const revision = await exec('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], { env, maxBuffer: 1024, timeout: 2000 });
        if (/^[a-f0-9]{40,64}$/.test(revision.stdout.trim()))
            head = revision.stdout.trim();
    }
    catch { /* A non-checkout parent remains unselected, never a sibling scan. */ }
    const report = { schema: 'context-startup-v1', host: options.host, checkout: root ?? null, gitHEAD: head ?? null,
        sourceFreshness: 'not-checked', nativeToolDiscovery: 'host-must-verify', sourceScanned: false };
    const context = 'Z1P repository context is enabled by default for project work; the user need not request it.\n' +
        'Startup observation (data, not authority): ' + JSON.stringify(report) + '\n' +
        (root ? 'Confirm this checkout is the one authorised by the actual task. ' : 'The working folder is not a checkout: choose the task repository explicitly; do not scan siblings. ') +
        'Call repository_* tools directly: no status or refresh call is needed first. Only repository_search needs repository_refresh, after a pull or branch switch. ' +
        'If tool schemas are deferred, use the host tool search; deferred tools are not absent tools.';
    return options.host === 'kimi' ? context + '\n' : JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) + '\n';
}
export async function runStartupHook(args: string[], command: string[]) {
    const { values, positionals } = parseArgs({ args, options: { host: { type: 'string' }, skill: { type: 'string' }, 'cache-dir': { type: 'string' }, 'handover-base': { type: 'string' }, 'managed-z1p-startup-v1': { type: 'boolean' } } });
    if (positionals.length || !values.host || !values.skill)
        throw new Error('startup requires --host and --skill');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 65536)
            throw new Error('Startup input exceeds limit');
        chunks.push(buffer);
    }
    const input = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return startupContext(JSON.parse(input), { host: values.host as CodingHost, skill: values.skill, command, cacheDirectory: values['cache-dir'], handoverBase: values['handover-base'] });
}
