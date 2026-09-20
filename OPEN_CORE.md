# Z1P open-core boundary

Z1P has a free, inspectable local foundation and a separately operated
commercial product. This file records the intended boundary so that free users,
contributors and customers do not have to infer it from pricing or deployment.

## Z1P Core: free and open source

This repository is Z1P Core and remains MIT licensed. It includes:

- the signed and encrypted collection formats;
- local identity, grant, correction and verification behaviour;
- deterministic repository, ecosystem and source extraction;
- bounded retrieval and relationship-graph traversal;
- local file persistence, CLI and MCP operation;
- manual import, export, upload and access-envelope operations; and
- the tests and fixtures needed to inspect those trust boundaries.

Z1P Core runs locally without an account, subscription, model provider or
Z1P-operated service. It does not contain telemetry and does not silently send
source code, records or keys anywhere.

## Z1P Platform: commercial

The separately maintained Z1P Platform may provide:

- managed repository and documentation connections;
- automatic and incremental graph refresh;
- hosted private MCP access;
- shared organisation graphs and team administration;
- pull-request impact and review workflows;
- web exploration and operational history;
- third-party work-management and communication connectors;
- retention policy, audit export, SSO and enterprise controls;
- managed or customer-hosted deployment; and
- billing, service operation and support.

The commercial product sells continuous operation, collaboration, integration
and governance. It does not alter the meaning of signatures produced by the
core or turn extracted relationships into proof of truth or authority.

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

1. The free mode must remain genuinely useful for local individual work.
2. Private source and evidence remain local unless an operator explicitly
   configures a destination.
3. Paid plans may apply service limits, but must not retroactively disable the
   published local core.
4. Hosted claims must distinguish encryption, access control, availability and
   durable storage rather than collapsing them into "secure".
5. Public benchmarks must state their corpus, payload and comparison boundary.

