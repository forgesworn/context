"""Filesystem and CLI acceptance for explicitly selected dependency snapshots."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import ecosystem_snapshot as snapshot

CLI = Path(snapshot.__file__).resolve()


class SnapshotBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'consumer'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Snapshot Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.manifest = {'name': 'consumer', 'dependencies': {'lib': '^1'}}
        self.lock = {'lockfileVersion': 3, 'packages': {
            '': copy.deepcopy(self.manifest),
            'node_modules/lib': {'version': '1.2.0', 'resolved': 'https://registry.invalid/lib.tgz', 'integrity': 'sha512-fixture'}}}
        self.write('package.json', self.manifest)
        self.write('package-lock.json', self.lock)
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.spec = self.root / 'selection.json'
        self.select([{'id': 'consumer', 'path': 'consumer', 'manifests': ['package.json']}])
        self.output = self.root / 'snapshot.json'

    def git(self, *args):
        run = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(self.repo), *args],
                             capture_output=True, text=True, check=True)
        return run.stdout.strip()

    def write(self, path, value):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value))

    def select(self, repos):
        self.spec.write_text(json.dumps({'version': 1, 'repositories': repos}))

    def run_cli(self, *args):
        return subprocess.run([sys.executable, '-B', str(CLI), *map(str, args)], capture_output=True, text=True)

    def build(self):
        run = self.run_cli('build', '--root', self.root, '--spec', self.spec, '--out', self.output)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(self.output.read_text())

    def verify(self):
        return self.run_cli('verify', '--root', self.root, '--spec', self.spec, '--snapshot', self.output)

    def test_committed_content_separate_from_dirty_observation(self):
        self.write('package.json', {'dependencies': {'lib': '^9'}})
        report = self.build()
        self.assertEqual(report['dependencies'][0]['requested'], '^1')
        self.assertEqual(report['dependencies'][0]['locked']['version'], '1.2.0')
        tree = report['repositories'][0]['worktree']
        self.assertTrue(tree['trackedDirtyAtCapture'])
        manifest = next(x for x in tree['inputs'] if x['path'] == 'package.json')
        self.assertNotEqual(manifest['committedSha256'], manifest['workingSha256'])
        self.assertEqual(self.verify().returncode, 0)
        self.write('package.json', {'dependencies': {'lib': '^10'}})
        run = self.verify()
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertEqual(json.loads(run.stdout)['status'], 'stale')

    def test_new_lock_and_commit_invalidate_but_unselected_file_does_not(self):
        self.build()
        (self.repo / 'notes.txt').write_text('unselected')
        self.assertEqual(self.verify().returncode, 0)
        self.write('npm-shrinkwrap.json', self.lock)
        self.assertEqual(self.verify().returncode, 1)
        (self.repo / 'npm-shrinkwrap.json').unlink()
        self.git('add', 'notes.txt')
        self.git('commit', '-qm', 'new head')
        self.assertEqual(self.verify().returncode, 1)

    def test_same_commit_different_worktree_is_a_different_binding(self):
        original = self.build()
        self.git('worktree', 'add', '--detach', str(self.root / 'linked'), 'HEAD')
        self.select([{'id': 'consumer', 'path': 'linked', 'manifests': ['package.json']}])
        other = snapshot.capture(self.root, self.spec)
        self.assertEqual(original['repositories'][0]['commit'], other['repositories'][0]['commit'])
        self.assertNotEqual(original['repositories'][0]['worktree']['identity'], other['repositories'][0]['worktree']['identity'])
        self.assertEqual(self.verify().returncode, 1)

    def test_worktree_change_during_capture_is_rejected(self):
        real = snapshot.working_hash
        calls = []
        def changing(root, path, budget):
            calls.append(path)
            return real(root, path, budget) if len(calls) <= 3 else 'changed'
        with patch.object(snapshot, 'working_hash', side_effect=changing):
            with self.assertRaises((ValueError, OSError)):
                snapshot.capture(self.root, self.spec)

    def test_symlink_manifest_and_root_are_rejected(self):
        target = self.repo / 'package.json'
        raw = target.read_text()
        target.unlink()
        outside = self.root / 'outside.json'
        outside.write_text(raw)
        target.symlink_to(outside)
        with self.assertRaises((ValueError, OSError)):
            snapshot.capture(self.root, self.spec)
        target.unlink()
        target.write_text(raw)
        (self.root / 'alias').symlink_to(self.repo, target_is_directory=True)
        self.select([{'id': 'consumer', 'path': 'alias', 'manifests': ['package.json']}])
        with self.assertRaises((ValueError, OSError)):
            snapshot.capture(self.root, self.spec)

    def test_committed_symlink_not_read_as_a_blob_manifest(self):
        (self.repo / 'package.json').unlink()
        (self.repo / 'package.json').symlink_to('outside.json')
        self.git('add', 'package.json')
        self.git('commit', '-qm', 'symlink')
        with self.assertRaises((ValueError, OSError)):
            snapshot.capture(self.root, self.spec)

    def test_overlapping_and_escaping_selections_rejected(self):
        for selection in [
            [{'id': 'a', 'path': 'consumer', 'manifests': ['package.json']}, {'id': 'b', 'path': 'consumer/sub', 'manifests': ['package.json']}],
            [{'id': 'a', 'path': '../consumer', 'manifests': ['package.json']}],
            [{'id': 'a', 'path': 'consumer', 'manifests': ['node_modules/a/package.json']}],
            [{'id': 'a', 'path': 'consumer', 'manifests': ['./package.json']}],
        ]:
            with self.subTest(selection=selection):
                self.select(selection)
                with self.assertRaises((ValueError, OSError)):
                    snapshot.capture(self.root, self.spec)

    def test_bounded_query_and_tamper_detection(self):
        self.build()
        query = ['query', '--snapshot', self.output, '--repo', 'consumer', '--max-bytes', 1024]
        run = self.run_cli(*query)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertLessEqual(len(run.stdout.encode()), 1024)
        self.assertFalse(json.loads(run.stdout)['complete'])
        report = json.loads(self.output.read_text())
        report['dependencies'][0]['requested'] = 'tampered'
        self.output.write_text(json.dumps(report))
        run = self.run_cli(*query)
        self.assertEqual(run.returncode, 2)
        self.assertNotIn('tampered', run.stderr)

    def test_private_output_no_overwrite_and_no_project_hooks(self):
        hook = self.repo / '.git/hooks/post-checkout'
        marker = self.root / 'hook-ran'
        hook.write_text('#!/bin/sh\ntouch "' + str(marker) + '"\n')
        hook.chmod(0o755)
        self.build()
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertFalse(marker.exists())
        before = self.output.read_bytes()
        run = self.run_cli('build', '--root', self.root, '--spec', self.spec, '--out', self.output)
        self.assertEqual(run.returncode, 2)
        self.assertEqual(before, self.output.read_bytes())

    def test_url_secrets_redacted_in_all_persisted_dependency_rows(self):
        private_url = 'https://secret-user:secret-pass@registry.invalid/lib.tgz?secret-query#secret-fragment'
        self.manifest['dependencies']['lib'] = private_url
        self.lock['packages']['']['dependencies']['lib'] = private_url
        self.lock['packages']['node_modules/lib']['resolved'] = private_url
        self.write('package.json', self.manifest)
        self.write('package-lock.json', self.lock)
        self.git('add', '.')
        self.git('commit', '-qm', 'url')
        report = self.build()
        for secret in ['secret-user', 'secret-pass', 'secret-query', 'secret-fragment']:
            self.assertNotIn(secret, self.output.read_text())
        self.assertEqual(report['dependencies'][0]['locked']['resolvedSha256'], snapshot.digest(private_url.encode()))

    def test_parser_bounds_and_generic_error(self):
        (self.repo / 'package.json').write_text('{"PRIVATE-MALFORMED":')
        self.git('add', '.')
        self.git('commit', '-qm', 'malformed')
        run = self.run_cli('build', '--root', self.root, '--spec', self.spec, '--out', self.output)
        self.assertEqual(run.returncode, 2)
        self.assertNotIn('PRIVATE-MALFORMED', run.stderr)
        self.assertFalse(self.output.exists())


    def test_verification_rejects_changed_tooling_and_changed_resolution(self):
        report = self.build()
        report["tooling"]["sha256"] = "f" * 64
        report["sha256"] = snapshot.digest({k: v for k, v in report.items() if k != "sha256"})
        self.output.write_text(json.dumps(report))
        self.assertEqual(self.verify().returncode, 1)
        self.output.unlink()
        report = self.build()
        report["dependencies"][0]["requested"] = "different-resolution"
        report["graph"] = snapshot.make_graph(report["repositories"], report["dependencies"])
        report["sha256"] = snapshot.digest({k: v for k, v in report.items() if k != "sha256"})
        self.output.write_text(json.dumps(report))
        self.assertEqual(self.verify().returncode, 1)
        self.assertNotIn(str(self.root), self.output.read_text())

    def test_query_rejects_self_checksummed_bad_metadata_and_binding(self):
        report = self.build()
        for key, value in [("capturedAt", "x" * 4000), ("bindingSha256", "f" * 64)]:
            bad = copy.deepcopy(report)
            bad[key] = value
            bad["sha256"] = snapshot.digest({k: v for k, v in bad.items() if k != "sha256"})
            self.output.write_text(json.dumps(bad))
            run = self.run_cli("query", "--snapshot", self.output, "--repo", "consumer", "--max-bytes", 1024)
            self.assertEqual(run.returncode, 2)
            self.assertFalse(run.stdout)
        self.output.write_text("[" * 2000 + "0" + "]" * 2000)
        run = self.run_cli("query", "--snapshot", self.output, "--repo", "consumer")
        self.assertEqual(run.returncode, 2)
        self.assertNotIn("Traceback", run.stderr)

    def test_live_byte_budget_includes_uncommitted_optional_locks(self):
        self.write("npm-shrinkwrap.json", {"padding": "x" * 2048})
        with patch.object(snapshot, "MAX_TOTAL", 1024):
            with self.assertRaises(ValueError):
                snapshot.capture(self.root, self.spec)

    def test_git_administration_replacement_invalidates_binding(self):
        self.build()
        (self.repo / ".git").rename(self.repo / "old-git")
        import shutil
        shutil.copytree(self.repo / "old-git", self.repo / ".git")
        self.assertEqual(self.verify().returncode, 1)

    def test_parent_replaced_by_symlink_cannot_read_external_leaf(self):
        (self.repo / "sub").mkdir()
        (self.repo / "sub/package.json").write_text("internal")
        external = self.root / "external"
        external.mkdir()
        (external / "package.json").write_text("PRIVATE-EXTERNAL")
        real_open = os.open
        def swapping(path, flags, *args, **kwargs):
            if path == "package.json" and "dir_fd" in kwargs:
                (self.repo / "sub").rename(self.repo / "kept-sub")
                (self.repo / "sub").symlink_to(external, target_is_directory=True)
            return real_open(path, flags, *args, **kwargs)
        with patch.object(snapshot.os, "open", side_effect=swapping):
            with self.assertRaises(ValueError):
                snapshot.read_selected(self.repo, "sub/package.json", [0])

    def test_missing_promisor_blob_fails_without_transport(self):
        object_id = self.git("rev-parse", "HEAD:package.json")
        self.git("config", "remote.origin.url", "ext::sh -c touch TRANSPORT-SHOULD-NOT-RUN")
        self.git("config", "remote.origin.promisor", "true")
        self.git("config", "extensions.partialClone", "origin")
        (self.repo / ".git/objects" / object_id[:2] / object_id[2:]).unlink()
        run = self.run_cli("build", "--root", self.root, "--spec", self.spec, "--out", self.output)
        self.assertEqual(run.returncode, 2)
        self.assertFalse((self.repo / "TRANSPORT-SHOULD-NOT-RUN").exists())
        self.assertFalse(self.output.exists())


    def test_expanded_report_cannot_be_written_if_loader_would_reject(self):
        report = snapshot.capture(self.root, self.spec)
        report["extra"] = [0] * 300001
        report["sha256"] = snapshot.digest({k: v for k, v in report.items() if k != "sha256"})
        self.assertLess(len(json.dumps(report).encode()), snapshot.MAX_REPORT)
        with self.assertRaises(ValueError):
            snapshot.write_snapshot(self.output, report)
        self.assertFalse(self.output.exists())

    def test_capture_checks_final_report_structural_limit(self):
        # A selected manifest fits; repeated graph/binding evidence expands report.
        with patch.object(snapshot.ecosystem_resolution, "MAX_NODES", 250):
            with self.assertRaises(ValueError):
                snapshot.capture(self.root, self.spec)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
