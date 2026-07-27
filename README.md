# App Requests

A first-party Civitai App Block: a community voting board where anyone suggests
an app or feature they'd like on Civitai and up-votes others' ideas.

## What this is

A sandboxed page app served in an iframe by the Civitai host, built entirely on
the **shared-storage** platform:

- **`useSharedStorage()`** — the per-app, CROSS-USER store. `append()` a
  `{ title, body? }` idea, `list()` the board (newest-first, cursor-paged),
  `vote()` / `unvote()` (up-only, one per user, server-enforced), `withdraw()`
  your own entry.
- **`useAppStorage()`** — the per-viewer KV, used to remember which entries the
  viewer voted for (the shared API doesn't expose "did I vote"), reconciled with
  the counts `vote()` / `unvote()` return.
- **`user:read:self`** — to show the viewer (own entries get a withdraw
  affordance; the author label shows `you` vs `user #N`).

No Buzz, no generation. Scopes: `apps:storage:read`, `apps:storage:write`
(cover both the shared store and the per-viewer KV), `user:read:self`.

The server enforces a min-trust gate (account age ≥7d, verified, not muted,
onboarded) on writes/votes and moderates `append` content (title ≤200, body
≤4KB, HTML stripped, NSFW/minor blocked). The UI surfaces a friendly message on
the trust gate and the server's own message on a content rejection, and never
crashes on a rejected write/vote.

## Develop

```bash
npm install
npm run dev:harness   # http://localhost:5187 — SDK mock host, seeded shared board
```

The harness plays the civitai host locally via the published SDK
`createMockHost` (seeded with a small board). The `mock scenarios` panel can
toggle anonymous / signed-in and force the next mutation to fail. Nothing is
written to Civitai.

## Test + build

```bash
npm run test    # vitest: pure-logic (node) + component/e2e (jsdom) suites
npm run build   # tsc --noEmit && vite build → dist/
```

Tests mock the SDK storage hooks for deterministic coverage of every flow
(submit → append + refresh, list + load-more, vote/unvote optimistic +
reconcile, one-vote-per-user, own-row withdraw, trust-gate + content errors,
anon read-only), plus an e2e suite that drives the real `<App/>` against the SDK
mock host over the actual postMessage transport.

## Submit

```bash
civitai login        # once
civitai app submit   # packages manifest + src + build config (platform rebuilds)
```
