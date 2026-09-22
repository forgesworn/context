# test/test_ecosystem_resolution.py
import copy
import hashlib
import unittest

from scripts.ecosystem_resolution import resolve_dependencies


def _sha40(seed: str) -> str:
    return hashlib.sha1(seed.encode()).hexdigest()


def _sha64(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def _pkg_doc(path, data):
    return {"path": path, "data": data, "sha256": _sha64(path + repr(sorted(data.keys())))}


def _repo(rid, path, commit, documents):
    return {"id": rid, "path": path, "commit": commit, "documents": documents}


def _resolve_one(repos):
    return resolve_dependencies(repos)


class TestInputValidation(unittest.TestCase):
    def test_duplicate_repo_id(self):
        r = _repo("a", "a", _sha40("1"), [_pkg_doc("package.json", {"name": "x"})])
        r2 = _repo("a", "b", _sha40("2"), [_pkg_doc("package.json", {"name": "y"})])
        with self.assertRaises(ValueError):
            resolve_dependencies([r, r2])

    def test_overlapping_repo_paths(self):
        r = _repo("a", "a", _sha40("1"), [_pkg_doc("package.json", {"name": "x"})])
        r2 = _repo("b", "a/b", _sha40("2"), [_pkg_doc("package.json", {"name": "y"})])
        with self.assertRaises(ValueError):
            resolve_dependencies([r, r2])

    def test_duplicate_document_path(self):
        r = _repo(
            "r", "r", _sha40("1"),
            [_pkg_doc("package.json", {"name": "x"}), _pkg_doc("package.json", {"name": "y"})],
        )
        with self.assertRaises(ValueError):
            resolve_dependencies([r])

    def test_bad_commit(self):
        r = _repo("r", "r", "deadbeef", [_pkg_doc("package.json", {"name": "x"})])
        with self.assertRaises(ValueError):
            resolve_dependencies([r])

    def test_bad_doc_path(self):
        r = _repo("r", "r", _sha40("1"), [
            {"path": "../escape.json", "data": {}, "sha256": _sha64("z")},
        ])
        with self.assertRaises(ValueError):
            resolve_dependencies([r])

    def test_bad_sha(self):
        r = _repo("r", "r", _sha40("1"), [
            {"path": "package.json", "data": {"name": "x"}, "sha256": "abc"},
        ])
        with self.assertRaises(ValueError):
            resolve_dependencies([r])

    def test_too_many_repos(self):
        repos = []
        for i in range(33):
            repos.append(_repo(f"r{i}", f"r{i}", _sha40(str(i)), [
                _pkg_doc("package.json", {"name": f"x{i}"})
            ]))
        with self.assertRaises(ValueError):
            resolve_dependencies(repos)

    def test_depth_limit(self):
        nested = {}
        cur = nested
        for _ in range(40):
            cur["n"] = {}
            cur = cur["n"]
        r = _repo("r", "r", _sha40("1"), [
            {"path": "package.json", "data": nested, "sha256": _sha64("x")}
        ])
        with self.assertRaises(ValueError):
            resolve_dependencies([r])


class TestNpmBasics(unittest.TestCase):
    def _basic_repo(self, version="1.0.0", lock_version="1.0.0", requested="^1.0.0"):
        manifest = {"name": "root", "dependencies": {"alpha": requested}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"name": "root", "dependencies": {"alpha": requested}},
                "node_modules/alpha": {
                    "version": lock_version,
                    "resolved": "https://example.com/a.tgz",
                    "integrity": "sha512-abc",
                },
            },
        }
        return _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])

    def test_npm_resolved(self):
        rows = _resolve_one([self._basic_repo()])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["resolution"], "locked-artifact")
        self.assertIsNone(row["reason"])
        self.assertEqual(row["locked"]["version"], "1.0.0")

    def test_npm_lock_declaration_mismatch(self):
        repo = self._basic_repo(requested="^2.0.0")
        repo["documents"][1]["data"]["packages"][""]["dependencies"]["alpha"] = "^1.0.0"
        rows = _resolve_one([repo])
        # manifest requested "^2.0.0" but lock's declaration metadata records "^1.0.0"
        self.assertEqual(rows[0]["resolution"], "unresolved")
        self.assertEqual(rows[0]["reason"], "lock-declaration-mismatch")

    def test_npm_stale_newer_sibling(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"name": "root", "dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {
                    "version": "1.5.0",
                    "resolved": "https://example.com/a.tgz",
                    "integrity": "sha512-abc",
                },
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
            _pkg_doc("newer/package.json", {"name": "alpha", "version": "9.9.9"}),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["resolution"], "locked-artifact")
        self.assertEqual(rows[0]["locked"]["version"], "1.5.0")

    def test_npm_no_lock(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        repo = _repo("r", "r", _sha40("c"), [_pkg_doc("package.json", manifest)])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "missing-or-unsupported-lockfile")

    def test_npm_missing_alias_in_lock(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {"": {"dependencies": {"alpha": "^1.0.0"}}},
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "no-locked-entry")

    def test_npm_missing_alias_entry_name(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {"version": "1.0.0", "name": "beta",
                                        "resolved": "https://x/a.tgz",
                                        "integrity": "sha512-abc"},
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "locked-name-mismatch")

    def test_npm_no_artifact_metadata(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {"version": "1.0.0"},
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "artifact-identity-incomplete")
        self.assertEqual(rows[0]["resolution"], "unresolved")

    def test_npm_unsupported_lock_version(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {"lockfileVersion": 1, "dependencies": {"alpha": {"version": "1.0.0"}}}
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "missing-or-unsupported-lockfile")


