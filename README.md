# App Requests

A first-party Civitai App Block: a community voting board where anyone suggests
an app or feature they'd like on Civitai and up-votes others' ideas.

> This is a Civitai **onsite App Block** — it runs in-platform at
> `app-requests.civit.ai`, embedded by the Civitai host. Open it via
> [`civitai.com/apps/run/app-requests`](https://civitai.com/apps/run/app-requests),
> not the bare subdomain. See the [Civitai developer docs](https://developer.civitai.com).

## What this is

A sandboxed page app served in an iframe by the Civitai host, built entirely on
the **shared-storage** platform:

- **`useSharedStorage()`** — the per-app, CROSS-USER store. `append()` a
  `{ title, body? }` idea, `list()` the board (newest-first, cursor-paged),
  `vote()` / `unvote()` (up-only, one per user, server-enforced), `update()`
  your own entry in place (fixes a typo without losing votes), `withdraw()`
  your own entry.
- **`useAppStorage()`** — the per-viewer KV, used to remember which entries the
  viewer voted for (the shared API doesn't expose "did I vote"), reconciled with
  the counts `vote()` / `unvote()` return.
- **`user:read:self`** — to show the viewer (own entries get edit + withdraw
  affordances; the author label shows `you` vs `user #N`).
- **`useBlockAnalytics()`** — fire-and-forget submit / vote / withdraw / edit /
  sort / error-boundary events to the host's analytics pipeline.

No Buzz, no generation. Scopes (must match `block.manifest.json`):
`apps:storage:read`, `apps:storage:write` (the per-viewer KV),
`apps:storage:shared:read`, `apps:storage:shared:write` (the cross-user board),
and `user:read:self`.

**Sorting.** The board defaults to **Newest** (the server's truthful order).
**Top** ranks by vote count; because the server exposes no rank/order param, Top
runs a *bounded whole-board scan* (pages forward up to a cap) so a high-vote item
on a later page still rises — and says so when the board exceeds the scan window.
A server-side ranked read of the shared store is the proper upstream fix.

**Resilience.** The app root wraps a recoverable error boundary inside a
`BlockGate`, so a single malformed row can't white-screen the iframe (a **Try
again** recovers), and a direct load of `app-requests.civit.ai` degrades to an
"Open on Civitai" landing.

The server enforces a min-trust gate (account age ≥7d, verified, not muted,
onboarded) on writes/votes and moderates `append` / `update` content (title
≤200, body ≤4KB, HTML stripped, NSFW/minor blocked) — moderation is
server-authoritative. The UI surfaces a friendly message on the trust gate and
the server's own message on a content rejection (inline for form errors, a Toast
for async vote/edit/withdraw errors), and never crashes on a rejected
write/vote/edit. User text is rendered as escaped React children (no HTML
injection).

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
reconcile, one-vote-per-user, own-row edit via `update()` + own-row withdraw,
Top cross-page ranking, trust-gate + content errors, SegmentedControl tablist
a11y, `--civitai-color-*` token-render smoke, recoverable error boundary, anon
read-only), plus an e2e suite that drives the real `<App/>` against the SDK
mock host over the actual postMessage transport.

## Submit

```bash
civitai login        # once
civitai app submit   # packages manifest + src + build config (platform rebuilds)
```

## Links

- Developer docs — [developer.civitai.com](https://developer.civitai.com)
- Live app — [app-requests.civit.ai](https://app-requests.civit.ai)
- SDK contract — [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk)
- React hooks + UI pack — [`@civitai/blocks-react`](https://www.npmjs.com/package/@civitai/blocks-react)
- CLI — [`github.com/civitai/cli`](https://github.com/civitai/cli)
