// Version 3 reviewer rubrics for the six structured D5 tasks: version 2 with every required point
// limited to what the task prompt asks for. Points the prompt does not ask for are "not required"
// and fail only when contradicted. Same dimension ids, prompts, required evidence and checker.
export const reviewerRules = [
  'Judge each dimension against the whole answer: the summary and every finding. A required point stated under a different finding id counts; never fail a dimension for placement alone.',
  'A required point passes only when the answer states it explicitly, in words a reader could quote. Different wording is fine; a point that is only implied by other statements does not pass.',
  'Where a dimension lists items, each listed item must be named. A generic phrase such as "edge cases" or "all semantics unchanged" does not cover named items.',
  'A dimension passes when every required point is stated, no "fails if" condition applies and nothing it states contradicts the frozen source excerpts. Points marked "not required" never cause a failure. Accepted alternatives pass equally.',
]

export const rubrics = {
  'orientation-context': {
    'first-use': 'Required, both: (a) before any refresh, status reports freshness "unavailable"; (b) an explicit refresh builds and publishes an in-memory generation. Not required: manifest or hashing details.',
    'search-gate': 'Required: search is rejected unless policy freshness is "current", which rejects unavailable, stale and unknown policy. Stating the general condition ("policy must be current", "!== \'current\'") covers all three states. Fails if: only some states are named and the general condition is not stated. Not required: that stale source alone does not block search.',
    freshness: 'Required: search re-checks the policy before it returns results or consumes a cursor, so a policy change made during a search blocks it. Not required: that search also re-inspects source freshness to label results, or that stale source alone does not block search. Fails if: the answer says a policy change during a search goes undetected.',
    continuation: 'Required, all three bounds: (a) a cursor is single-use, consumed only when a continuation succeeds; (b) it expires after five minutes; (c) at most 128 cursors are live. Not required: that a cursor is bound to its generation and search term, or that refresh clears cursors.',
    trust: 'Required: results are marked local-source-unsigned, as unsigned local evidence distinct from signed context records. Not required: that source is data, not instructions, or grants no authority. Fails if: the answer calls navigation results signed or treats them as signed evidence.',
  },
  'orientation-kithmoot': {
    adapter: 'Required: ContextVault wraps (extends) the portable context vault and always supplies KithMoot\'s verifyDelegation, through kithmootContextOptions, whatever the caller passes.',
    ownership: 'Required, both, attributed to verifyDelegation in src/context.ts: (a) it first rejects a proof whose agent field does not equal options.agent; (b) it then calls verifyAgentOwnership. Fails if: only verifyAgentOwnership\'s internal checks are described, or the agent check is attributed only to verifyAgentOwnership.',
    storage: 'Required: ContextFileStore in src/node/context-store.ts extends or wraps the portable file store and constructs it with kithmootContextOptions(options).',
    writes: 'Required: all five tools are named as entering store.run with the write flag: context_create, context_append, context_import, context_upload and context_set_grants. Fails if: any of the five is missing. Not required: read-only tools.',
    'caller-boundary': 'Required: ContextVaultOptions is PortableOptions with verifyDelegation omitted (Omit<PortableOptions, \'verifyDelegation\'>), so callers cannot pass or select the room\'s trust policy.',
  },
  'diagnosis-context': {
    'root-cause': 'Required: inspectFreshness no longer re-inspects the policy after buildManifest has read the eligible source bytes, so it can report policy "current" after a change made during those reads. Fails if: the root cause is placed only in search() or its commit phase, or the answer says there is no source defect.',
    'lost-invariant': 'Required: a policy change during manifest construction (the freshness source reads) must make freshness inspection report the generation stale, or unknown, before search proceeds with old indexed results. Accepted alternative: freshness inspection must re-verify the policy after the source reads before reporting it current. Fails if: the invariant is placed only at search commit time; the commit-time re-check in search() is intact in the seeded tree, so that invariant was not lost.',
    'why-first-check-fails': 'Required: the discovery policy comparison in inspectFreshness runs before the source reads, so it cannot observe a policy change made during them.',
    repair: 'Required: restore a re-inspection of the same policy directories (reinspectPolicy over discovery.policyDirectories) inside inspectFreshness after buildManifest, returning stale when the revision differs and unknown when re-inspection fails, before the manifest is used. Fails if: the existing commit-phase reinspectPolicy in search() is named as the repair, or the answer says no source change is needed; that check is present in the seeded tree and does not correct status().',
    regression: 'Required: a test that fails on the seeded tree: tighten .gitignore while a source file handle is opened during freshness inspection and assert that status() (or inspectFreshness) reports the policy as stale or unknown, not current. Fails if: the only test proposed is the existing "blocks a policy change made during freshness source reads without consuming the cursor" search test, which passes on the seeded tree because the commit-time re-check still blocks the search. Keeping that test as well is fine.',
  },
  'diagnosis-kithmoot': {
    'root-cause': 'Required, both: (a) the seeded ContextVaultOptions is PortableOptions and so admits verifyDelegation; (b) kithmootContextOptions spreads caller options after installing KithMoot\'s verifier ({ verifyDelegation, ...options }), so a caller-supplied verifier overwrites it.',
    'trust-impact': 'Required: a caller-supplied verifier can approve forged or unrelated agent ownership, so grants that should be refused are accepted and the room adapter\'s grant boundary is weakened.',
    'repair-type': 'Required: ContextVaultOptions becomes Omit<PortableOptions, \'verifyDelegation\'> again.',
    'repair-merge': 'Required: kithmootContextOptions spreads caller options first and installs KithMoot\'s verifyDelegation last ({ ...options, verifyDelegation }).',
    regression: 'Required, both: (a) the test supplies a hostile verifyDelegation in the caller options; (b) it shows KithMoot\'s verifier is used rather than the hostile one, either by asserting what kithmootContextOptions returns or by showing that a forged proof the hostile verifier would approve is still rejected. Not required: naming the unsafe cast the repaired type makes necessary.',
  },
  'impact-context': {
    'request-surface': 'Required, both: optional caseSensitive is added to (a) the search options type (NavigationSearchOptions in repository-navigation.ts) and (b) the repository_search MCP input schema.',
    default: 'Required: omitted or false keeps today\'s behaviour: the term is normalised by normalizeTerm (lower-cased) and looked up in the case-insensitive postings, so existing callers see no change.',
    filter: 'Required: the postings are lower-case, so case-sensitive mode must filter candidate source lines for the exact-case token. Accepted alternatives: reuse the lower-case postings and post-filter the candidate lines, or add a separate case-preserving index, provided exact-case filtering of results is stated.',
    cursor: 'Required, both: (a) caseSensitive is stored in the Cursor; (b) continuing a cursor with a different mode is rejected.',
    response: 'Required: no point beyond the fails-if condition; the prompt does not ask about response fields, so an answer silent on them passes. Adding a separate field that reports the mode is allowed. Fails if: the answer proposes changing what an existing response field reports (for example echoing the raw-case term in term).',
    coverage: 'Required, all three named: (a) default matching stays case-insensitive; (b) case-sensitive mode returns only exact-case matches; (c) continuing a cursor in the other mode is rejected. Not required: MCP schema validation or pagination within one mode.',
  },
  'impact-kithmoot': {
    contract: 'Required: shortId returns the first eight characters only for exactly 64 lower-case hexadecimal characters, and [invalid-id] for every other input.',
    callers: 'Required: server/forwarder.mjs passes config.roomId and config.pubkey through shortId before startup logging.',
    privacy: 'Required, both: (a) the invalid marker is a constant; stating that the literal [invalid-id] is returned for all invalid input satisfies this; (b) it echoes no part of the input, including no prefix.',
    tests: 'Required, both: (a) the existing permissive expectations ("never returns more than it was given", which returns \'abcd\' and \'\' unchanged) must be replaced; (b) new cases cover valid canonical input and invalid input of at least three named classes (for example empty, short, long, upper-case, non-hex, Unicode). Not required: all six classes.',
    guard: 'Required, both: (a) the log-redaction scan (test/log-redaction-scan.test.ts) is retained and still rejects direct full-identifier logging; (b) the forwarder startup logging assertion is retained. Fails if: either is dismissed as unrelated or not mentioned.',
    compatibility: 'Required, both: (a) valid canonical 64-character lower-case hex identifiers keep the same eight-character display; (b) malformed configured identifiers now display as [invalid-id], visibly invalid, instead of a prefix.',
  },
}
