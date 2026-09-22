# Z1P open-core boundary

Z1P's product direction is a complete MIT developer tool with a separately
operated commercial offering. This file records the intended boundary so that free users,
contributors and customers do not have to infer it from pricing or deployment.
See [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) for the general developer
product, delivery order and current gaps. Oathrun is an optional consumer.

## Z1P Core: free and open source

This repository is Z1P Core and remains MIT licensed. Its scope includes:

- the signed and encrypted collection formats;
- local identity, grant, correction and verification behaviour;
- deterministic repository, ecosystem and source extraction;
- bounded retrieval and relationship-graph traversal;
- scalable local indexing, local automatic/incremental refresh and source packets;
- local graph exploration and visualisation;
- explicit repository, worktree and dependency-version selection;
- local file persistence, CLI and MCP operation;
- manual import, export, upload and access-envelope operations; and
- the tests and fixtures needed to inspect those trust boundaries.

This list defines the durable scope of the MIT core, including capabilities
still to build. It is not a statement that every item is implemented. Local
use must not require payment based on seats, private repositories or artificial
graph-size caps. Documented engineering/resource limits remain visible until
they can be safely improved.

Z1P Core runs locally without an account, subscription, model provider or
Z1P-operated service. It does not contain telemetry and does not silently send
source code, records or keys anywhere.

## Z1P Platform: commercial

The separately operated Z1P Platform may sell:

- managed repository and documentation connections;
- operated refresh scheduling, workers and recovery;
- hosted private MCP access;
- shared organisation graphs and team administration;
- managed pull-request integrations using the core's impact evidence;
- shared hosted exploration and operational history;
- third-party work-management and communication connectors;
- centrally operated retention policy, audit export, SSO/SCIM and administration;
- managed or customer-hosted deployment; and
- billing, service operation and support.

The commercial offering sells operation, administration, deployment and support.
The corresponding local engine and generally useful improvements stay MIT.
Enterprise-useful code distributed here also remains MIT; charging for hosting
or support does not require a proprietary developer feature tier. A separate
software licensing proposal would require an explicit future decision, not an
implicit expansion of this list. These offerings are proposed, not shipped.

Commercial operation does not alter the meaning of signatures produced by the
core or turn extracted relationships into proof of truth or authority. Correct
isolation, safe local defaults and portable export are not paid upgrades.

## Compatibility

The Z1P name is a product-level rebrand. Existing public identifiers remain
stable unless a separately documented major migration is justified:

- npm packages `@forgesworn/context` and `@forgesworn/context-tools`;
- the `encrypted-context` executable;
- MCP tools beginning with `context_`;
- exported `Context*` APIs; and
- signed domains, cache formats and `kithmoot/context/v1/*` wire names.

New Z1P-branded entry points may be added as aliases. They must not make an
existing signed object ambiguous or strand an installed consumer.

## Product principles

1. The MIT tool must remain complete and useful for independent local work,
   including use by developers employed by companies.
2. Private source and evidence remain local unless an operator explicitly
   configures a destination.
3. Paid plans may apply service limits, but must not retroactively disable the
   published local core.
4. Hosted claims must distinguish encryption, access control, availability and
   durable storage rather than collapsing them into "secure".
5. Public benchmarks must state their corpus, payload and comparison boundary.
