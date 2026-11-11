#!/usr/bin/env python3
"""OS2 v2 requalification gate. Model-free: reads a finished one-task plan
(plain and context, one repetition, both assessed) and prints each gate as a
boolean. Passes only if every gate passes.

    python3 qualify.py --plan DIR
"""
import argparse
import json
import pathlib
import sys

READS_AFTER_PACKET_MAX = 0.25
MCP_ERROR_RATE_MAX = 0.05


def gates(plan):
    plan = pathlib.Path(plan)
    doc = json.loads((plan / 'schedule.json').read_text(encoding='utf8'))
    cells = {c['arm']: plan / c['directory'] for c in doc['cells']}
    if sorted(cells) != ['context', 'plain'] or len(doc['cells']) != 2:
        raise SystemExit('requalification needs exactly one plain and one context cell')
    ex = {arm: json.loads((d / 'executor.json').read_text(encoding='utf8')) for arm, d in cells.items()}
    asmt = {arm: json.loads((d / 'assessment.json').read_text(encoding='utf8')) for arm, d in cells.items()}
    m = ex['context']['metrics']
    env_ok = lambda e: all((e['environment'].get(k) or {}).get('exitCode') == 0 for k in ('isolation', 'ready')) \
        and e['environment'].get('intactAfterRun') is not False
    g = {
        'contextAccepted': asmt['context']['accepted'] is True,
        'readsAfterPacketValid': m.get('readsAfterPacketValid') is True and m.get('malformedLines') == 0,
        'readsAfterPacketAtMost025': isinstance(m.get('readsAfterPacket'), (int, float)) and m['readsAfterPacket'] <= READS_AFTER_PACKET_MAX,
        'mcpErrorRateAtMost5pc': isinstance(m.get('mcpErrorRate'), (int, float)) and m['mcpErrorRate'] <= MCP_ERROR_RATE_MAX,
        'isolationProbesPassed': all(env_ok(e) for e in ex.values())
                                 and all(a['secondReviewer'] is None or a['secondReviewer'].get('isolation') for a in asmt.values()),
        'usageComplete': all(e['usage'].get('complete') for e in ex.values())
                         and all(a['reviewer']['usage'].get('complete') for a in asmt.values()),
    }
    report = {'gates': g, 'passed': all(g.values()),
              'observed': {'readsAfterPacket': m.get('readsAfterPacket'), 'mcpErrorRate': m.get('mcpErrorRate'),
                           'mcpCalls': m.get('mcpCalls'), 'plainAccepted': asmt['plain']['accepted'],
                           'executorTokens': {arm: e['usage'].get('total') for arm, e in ex.items()},
                           'reviewersAgree': {arm: (a['secondReviewer'] or {}).get('accepted') == a['reviewer']['accepted']
                                              for arm, a in asmt.items()}}}
    return report


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--plan', required=True, type=pathlib.Path)
    a = p.parse_args(argv)
    r = gates(a.plan)
    (a.plan / 'qualification.json').write_text(json.dumps(r, indent=2) + '\n', encoding='utf8')
    print(json.dumps(r))
    return 0 if r['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
