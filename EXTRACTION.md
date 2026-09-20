# Extraction evidence

## Multi-repository ecosystems and Markdown

`scanEcosystem` reads a versioned explicit manifest and emits deterministic
repository, package, Markdown-document and Markdown-section evidence. Stable
repository IDs keep signed `repo://` sources portable across machines. Cross-repo
package edges require a globally unique package name; Markdown edges require an
explicit relative `.md` link that remains inside the selected repository.

This is syntactic extraction, not semantic agreement: headings and prose are
reviewable evidence and relations remain assertions. Fenced code, remote links,
ambiguous packages, unretained targets and escaping links do not become graph
edges. Existing signed graph queries can traverse the retained records without
fetching their sources or contacting an LLM.

## Provenance and confidence

Records may carry signed `provenance` containing a derivation label
(`extracted`, `inferred` or `ambiguous`), a stable method identifier and an
integer confidence from 0 to 100. Confidence describes the strength of the
stated extraction method, not whether the underlying claim is true or whether
an actor is authorised to rely on it.

TypeScript/JavaScript syntax records use `typescript-ast`; package manifests,
ecosystem manifests and source files are direct extraction. Broad-language
declarations use bounded lexical inference, while heuristic local-import file
records are explicitly marked ambiguous. Provenance is signed, encrypted,
retrieved and included in bounded graph output with the record.

Prepared from forgesworn/kithmoot commit `2f5166fa067c61200e1d6ffe856ead246f3a6d0f`.
The source checkout was clean. A separate no-hardlink clone was filtered to
`packages/context`, `packages/context-tools`, root LICENSE and the standalone
package smoke test. Original package commits and attribution are retained in
rewritten history; commit IDs necessarily change. The source checkout was not
modified. The local filter-repo commit map is under `.git/filter-repo`.

The extracted repository is published at https://github.com/forgesworn/context.
No replacement npm version has been published. Version 0.2.0 was retained for
compatibility testing only; version 0.3.0 is prepared for the first standalone
release and still requires registry authentication and verified consumer pins.

Package names, exports, signed/encrypted wire formats, source implementation,
licences and notices are unchanged. Repository metadata and workspace build
scaffolding are updated. KithMoot UI/adapters remain in KithMoot; Oathrun keeps
its pinned verifier until a separately verified provenance update.


Validation completed on Node 24.21.0: both package builds passed; 16 core tests
across three files passed; the isolated real-tarball consumer smoke test passed.
Both extracted source directories are byte-identical to the source checkout.
The original KithMoot checkout remains clean. Oathrun/KithMoot consumer cutover,
and a new npm release remain pending.

The standalone CI workflow originally passed on Node 22.13 and 24 at `55091b4`.
The supported runtime is now Node 24 LTS, pinned in `.nvmrc`:
https://github.com/forgesworn/context/actions/runs/35490548443.
The local combined `npm run check` also passed after publication.
