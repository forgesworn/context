import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import ts from 'typescript';
import { parse as parseToml } from 'smol-toml';
import type { CodingHost } from './startup-hook.js';
const MARKER = '--managed-z1p-startup-v1', START = '# z1p-startup:start', END = '# z1p-startup:end';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
async function read(path: string) {
    const entry = await lstat(path).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT')
        return undefined; throw e; });
    if (!entry)
        return undefined;
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > 131072)
        throw new Error('Hook configuration must be one bounded regular file without links');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await handle.stat(), buffer = Buffer.alloc(131073), r = await handle.read(buffer, 0, buffer.length, 0), after = await handle.stat();
        if (before.ino !== entry.ino || before.dev !== entry.dev || r.bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
            throw new Error('Hook configuration changed while reading');
        return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, r.bytesRead)), mode: before.mode & 0o777, ino: before.ino, dev: before.dev };
    }
    finally {
        await handle.close();
    }
}
function editJson(text: string, host: CodingHost, command: string, remove: boolean) {
    const original = text || '{}', data = JSON.parse(original);
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Hook config must be an object');
    const source = ts.parseJsonText('hooks.json', original);
    const root = (source.statements[0] as ts.ExpressionStatement)?.expression;
    if (!root || !ts.isObjectLiteralExpression(root) || (source as any).parseDiagnostics.length)
        throw new Error('Invalid hook JSON');
    let visited = 0;
    const validate = (node: ts.Node): void => {
        if (++visited > 50000)
            throw new Error('Hook JSON exceeds structural limit');
        if (ts.isObjectLiteralExpression(node)) {
            const names = new Set<string>();
            for (const prop of node.properties) {
                const name = prop.name ? JSON.parse(prop.name.getText(source)) : undefined;
                if (name && names.has(name))
                    throw new Error('Duplicate hook JSON keys');
                if (name)
                    names.add(name);
            }
        }
        ts.forEachChild(node, validate);
    };
    validate(root);
    const property = (node: ts.ObjectLiteralExpression, name: string) => node.properties.find(p => ts.isPropertyAssignment(p) && JSON.parse(p.name.getText(source)) === name) as ts.PropertyAssignment | undefined;
    const insert = (node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, value: string) => {
        const entries = ts.isObjectLiteralExpression(node) ? node.properties : node.elements;
        return original.slice(0, node.end - 1) + (entries.length ? ',' : '') + value + original.slice(node.end - 1);
    };
    const replace = (node: ts.Node, value: string) => original.slice(0, node.getStart(source)) + value + original.slice(node.end);
    const removeAt = (array: ts.ArrayLiteralExpression, index: number) => {
        const entries = array.elements, from = index < entries.length - 1 ? entries[index].getStart(source) : index ? entries[index - 1].end : entries[index].getStart(source);
        const to = index < entries.length - 1 ? entries[index + 1].getStart(source) : entries[index].end;
        return original.slice(0, from) + original.slice(to);
    };
    const event = 'SessionStart';
    const handler = { type: 'command', command, timeout: 15 };
    const group = { hooks: [handler] };
    const hp = property(root, 'hooks');
    if (!hp)
        return remove ? text : insert(root, JSON.stringify('hooks') + ':' + JSON.stringify({ [event]: [group] }));
    if (!ts.isObjectLiteralExpression(hp.initializer))
        throw new Error('Expected hooks object');
    const ep = property(hp.initializer, event);
    if (!ep)
        return remove ? text : insert(hp.initializer, JSON.stringify(event) + ':' + JSON.stringify([group]));
    if (!ts.isArrayLiteralExpression(ep.initializer))
        throw new Error('Expected SessionStart hook array');
    const matches: {
        group: ts.ObjectLiteralExpression;
        array: ts.ArrayLiteralExpression;
        handler: ts.Node;
        groupIndex: number;
        index: number;
    }[] = [];
    ep.initializer.elements.forEach((node, groupIndex) => {
        if (!ts.isObjectLiteralExpression(node))
            throw new Error('Invalid hook matcher group');
        const hooks = property(node, 'hooks');
        if (!hooks || !ts.isArrayLiteralExpression(hooks.initializer))
            throw new Error('Invalid hook handler array');
        const array = hooks.initializer;
        array.elements.forEach((item, index) => { const value = JSON.parse(item.getText(source)); if (typeof value.command === 'string' && value.command.includes(MARKER))
            matches.push({ group: node, array, handler: item, groupIndex, index }); });
    });
    if (matches.length > 1)
        throw new Error('Multiple managed startup hooks; reconcile before setup');
    if (!matches.length)
        return remove ? text : insert(ep.initializer, JSON.stringify(group));
    const match = matches[0];
    if (remove)
        return match.array.elements.length === 1 ? removeAt(ep.initializer, match.groupIndex) : removeAt(match.array, match.index);
    return JSON.parse(match.handler.getText(source)).command === command ? text : replace(match.handler, JSON.stringify(handler));
}
export async function setupHostHooks(options: {
    host: CodingHost;
    configDirectory: string;
    command: string[];
    cacheDirectory?: string;
    handoverBase?: string;
    apply?: boolean;
    remove?: boolean;
}) {
    if (!['codex', 'claude', 'kimi'].includes(options.host) || !isAbsolute(options.configDirectory))
        throw new Error('setup-hooks requires codex, claude or kimi and an absolute config directory');
    const directory = await realpath(options.configDirectory), path = join(directory, options.host === 'codex' ? 'hooks.json' : options.host === 'claude' ? 'settings.json' : 'config.toml');
    const before = await read(path), skill = join(directory, 'skills', 'z1p-context', 'SKILL.md');
    const args = [...options.command, 'startup', '--host', options.host, '--skill', skill, MARKER];
    if (!options.remove)
        await realpath(skill);
    for (const [flag, value] of [['--cache-dir', options.cacheDirectory], ['--handover-base', options.handoverBase]] as const)
        if (value) {
            if (!isAbsolute(value) || await realpath(value) !== value || !(await stat(value)).isDirectory())
                throw new Error('Startup storage must be an existing canonical directory');
            args.push(flag, value);
        }
    if (args.some(s => !s || /[\x00-\x1f]/.test(s)))
        throw new Error('Invalid hook command');
    const command = args.map(quote).join(' '), original = before?.text ?? '';
    let next: string;
    if (options.host === 'kimi') {
        const parsed = parseToml(original || '', { unsafeKeyBehaviour: 'throw' });
        const starts = original.split(START).length - 1, ends = original.split(END).length - 1;
        if (starts !== ends || starts > 1 || starts && original.indexOf(END) < original.indexOf(START))
            throw new Error('Malformed managed startup markers');
        if (!starts && Array.isArray(parsed.hooks) && parsed.hooks.some((h: any) => typeof h.command === 'string' && h.command.includes(MARKER)))
            throw new Error('Unmarked managed startup hook; reconcile before setup');
        const block = options.remove ? '' : '\n' + START + '\n[[hooks]]\nevent = "UserPromptSubmit"\ncommand = ' + JSON.stringify(command) + '\ntimeout = 15\n' + END;
        let from = original.indexOf(START);
        if (from > 0 && original[from - 1] === '\n')
            from--;
        next = starts ? original.slice(0, from) + block + original.slice(original.indexOf(END) + END.length) : block ? original + block : original;
        parseToml(next, { unsafeKeyBehaviour: 'throw' });
    }
    else
        next = editJson(original, options.host, command, !!options.remove);
    if (Buffer.byteLength(next) > 131072)
        throw new Error('Hook configuration exceeds limit');
    const action = next === original ? 'current' : options.remove ? 'remove' : 'install-or-update';
    const result = { host: options.host, path, action, applied: false, beforeSha256: before ? hash(original) : null, afterSha256: hash(next), command, event: options.host === 'kimi' ? 'UserPromptSubmit' : 'SessionStart',
        trustReviewRequired: options.host === 'codex' && !options.remove, limitation: 'Host hooks can be disabled or require trust. No model, permission or MCP configuration is changed.' };
    if (!options.apply || next === original)
        return result;
    const lockPath = path + '.z1p-startup.lock', lock = await open(lockPath, 'wx', 0o600), temporary = path + '.z1p-' + randomUUID() + '.tmp';
    try {
        const current = await read(path);
        if (current?.text !== before?.text || current?.ino !== before?.ino || current?.dev !== before?.dev || await realpath(options.configDirectory) !== directory)
            throw new Error('Hook configuration changed; preview again');
        const file = await open(temporary, 'wx', before?.mode ?? 0o600);
        try {
            await file.writeFile(next);
            await file.chmod(before?.mode ?? 0o600);
            await file.sync();
        }
        finally {
            await file.close();
        }
        const last = await read(path);
        if (last?.text !== before?.text || last?.ino !== before?.ino || last?.dev !== before?.dev)
            throw new Error('Hook configuration changed; preview again');
        if (before)
            await rename(temporary, path);
        else {
            const target = await open(path, 'wx', 0o600);
            try {
                await target.writeFile(next);
                await target.sync();
            }
            finally {
                await target.close();
            }
        }
        result.applied = true;
        return result;
    }
    finally {
        await unlink(temporary).catch(() => { });
        await lock.close();
        await unlink(lockPath);
    }
}
export async function runHostHookSetup(args: string[], command: string[]) {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'config-dir': { type: 'string' }, 'cache-dir': { type: 'string' }, 'handover-base': { type: 'string' }, launcher: { type: 'string' }, apply: { type: 'boolean' }, remove: { type: 'boolean' } } });
    if (positionals.length !== 1 || !['codex', 'claude', 'kimi'].includes(positionals[0]))
        throw new Error('setup-hooks requires codex, claude or kimi');
    const host = positionals[0] as CodingHost;
    if (values.launcher) {
        if (!isAbsolute(values.launcher) || !(await stat(values.launcher)).isFile())
            throw new Error('--launcher must be an existing absolute executable path');
        command = [values.launcher];
    }
    const directory = values['config-dir'] ?? (host === 'codex' ? process.env.CODEX_HOME : host === 'claude' ? process.env.CLAUDE_CONFIG_DIR : process.env.KIMI_CODE_HOME) ?? join(homedir(), host === 'codex' ? '.codex' : host === 'claude' ? '.claude' : '.kimi-code');
    return setupHostHooks({ host, configDirectory: directory, command, cacheDirectory: values['cache-dir'], handoverBase: values['handover-base'], apply: values.apply, remove: values.remove });
}
