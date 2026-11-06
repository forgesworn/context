#!/usr/bin/env python3
"""Where an executor session's input tokens come from (no model).

Every model call re-reads everything before it, so a session's input is
  calls x (first-call input) + sum over later calls of what earlier steps added.
Each step's addition (next input - this input) is split across the items logged
with it by text size, and charged once per later call that carries it. Items:
mcp (Context tool results), shell (command results), script (the model's own
tool-call code), reasoning, message. Approximate: additions are apportioned by
bytes, and reasoning is encrypted so its share is the remainder of the step.

    cost-attribution.py PLAN_DIR [PLAN_DIR ...]
"""
import importlib.util
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('sb', HERE / 'session-breakdown.py')
sb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sb)


def classify(home):
    """Per call: list of (kind, textBytes) for its items, with tool outputs split mcp/shell."""
    log = sorted(pathlib.Path(home).glob('sessions/**/rollout-*.jsonl'))[0]
    groups, cur, last_call = [], [], ''
    for line in log.read_text(encoding='utf8').splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        p = e.get('payload') or {}
        if e.get('type') == 'response_item' and p.get('type'):
            t = p['type']
            text = sb.item_text(p)
            if t == 'custom_tool_call':
                last_call = text
                cur.append(('script', len(text)))
            elif t == 'custom_tool_call_output':
                cur.append(('mcp' if 'repository_' in last_call else 'shell', len(text)))
            elif t == 'reasoning':
                cur.append(('reasoning', 0))
            else:
                cur.append((t if t == 'message' else 'other', len(text)))
        elif e.get('type') == 'event_msg' and p.get('type') == 'token_count' and (p.get('info') or {}).get('last_token_usage'):
            groups.append(cur); cur = []
    return groups


def attribute(home):
    calls = sb.breakdown(home)
    groups = classify(home)
    n = len(calls)
    first = calls[0]['input']
    out = {'calls': n, 'firstInput': first, 'fixed': n * first, 'input': sum(c['input'] for c in calls),
           'output': sum(c['output'] for c in calls), 'reasoningOut': sum(c['reasoning'] or 0 for c in calls),
           'carried': {}, 'added': {}}
    for k in range(n - 1):
        adds = max(calls[k + 1]['input'] - calls[k]['input'], 0)
        carriers = n - k - 1
        items = groups[k] if k < len(groups) else []
        sized = [(kind, b) for kind, b in items if kind != 'reasoning']
        text_bytes = sum(b for _, b in sized)
        # Roughly 4 bytes per token for visible text; the rest of the step is reasoning carried forward.
        visible = min(adds, text_bytes / 4)
        share = {}
        for kind, b in sized:
            share[kind] = share.get(kind, 0) + (visible * b / text_bytes if text_bytes else 0)
        share['reasoning'] = share.get('reasoning', 0) + adds - visible
        for kind, v in share.items():
            out['added'][kind] = out['added'].get(kind, 0) + v
            out['carried'][kind] = out['carried'].get(kind, 0) + v * carriers
    out['added'] = {k: round(v) for k, v in out['added'].items()}
    out['carried'] = {k: round(v) for k, v in out['carried'].items()}
    return out


def main(argv):
    for plan in argv[1:]:
        plan = pathlib.Path(plan)
        sched = json.loads((plan / 'schedule.json').read_text())
        for c in sched['cells']:
            home = plan / c['directory'] / 'executor-home'
            if not list(home.glob('sessions/**/rollout-*.jsonl')):
                continue
            a = attribute(home)
            print(json.dumps({'plan': plan.name, 'arm': c['arm'], **a}))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
