#!/usr/bin/env python3
"""Per-call breakdown of one Codex session log (no model).

Codex 0.166 runs tools inside a JavaScript `exec` sandbox, so the model sees what
each script prints. Each model call's input is the previous call's input plus
what was added in between: the model's own output (reasoning, scripts, messages)
and the script output it then reads. This script lists every call with its
reported usage, the items logged with it (its reasoning and script, and that
script's output) and how much the next call's input grew, sized in bytes and, for readable
text, in o200k tokens when tiktoken is installed.

Usage: session-breakdown.py CODEX_HOME [--json]
"""
import json
import pathlib
import sys

try:
    import tiktoken
    ENC = tiktoken.get_encoding('o200k_base')
except Exception:  # tokenizer is optional; bytes are always reported
    ENC = None


def tokens(text):
    return len(ENC.encode(text)) if ENC and text else None


def item_text(payload):
    kind = payload.get('type')
    if kind == 'custom_tool_call':
        return payload.get('input') or ''
    if kind == 'custom_tool_call_output':
        out = payload.get('output')
        if isinstance(out, list):
            return ''.join(x.get('text', '') for x in out if isinstance(x, dict))
        return out if isinstance(out, str) else json.dumps(out)
    if kind == 'message':
        return ''.join(c.get('text', '') for c in payload.get('content') or [] if isinstance(c, dict))
    if kind == 'reasoning':
        # Reasoning is usually carried encrypted; its summary is all that is readable.
        return ''.join(s.get('text', '') for s in payload.get('summary') or [] if isinstance(s, dict))
    return json.dumps(payload)


def breakdown(home):
    logs = sorted(pathlib.Path(home).glob('sessions/**/rollout-*.jsonl'))
    if len(logs) != 1:
        raise SystemExit(f'expected one session log under {home}, found {len(logs)}')
    calls, pending = [], []
    for line in logs[0].read_text(encoding='utf8').splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        payload = e.get('payload') or {}
        if e.get('type') == 'response_item' and payload.get('type'):
            text = item_text(payload)
            pending.append({'type': payload['type'], 'bytes': len(json.dumps(payload)), 'textBytes': len(text),
                            'textTokens': tokens(text), 'encrypted': bool(payload.get('encrypted_content'))})
        elif e.get('type') == 'event_msg' and payload.get('type') == 'token_count' and (payload.get('info') or {}).get('last_token_usage'):
            u = payload['info']['last_token_usage']
            calls.append({'input': u.get('input_tokens'), 'cached': u.get('cached_input_tokens'), 'output': u.get('output_tokens'),
                          'reasoning': u.get('reasoning_output_tokens'), 'itemsBefore': pending})
            pending = []
    # Codex logs a call's token count after the script output that call triggered, so
    # the items grouped with call k (its reasoning, script and that script's output)
    # are what call k+1 reads on top of call k's input: adds = next input - input.
    for k in range(len(calls) - 1):
        calls[k]['adds'] = calls[k + 1]['input'] - calls[k]['input']
    return calls


def main(argv):
    calls = breakdown(argv[1])
    if '--json' in argv:
        print(json.dumps(calls, indent=2))
        return 0
    total = sum(c['input'] for c in calls)
    print(f'calls {len(calls)}  input {total}  first-call input {calls[0]["input"] if calls else None}')
    for k, c in enumerate(calls):
        kinds = {}
        for it in c['itemsBefore']:
            key = it['type']
            agg = kinds.setdefault(key, [0, 0, 0])
            agg[0] += 1; agg[1] += it['textBytes']; agg[2] += it['textTokens'] or 0
        shown = ', '.join(f'{t} x{n} {b}B/{tk}t' for t, (n, b, tk) in kinds.items())
        print(f'{k:3d} input {c["input"]:>7} adds {c.get("adds", "-")!s:>7} out {c["output"]:>5} reason {c["reasoning"]:>5} | {shown}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
