import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runner', HERE / 'run-pair.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_record_keeps_failed_subprocess_exit(self):
        result, stage = runner.record('failed', lambda: __import__('subprocess').CompletedProcess([], 7))
        self.assertEqual(result.returncode, 7)
        self.assertEqual(stage['exitCode'], 7)

    def test_cited_source_is_selected_and_regular(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            source = root / 'packages/context-tools/a.ts'
            source.parent.mkdir(parents=True); source.write_text('ok')
            manifest = {'packages/context-tools/a.ts': runner.sha256(source), '.git/config': 'x'}
            self.assertEqual(runner.safe_source(root, 'packages/context-tools/a.ts', manifest, cited=True), source)
            with self.assertRaises(ValueError): runner.safe_source(root, '.git/config', manifest, cited=True)
            with self.assertRaises(ValueError): runner.safe_source(root, 'packages\\context-tools/a.ts', manifest, cited=True)

    def test_capture_drains_final_usage(self):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw); events, stderr = root / 'events', root / 'stderr'
            script = 'import json; print(json.dumps({"type":"turn.completed","usage":{"input_tokens":3}}))'
            code, abnormal = runner.run_capture([sys.executable, '-c', script], root, {}, events, stderr, timeout=2)
            self.assertEqual(code, 0); self.assertFalse(abnormal)
            self.assertEqual(runner.usage_and_tools(events)['usage'], [{'input_tokens': 3}])


    def capture(self, script, timeout=2):
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            result = runner.run_capture([sys.executable, '-c', script], root, {}, root/'events', root/'stderr', timeout=timeout)
            events = [json.loads(line) for line in (root/'events').read_text().splitlines()]
            return result, events

    def test_many_events_and_split_utf8(self):
        script = "import os,time,json; [print(json.dumps({'type':'item.completed','i':i}), flush=True) for i in range(2000)]; b=json.dumps({'type':'turn.completed','text':'é','usage':{'input_tokens':7}},ensure_ascii=False).encode(); n=b.index(bytes([195]))+1; os.write(1,b[:n]); time.sleep(.05); os.write(1,b[n:]+b'\\n')"
        result, events = self.capture(script)
        self.assertEqual(result, (0, False))
        self.assertEqual(len(events), 2001)
        self.assertEqual(events[-1]['event']['text'], 'é')
        self.assertEqual(events[-1]['event']['usage']['input_tokens'], 7)

    def test_partial_line_timeout_and_closed_stdout_timeout(self):
        import time
        for script in ["import os,time; os.write(1,b'{'); time.sleep(10)", "import os,time; os.close(1); time.sleep(10)"]:
            start = time.monotonic()
            result, _ = self.capture(script, timeout=.2)
            self.assertTrue(result[1])
            self.assertLess(time.monotonic()-start, 2)

    def test_error_detection_and_harmless_refusal_word(self):
        for payload, expected in [({'type':'item.completed','text':'Explain refusal handling'},False), ({'type':'turn.failed','error':{'code':'refused'}},True), ([],True)]:
            script = 'import json; print('+repr(json.dumps(payload))+'); print(json.dumps({"type":"turn.completed","usage":{}}))'
            result, _ = self.capture(script)
            self.assertEqual(result[1], expected)

    def test_missing_terminal_event_is_abnormal(self):
        result, _ = self.capture("print('{}')")
        self.assertTrue(result[1])


    def test_reviewer_accept_reject_and_malformed_are_distinct(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        import subprocess
        task = json.loads((HERE/'task.json').read_text())
        good = {'accepted': True, 'findings': [{'id': key, 'passed': True, 'reason': 'Evidence verified'} for key in task['requiredFindingIds']], 'materialIssues': []}
        rejected = {**good, 'accepted': False, 'materialIssues': ['Material error']}
        for report, completed, accepted in [(good,True,True),(rejected,True,False),({},False,False),({**good,'extra':True},False,False)]:
            with tempfile.TemporaryDirectory() as raw:
                root = pathlib.Path(raw)
                answer=root/'answer.json'; answer.write_text('{"evidence":[]}')
                def fake_capture(*args, **kwargs):
                    (root/'review-final.json').write_text(json.dumps(report))
                    return 0, False
                args=SimpleNamespace(auth_file=root/'unused-auth',codex=pathlib.Path(sys.executable))
                receipt={'stages':[]}; check=subprocess.CompletedProcess([],0,'{}','')
                with patch.object(runner,'run_capture',fake_capture):
                    result=runner.do_review(args,root,root,answer,receipt,check,check,{'sourceHashes':{}})
                self.assertEqual(result,completed)
                self.assertEqual(receipt['accepted'],accepted)

    def test_lock_rejects_wrong_experiment_and_mapping_alias(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as raw:
            root=pathlib.Path(raw).resolve(); (root/'a').write_text('a')
            lock={'experimentId':'d5-orientation-context-20260921-v3','lockedAt':'2026-09-21T00:00:00Z','reviewAccepted':True,'files':{'a':runner.sha256(root/'a')}}
            with patch.object(runner,'HERE',root), patch.object(runner,'LOCKED_FILES',['a']):
                for invalid in [{**lock,'experimentId':'wrong'},{**lock,'sha256':lock['files']},{**lock,'lockedAt':'invalid'}]:
                    (root/'lock.json').write_text(json.dumps(invalid))
                    with self.assertRaises(ValueError): runner.validate_lock()
                (root/'lock.json').write_text(json.dumps(lock))
                self.assertEqual(runner.validate_lock(),lock)


    def test_assisted_requires_successful_ordered_navigation_on_own_root(self):
        with tempfile.TemporaryDirectory() as raw:
            root=pathlib.Path(raw); path=root/'events'
            def event(name, ok=True):
                return {'event':{'type':'item.completed','item':{'type':'mcp_tool_call','server':'z1p-repository','tool':name,'status':'completed','error':None if ok else 'failed','result':{'content':[{'text':json.dumps({'root':str(root)})}]}}}}
            sequence=[event(name) for name in ['repository_status','repository_refresh','repository_search']]
            for entries,expected in [(sequence,True),(sequence[::-1],False),(sequence[:2],False),([],False),([*sequence[:2],event('repository_search',False)],False)]:
                path.write_text(''.join(json.dumps(e)+'\n' for e in entries))
                self.assertEqual(runner.check_retrieval(path,'assisted',root)['passed'],expected)
            path.write_text('')
            self.assertTrue(runner.check_retrieval(path,'baseline',root)['passed'])

    def test_failed_preparation_keeps_diagnostics_and_capture_stage(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        import subprocess
        with tempfile.TemporaryDirectory() as raw:
            root=pathlib.Path(raw)
            with patch.object(runner,'invoke_prepare',return_value=subprocess.CompletedProcess([],3,'partial prep','real error')):
                self.assertFalse(runner.run_arm(SimpleNamespace(node=None),root,'baseline'))
            receipt=json.loads((root/'baseline/receipt.json').read_text())
            self.assertEqual(receipt['status'],'prepare-failed')
            self.assertEqual(receipt['stages'][-1]['name'],'receipt-capture')
            self.assertEqual((root/'baseline/prepare.stderr').read_text(),'real error')

    def test_timeout_retains_complete_event_before_sleep(self):
        result,events=self.capture("import time,json; print(json.dumps({'type':'item.completed','text':'retained'}),flush=True); time.sleep(10)",timeout=.2)
        self.assertTrue(result[1])
        self.assertEqual(events[0]['event']['text'],'retained')


if __name__ == '__main__':
    unittest.main()
