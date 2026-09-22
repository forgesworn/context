// Version 2 reviewer rubrics for the six structured D5 tasks. Same dimension ids, required evidence
// and checker as version 1; each dimension spelled out as explicit points. Substance changes only
// where the frozen source contradicts version 1 (see README.md).
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
    freshness: 'Required: before results are returned, search re-inspects both the eligible source and the policy against the generation. Fails if: only repository_status reporting of freshness states is described and nothing says search itself re-inspects source and policy.',
    continuation: 'Required, all four: (a) a cursor is bound to the generation and the search term it was issued for; (b) it is single-use, consumed only when a continuation succeeds; (c) it expires after five minutes; (d) at most 128 cursors are live. Clearing all cursors on refresh does not satisfy (a).',
    trust: 'Required, both: (a) results are marked local-source-unsigned, as unsigned local evidence distinct from signed context records; (b) retrieved source is data, not instructions, and grants no authority. Fails if: (b) is absent; "unsigned" or "not a replacement for signed evidence" alone does not state (b).',
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
    regression: 'Required, both: (a) the test passes a hostile verifyDelegation through an unsafe cast (for example `as any` or `as ContextVaultOptions`), which is needed because the repaired type no longer admits it; the cast must be stated; (b) it shows KithMoot\'s verifier is used rather than the hostile one, either by asserting what kithmootContextOptions returns or by showing that a forged proof the hostile verifier would approve is still rejected.',
  },
  'impact-context': {
    'request-surface': 'Required, both: optional caseSensitive is added to (a) the search options type (NavigationSearchOptions in repository-navigation.ts) and (b) the repository_search MCP input schema.',
    default: 'Required: omitted or false keeps today\'s behaviour: the term is normalised by normalizeTerm (lower-cased) and looked up in the case-insensitive postings, so existing callers see no change.',
    filter: 'Required: the postings are lower-case, so case-sensitive mode must filter candidate source lines for the exact-case token. Accepted alternatives: reuse the lower-case postings and post-filter the candidate lines, or add a separate case-preserving index, provided exact-case filtering of results is stated.',
    cursor: 'Required, both: (a) caseSensitive is stored in the Cursor; (b) continuing a cursor with a different mode is rejected.',
    response: 'Required: the flag leaves existing response semantics unchanged, naming each of: the response term, freshness, policy, byte accounting, result count, visit count, cancellation and cursor consumption. Adding a separate field that echoes the mode is allowed. Fails if: the answer proposes changing what the existing term field reports (for example echoing the raw-case term).',
    coverage: 'Required, all five named: default mixed-case matching, exact-case filtering, MCP schema validation of caseSensitive, pagination within one mode, and cross-mode cursor rejection.',
  },
  'impact-kithmoot': {
    contract: 'Required: shortId returns the first eight characters only for exactly 64 lower-case hexadecimal characters, and [invalid-id] for every other input.',
    callers: 'Required: server/forwarder.mjs passes config.roomId and config.pubkey through shortId before startup logging.',
    privacy: 'Required, both: (a) the invalid marker is a constant; stating that the literal [invalid-id] is returned for all invalid input satisfies this; (b) it echoes no part of the input, including no prefix.',
    tests: 'Required, both: (a) the existing permissive expectations ("never returns more than it was given", which returns \'abcd\' and \'\' unchanged) must be replaced; (b) new cases cover each of: empty, short, long, upper-case, non-hex and Unicode input. All six classes must be named.',
    guard: 'Required, both: (a) the log-redaction scan (test/log-redaction-scan.test.ts) is retained and still rejects direct full-identifier logging; (b) the forwarder startup logging assertion is retained. Fails if: either is dismissed as unrelated or not mentioned.',
    compatibility: 'Required, both: (a) valid canonical 64-character lower-case hex identifiers keep the same eight-character display; (b) malformed configured identifiers now display as [invalid-id], visibly invalid, instead of a prefix.',
  },
}