class TestNpmAlias(unittest.TestCase):
    def _alias_repo(self, lock_name=None, requested="npm:real@^1.0.0"):
        manifest = {"name": "root", "dependencies": {"alias": requested}}
        entry = {"version": "1.0.0", "resolved": "https://x/a.tgz", "integrity": "sha512-abc"}
        if lock_name is not None:
            entry["name"] = lock_name
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alias": requested}},
                "node_modules/alias": entry,
            },
        }
        return _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])

    def test_alias_resolved(self):
        rows = _resolve_one([self._alias_repo(lock_name="real")])
        self.assertEqual(rows[0]["packageName"], "real")
        self.assertEqual(rows[0]["resolution"], "locked-artifact")

    def test_alias_scoped(self):
        rows = _resolve_one([self._alias_repo(lock_name="@scope/real", requested="npm:@scope/real@^1.0.0")])
        self.assertEqual(rows[0]["packageName"], "@scope/real")

    def test_alias_name_mismatch(self):
        rows = _resolve_one([self._alias_repo(lock_name="other")])
        self.assertEqual(rows[0]["reason"], "locked-name-mismatch")

    def test_alias_missing_lock_entry_name_unverified(self):
        rows = _resolve_one([self._alias_repo()])
        self.assertEqual(rows[0]["reason"], "alias-package-identity-unverified")
        self.assertEqual(rows[0]["resolution"], "unresolved")


