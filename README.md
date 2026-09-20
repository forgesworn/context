# ForgeSworn Context

Portable signed, encrypted project evidence, bounded retrieval and authorised
relationship graphs.

- `packages/context`: browser-safe core, published as `@forgesworn/context`.
- `packages/context-tools`: Node persistence, CLI and MCP, published as
  `@forgesworn/context-tools`.

Both are MIT licensed. Provider routing, worker execution and application UI
belong to consumers, not this library. No model provider is required by core.

The formats and APIs are project-agnostic. A collection can describe one
repository or an explicitly assembled ecosystem; graph operations never make
another collection visible or turn an extracted relationship into authority.

Use Node 24 LTS. The repository pins the currently validated release in `.nvmrc`:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:packages
```

The smoke test builds real tarballs and installs them outside the workspace to
check exports, browser isolation, CLI/MCP behaviour and licence notices.
See [extraction evidence](EXTRACTION.md) for provenance and publication status.
