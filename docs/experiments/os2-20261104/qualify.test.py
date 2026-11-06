#!/usr/bin/env python3
"""Tests for qualify.py: every gate can fail on its own."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('q', HERE / 'qualify.py')
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)

EX = {'usage': {'complete': True, 'total': 100}, 'environment': {'isolation': {'exitCode': 0}, 'ready': {'exitCode': 0}, 'intactAfterRun': True},
      'metrics': {'readsAfterPacketValid': True, 'malformedLines': 0, 'readsAfterPacket': 0.1, 'mcpErrorRate': 0.0, 'mcpCalls': 9}}
AS = {'accepted': True, 'reviewer': {'accepted': True, 'usage': {'complete': True}}, 'secondReviewer': {'accepted': True, 'isolation': True}}


class Qualify(unittest.TestCase):
    def build(self, d, ex=None, asmt=None):
        d = pathlib.Path(d)
        (d / 'schedule.json').write_text(json.dumps({'cells': [{'arm': 'context', 'directory': 'cell-001'}, {'arm': 'plain', 'directory': 'cell-002'}]}))
        for n, arm in (('cell-001', 'context'), ('cell-002', 'plain')):
            (d / n).mkdir()
            (d / n / 'executor.json').write_text(json.dumps((ex or {}).get(arm, EX)))
            (d / n / 'assessment.json').write_text(json.dumps((asmt or {}).get(arm, AS)))
        return q.gates(d)

    def test_passes_when_every_gate_holds(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(self.build(d)['passed'])

    def test_each_gate_fails_alone(self):
        def ex_with(**metrics):
            e = copy.deepcopy(EX); e['metrics'].update(metrics); return e
        cases = {
            'contextAccepted': (None, {'context': {**AS, 'accepted': False}}),
            'readsAfterPacketValid': ({'context': ex_with(readsAfterPacketValid=False)}, None),
            'readsAfterPacketAtMost025': ({'context': ex_with(readsAfterPacket=0.3)}, None),
            'mcpErrorRateAtMost5pc': ({'context': ex_with(mcpErrorRate=0.06)}, None),
            'isolationProbesPassed': ({'plain': {**EX, 'environment': {'isolation': {'exitCode': 97}, 'ready': {'exitCode': 0}}}}, None),
            'usageComplete': ({'plain': {**EX, 'usage': {'complete': False}}}, None),
        }
        for gate, (ex, asmt) in cases.items():
            with self.subTest(gate=gate), tempfile.TemporaryDirectory() as d:
                r = self.build(d, ex, asmt)
                self.assertFalse(r['gates'][gate], gate)
                self.assertFalse(r['passed'])
        with tempfile.TemporaryDirectory() as d:   # a plain rejection does not fail requalification
            self.assertTrue(self.build(d, None, {'plain': {**AS, 'accepted': False}})['passed'])


if __name__ == '__main__':
    unittest.main()