class TestNpmNestedLookup(unittest.TestCase):
    def test_nested_lock_in_sub(self):
        manifest = {"name": "consumer", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "apps/a": {"name": "consumer", "dependencies": {"alpha": "^1.0.0"}},
                "apps/a/node_modules/alpha": {
                    "version": "1.0.0",
                    "resolved": "https://x/a.tgz",
                    "integrity": "sha512-abc",
                },
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("sub/package-lock.json", lock),
            _pkg_doc("sub/apps/a/package.json", manifest),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["resolution"], "locked-artifact")
        self.assertEqual(rows[0]["locked"]["location"], "apps/a/node_modules/alpha")

    def test_nested_prefers_nearest(self):
        manifest = {"name": "consumer", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "apps/a": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {
                    "version": "9.9.9",
                    "resolved": "https://x/root.tgz",
                    "integrity": "sha512-root",
                },
                "apps/a/node_modules/alpha": {
                    "version": "1.0.0",
                    "resolved": "https://x/nearest.tgz",
                    "integrity": "sha512-near",
                },
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("sub/package-lock.json", lock),
            _pkg_doc("sub/apps/a/package.json", manifest),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["locked"]["version"], "1.0.0")
        self.assertEqual(rows[0]["locked"]["location"], "apps/a/node_modules/alpha")

    def test_nested_shadow_fail_on_mismatch(self):
        manifest = {"name": "consumer", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "apps/a": {"dependencies": {"alpha": "^2.0.0"}},  # mismatch
                "node_modules/alpha": {
                    "version": "9.9.9",
                    "resolved": "https://x/root.tgz",
                    "integrity": "sha512-root",
                },
                "apps/a/node_modules/alpha": {
                    "version": "1.0.0",
                    "resolved": "https://x/nearest.tgz",
                    "integrity": "sha512-near",
                },
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("sub/package-lock.json", lock),
            _pkg_doc("sub/apps/a/package.json", manifest),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "lock-declaration-mismatch")


class TestNpmLocalLinks(unittest.TestCase):
    def _base(self, lock=None, target_path="packages/alpha"):
        manifest = {"name": "root", "dependencies": {"alpha": "file:../packages/alpha"}}
        target = {"name": "alpha", "version": "0.0.0"}
        docs = [
            _pkg_doc("app/package.json", manifest),
            _pkg_doc(f"{target_path}/package.json", target),
        ]
        if lock is not None:
            docs.append(_pkg_doc("app/package-lock.json", lock))
        return _repo("r", "r", _sha40("c"), docs)

    def test_local_target_selected(self):
        repo = self._base(target_path="packages/alpha")
        # manifest at app/package.json; file:../packages/alpha -> packages/alpha
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["resolution"], "local-source-reference")
        self.assertEqual(rows[0]["source"]["manifest"], "packages/alpha/package.json")

    def test_local_target_not_selected(self):
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("app/package.json", {"name": "root", "dependencies": {"alpha": "file:../packages/alpha"}}),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-target-not-selected")

    def test_local_escape_rejected(self):
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", {"name": "root", "dependencies": {"alpha": "file:../../outside"}}),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-path-escape")

    def test_local_name_mismatch(self):
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", {"name": "root", "dependencies": {"alpha": "file:./packages/alpha"}}),
            _pkg_doc("packages/alpha/package.json", {"name": "beta"}),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-target-name-mismatch")

    def test_local_lock_conflict(self):
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "file:../packages/alpha"}},
                "node_modules/alpha": {"resolved": "../packages/beta", "link": True},
            },
        }
        repo = self._base(lock=lock, target_path="packages/alpha")
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-lock-mismatch")
        self.assertEqual(rows[0]["resolution"], "unresolved")

    def test_local_lock_nonlink_entry_mismatch(self):
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "file:../packages/alpha"}},
                "node_modules/alpha": {"version": "1.0.0", "resolved": "https://x/a.tgz",
                                        "integrity": "sha512-abc"},
            },
        }
        repo = self._base(lock=lock)
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-lock-mismatch")
        self.assertEqual(rows[0]["resolution"], "unresolved")

    def test_local_link_matches(self):
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "file:../packages/alpha"}},
                "node_modules/alpha": {"resolved": "../packages/alpha", "link": True, "name": "alpha"},
            },
        }
        repo = self._base(lock=lock, target_path="packages/alpha")
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["resolution"], "local-source-reference")
        self.assertEqual(rows[0]["source"]["manifest"], "packages/alpha/package.json")


