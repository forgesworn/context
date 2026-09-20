# Extraction evidence

Prepared from forgesworn/kithmoot commit `2f5166fa067c61200e1d6ffe856ead246f3a6d0f`.
The source checkout was clean. A separate no-hardlink clone was filtered to
`packages/context`, `packages/context-tools`, root LICENSE and the standalone
package smoke test. Original package commits and attribution are retained in
rewritten history; commit IDs necessarily change. The source checkout was not
modified. The local filter-repo commit map is under `.git/filter-repo`.

This checkout is a prepared extraction, not a published replacement release.
No remote is configured and no npm version is published. The proposed remote
is forgesworn/context. Version 0.2.0 is retained for compatibility testing only;
a future publish must use a new package version with verified consumer pins.

Package names, exports, signed/encrypted wire formats, source implementation,
licences and notices are unchanged. Repository metadata and workspace build
scaffolding are updated. KithMoot UI/adapters remain in KithMoot; Oathrun keeps
its pinned verifier until a separately verified provenance update.


Validation completed on Node 24.21.0: both package builds passed; 16 core tests
across three files passed; the isolated real-tarball consumer smoke test passed.
Both extracted source directories are byte-identical to the source checkout.
The original KithMoot checkout remains clean. Oathrun/KithMoot consumer cutover,
new-remote publication and a new npm release remain pending.
