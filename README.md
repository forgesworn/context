# ForgeSworn Context

Portable signed, encrypted project evidence and bounded retrieval.

- `packages/context`: browser-safe core, published as `@forgesworn/context`.
- `packages/context-tools`: Node persistence, CLI and MCP, published as
  `@forgesworn/context-tools`.

Both are MIT licensed. Provider routing, worker execution and application UI
belong to consumers, not this library. No model provider is required by core.

Use Node 22.13 or later (Node 24 tested):

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:packages
```

The smoke test builds real tarballs and installs them outside the workspace to
check exports, browser isolation, CLI/MCP behaviour and licence notices.
See [extraction evidence](EXTRACTION.md) for provenance and publication status.