class TestNpmWorkspaces(unittest.TestCase):
    def test_workspace_link_resolved(self):
        manifest = {"name": "root", "dependencies": {"alpha": "workspace:*"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "workspace:*"}},
                "node_modules/alpha": {"resolved": "packages/alpha", "link": True, "name": "alpha"},
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
            _pkg_doc("packages/alpha/package.json", {"name": "alpha", "version": "0.0.0"}),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["resolution"], "local-source-reference")
        self.assertEqual(rows[0]["source"]["manifest"], "packages/alpha/package.json")

    def test_workspace_link_missing_lock(self):
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", {"name": "root", "dependencies": {"alpha": "workspace:*"}}),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "missing-or-unsupported-lockfile")

    def test_workspace_target_not_selected(self):
        manifest = {"name": "root", "dependencies": {"alpha": "workspace:*"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "workspace:*"}},
                "node_modules/alpha": {"resolved": "packages/alpha", "link": True, "name": "alpha"},
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-target-not-selected")


class TestShrinkwrapPrecedence(unittest.TestCase):
    def test_shrinkwrap_wins(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {"version": "1.0.0", "resolved": "https://x/a.tgz",
                                        "integrity": "sha512-lock"},
            },
        }
        shrink = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {"version": "1.0.0", "resolved": "https://x/a.tgz",
                                        "integrity": "sha512-shrink"},
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
            _pkg_doc("npm-shrinkwrap.json", shrink),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["locked"]["integrity"], "sha512-shrink")


class TestCargo(unittest.TestCase):
    def test_cargo_dependency_string(self):
        manifest = {
            "package": {"name": "root"},
            "dependencies": {"alpha": "1.0"},
        }
        repo = _repo("r", "r", _sha40("c"), [_pkg_doc("Cargo.toml", manifest)])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["name"], "alpha")
        self.assertEqual(rows[0]["packageName"], "alpha")
        self.assertEqual(rows[0]["requested"], "1.0")
        self.assertEqual(rows[0]["reason"], "cargo-lock-resolution-unsupported")

    def test_cargo_renamed_path(self):
        manifest = {
            "package": {"name": "root"},
            "dependencies": {"alpha": {"package": "real-alpha", "path": "../real-alpha"}},
        }
        target = {"package": {"name": "real-alpha", "version": "0.1.0"}}
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("app/Cargo.toml", manifest),
            _pkg_doc("real-alpha/Cargo.toml", target),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["name"], "alpha")
        self.assertEqual(rows[0]["packageName"], "real-alpha")
        self.assertEqual(rows[0]["resolution"], "local-source-reference")
        self.assertEqual(rows[0]["source"]["manifest"], "real-alpha/Cargo.toml")

    def test_cargo_path_version(self):
        manifest = {
            "package": {"name": "root"},
            "dependencies": {"alpha": {"version": "0.1", "path": "../alpha"}},
        }
        target = {"package": {"name": "alpha", "version": "0.1.0"}}
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("app/Cargo.toml", manifest),
            _pkg_doc("alpha/Cargo.toml", target),
        ])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["resolution"], "local-source-reference")
        self.assertEqual(rows[0]["requested"]["version"], "0.1")

    def test_cargo_path_not_selected(self):
        manifest = {
            "package": {"name": "root"},
            "dependencies": {"alpha": {"path": "../alpha"}},
        }
        repo = _repo("r", "r", _sha40("c"), [_pkg_doc("app/Cargo.toml", manifest)])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "local-target-not-selected")

    def test_cargo_workspace_unsupported(self):
        manifest = {
            "package": {"name": "root"},
            "dependencies": {"alpha": {"workspace": True}},
        }
        repo = _repo("r", "r", _sha40("c"), [_pkg_doc("Cargo.toml", manifest)])
        rows = _resolve_one([repo])
        self.assertEqual(rows[0]["reason"], "workspace-inheritance-unsupported")

    def test_cargo_target_specific(self):
        manifest = {
            "package": {"name": "root"},
            "target": {
                "cfg(unix)": {"dependencies": {"alpha": "1.0"}},
            },
        }
        repo = _repo("r", "r", _sha40("c"), [_pkg_doc("Cargo.toml", manifest)])
        rows = _resolve_one([repo])
        scopes = [r["scope"] for r in rows]
        self.assertIn("target:cfg(unix):dependencies", scopes)
        self.assertEqual(rows[0]["requested"], "1.0")


class TestCargoFixtureCrossRepo(unittest.TestCase):
    def test_cargo_cross_repo_sibling(self):
        # ../other resolves to sibling repo `other` at workspace path other/
        lib_manifest = {
            "package": {"name": "lib"},
            "dependencies": {"alpha": {"path": "../other"}},
        }
        other_manifest = {"package": {"name": "alpha", "version": "0.1.0"}}
        lib = _repo("lib", "lib", _sha40("a"), [_pkg_doc("Cargo.toml", lib_manifest)])
        other = _repo("other", "other", _sha40("b"), [_pkg_doc("Cargo.toml", other_manifest)])
        rows = _resolve_one([lib, other])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["resolution"], "local-source-reference")
        self.assertEqual(rows[0]["source"]["repo"], "other")
        self.assertEqual(rows[0]["source"]["manifest"], "Cargo.toml")


class TestIdentityAndDeterminism(unittest.TestCase):
    def test_artifact_uses_resolved_sha_for_identity(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        resolved = "https://user:pass@example.com/a.tgz?token=secret#frag"
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {
                    "version": "1.0.0",
                    "resolved": resolved,
                    "integrity": "sha512-abc",
                },
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        rows = _resolve_one([repo])
        locked = rows[0]["locked"]
        # Displayed resolved URL must not contain userinfo/query/fragment
        self.assertNotIn("secret", locked["resolved"])
        self.assertNotIn("user:pass", locked["resolved"])
        # resolvedSha256 preserves identity of the original
        expected_sha = hashlib.sha256(resolved.encode()).hexdigest()
        self.assertEqual(locked["resolvedSha256"], expected_sha)

    def test_deterministic_regardless_of_input_order(self):
        manifest1 = {"name": "a", "dependencies": {"alpha": "^1.0.0"}}
        manifest2 = {"name": "b", "dependencies": {"beta": "^1.0.0"}}
        docs1 = [_pkg_doc("a/package.json", manifest1)]
        docs2 = [_pkg_doc("b/package.json", manifest2)]
        r1 = _repo("r1", "r1", _sha40("1"), docs1)
        r2 = _repo("r2", "r2", _sha40("2"), docs2)
        out1 = resolve_dependencies([r1, r2])
        out2 = resolve_dependencies([r2, r1])
        self.assertEqual(out1, out2)

    def test_no_input_mutation(self):
        manifest = {"name": "root", "dependencies": {"alpha": "^1.0.0"}}
        lock = {
            "lockfileVersion": 3,
            "packages": {
                "": {"dependencies": {"alpha": "^1.0.0"}},
                "node_modules/alpha": {
                    "version": "1.0.0",
                    "resolved": "https://x/a.tgz",
                    "integrity": "sha512-abc",
                },
            },
        }
        repo = _repo("r", "r", _sha40("c"), [
            _pkg_doc("package.json", manifest),
            _pkg_doc("package-lock.json", lock),
        ])
        before = copy.deepcopy(repo)
        resolve_dependencies([repo])
        self.assertEqual(repo, before)

    def test_optional_overrides_dependencies(self):
        manifest = {
            "name": "root",
            "dependencies": {"alpha": "^1.0.0"},
            "optionalDependencies": {"alpha": "^2.0.0"},
        }
        repo = _repo("r", "r", _sha40("c"), [_pkg_doc("package.json", manifest)])
        rows = _resolve_one([repo])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["requested"], "^2.0.0")
        self.assertEqual(rows[0]["scope"], "optionalDependencies")


class TestAdversarialContract(unittest.TestCase):
    def base(self):
        return TestNpmBasics()._basic_repo()

    def test_duplicate_producers_never_choose_source_for_tarball(self):
        repo = self.base()
        producers = [_repo(name, name, _sha40(name), [_pkg_doc("package.json", {"name": "alpha", "version": "1.0.0"})]) for name in ["one", "two"]]
        row = resolve_dependencies([repo, *producers])[0]
        self.assertEqual(row["resolution"], "locked-artifact")
        self.assertIsNone(row["source"])
        self.assertEqual(len(row["producerCandidates"]), 2)
        self.assertFalse(row["installedVerified"])
        self.assertEqual(row["sourceProvenance"], "unverified")

    def test_nearest_malformed_entry_does_not_use_parent(self):
        repo = self.base()
        repo["documents"][0]["path"] = "sub/package.json"
        packages = repo["documents"][1]["data"]["packages"]
        packages["sub"] = copy.deepcopy(packages[""])
        packages["sub/node_modules/alpha"] = "broken"
        row = resolve_dependencies([repo])[0]
        self.assertEqual(row["reason"], "locked-entry-shape")
        self.assertIsNone(row["locked"])

    def test_preferred_invalid_lock_shadows_valid_outer_lock(self):
        for data in [{"lockfileVersion": 1}, {"lockfileVersion": 3, "packages": []}, {"lockfileVersion": 3, "packages": {}}]:
            repo = self.base()
            repo["documents"][0]["path"] = "sub/package.json"
            repo["documents"].append(_pkg_doc("sub/npm-shrinkwrap.json", data))
            row = resolve_dependencies([repo])[0]
            self.assertEqual(row["resolution"], "unresolved")
            self.assertIn("sub/npm-shrinkwrap.json", [e["path"] for e in row["evidence"]])

    def test_file_path_between_selected_repositories_is_only_reference(self):
        consumer = _repo("consumer", "consumer", _sha40("a"), [_pkg_doc("package.json", {"dependencies": {"alpha": "file:../producer"}})])
        producer = _repo("producer", "producer", _sha40("b"), [_pkg_doc("package.json", {"name": "alpha"})])
        row = resolve_dependencies([consumer, producer])[0]
        self.assertEqual(row["source"], {"repo": "producer", "commit": producer["commit"], "manifest": "package.json"})
        self.assertEqual(len(row["evidence"]), 2)
        self.assertFalse(row["installedVerified"])
        self.assertEqual(row["resolution"], "local-source-reference")
        producer["path"] = "unrelated-worktree"
        self.assertEqual(resolve_dependencies([consumer, producer])[0]["reason"], "local-target-not-selected")

    def test_local_file_with_stale_metadata_cannot_resolve(self):
        repo = TestNpmLocalLinks()._base(lock={"lockfileVersion": 3, "packages": {"": {"dependencies": {"alpha": "WRONG"}}, "node_modules/alpha": {"link": True, "resolved": "../packages/alpha"}}})
        self.assertEqual(resolve_dependencies([repo])[0]["reason"], "lock-declaration-mismatch")

    def test_optional_override_but_distinct_peer_scope_retained(self):
        repo = self.base()
        manifest = repo["documents"][0]["data"]
        manifest["optionalDependencies"] = {"alpha": "^2"}
        manifest["peerDependencies"] = {"alpha": "^3"}
        rows = resolve_dependencies([repo])
        self.assertEqual({r["scope"]: r["requested"] for r in rows}, {"optionalDependencies": "^2", "peerDependencies": "^3"})

    def test_sha256_commits_and_limits(self):
        repo = self.base()
        repo["commit"] = _sha64("git-sha256")
        self.assertEqual(resolve_dependencies([repo])[0]["consumer"]["commit"], repo["commit"])
        for path in ["", "../r", "r//x", "r/./x", "r/hidden/../x"]:
            bad = copy.deepcopy(repo)
            bad["path"] = path
            with self.assertRaises(ValueError):
                resolve_dependencies([bad])
        repo["documents"][0]["data"]["description"] = "x" * 65537
        with self.assertRaises(ValueError):
            resolve_dependencies([repo])

    def test_non_http_urls_redacted_and_inputs_unchanged(self):
        for scheme in ["https", "git+https", "ssh", "git+ssh", "git"]:
            url = scheme + "://PRIVATE_USER:PRIVATE_PASS@host.invalid/repo?PRIVATE_QUERY#PRIVATE_FRAGMENT"
            repo = _repo("r", "r", _sha40("a"), [_pkg_doc("Cargo.toml", {"package": {"name": "r"}, "dependencies": {"x": {"git": url}}})])
            before = copy.deepcopy(repo)
            row = resolve_dependencies([repo])[0]
            self.assertNotIn("PRIVATE", repr(row))
            self.assertEqual(repo, before)


class TestReviewRegressions(unittest.TestCase):
    def local(self, requested):
        return [_repo("a", "a", _sha40("a"), [_pkg_doc("Cargo.toml", {"dependencies": {"x": requested}})]),
                _repo("b", "b", _sha40("b"), [_pkg_doc("Cargo.toml", {"package": {"name": "x"}})])]

    def test_malformed_features_and_common_keys_rejected(self):
        for bad in [{"features": {}}, {"features": [False]}, {"default-features": "true"}, {"registry": []}, {"unsupported": {}}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                resolve_dependencies(self.local({"path": "../b", **bad}))

    def test_cargo_registry_plus_path_explicitly_unsupported(self):
        row = resolve_dependencies(self.local({"path": "../b", "version": "1", "registry": "private"}))[0]
        self.assertEqual(row["reason"], "cargo-multiple-source-unsupported")
        self.assertIsNone(row["source"])

    def test_registry_declaration_cannot_become_source_through_link(self):
        repo = TestNpmBasics()._basic_repo()
        repo["documents"][1]["data"]["packages"]["node_modules/alpha"] = {"link": True, "resolved": "lib"}
        repo["documents"].append(_pkg_doc("lib/package.json", {"name": "alpha"}))
        row = resolve_dependencies([repo])[0]
        self.assertEqual(row["reason"], "unexpected-link-for-nonlocal-declaration")
        self.assertIsNone(row["source"])

    def test_local_declaration_survives_missing_lock_occurrence(self):
        lock = {"lockfileVersion": 3, "packages": {"": {"dependencies": {"alpha": "file:../packages/alpha"}}}}
        row = resolve_dependencies([TestNpmLocalLinks()._base(lock=lock)])[0]
        self.assertEqual(row["resolution"], "local-source-reference")
        self.assertEqual(len(row["evidence"]), 3)

    def test_name_mismatch_retains_target_evidence(self):
        rows = self.local({"path": "../b"})
        rows[1]["documents"][0]["data"]["package"]["name"] = "wrong"
        row = resolve_dependencies(rows)[0]
        self.assertEqual(row["reason"], "local-target-name-mismatch")
        self.assertEqual(len(row["evidence"]), 2)
        self.assertIsNone(row["source"])

    def test_lone_surrogate_and_expanded_output_bound(self):
        with self.assertRaisesRegex(ValueError, "Malformed"):
            resolve_dependencies(self.local(chr(0xD800)))
        from unittest.mock import patch
        with patch('scripts.ecosystem_resolution.MAX_OUTPUT', 32), self.assertRaises(ValueError):
            resolve_dependencies(self.local("1"))

    def test_requested_display_has_identity_digest_and_malformed_url_hidden(self):
        request = {"git": "https://host.invalid/repo SECRET"}
        row = resolve_dependencies(self.local(request))[0]
        self.assertNotIn("SECRET", repr(row))
        self.assertEqual(len(row["requestedSha256"]), 64)


if __name__ == "__main__":
    unittest.main()
