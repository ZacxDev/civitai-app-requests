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
  Each listed row also carries **`viewerVoted`**, the server's own answer to
  "has this viewer voted on this row" — which is what the vote button hydrates
  from. (The app used to keep a per-viewer KV set of voted keys instead; that
  store could not know about a vote cast on another device or before it existed,
  which is what produced the *double-click to unvote* bug. It is gone, along
  with the two `apps:storage:*` scopes it needed.)
- **`report(key)`** — files a row for **Civitai moderator** review. Filing a
  report does not hide the row; a moderator decides.
- **`user:read:self`** — to identify the viewer (own entries get edit +
  withdraw; the app owner additionally gets the hide affordance below).
- **`useBlockAnalytics()`** — fire-and-forget submit / vote / withdraw / edit /
  sort / error-boundary events to the host's analytics pipeline.

No Buzz, no generation. Scopes (must match `block.manifest.json`):
`apps:storage:shared:read`, `apps:storage:shared:write` (the cross-user board),
and `user:read:self`.

**Sorting.** The board defaults to **Top** — which ideas people want most is the
whole point of the board, so that is the primary object. Because the server
exposes no rank or order param, Top is a *client-side ranking over a bounded
scan*: the app pages forward up to 8 pages of 25 (200 rows), then ranks the
whole loaded window. First paint still costs exactly **one** round-trip — page 1
is rendered before the scan continues in the background — so making Top the
default did not move the scan onto the critical path.

**Search** filters the loaded rows (fuzzy, title and body, AND semantics across
words) and preserves the active order rather than re-ranking on relevance.

🔴 **Both are honest about their horizon.** Ranking and search share one
disclosure (`src/disclosure.ts`): whenever the server still has rows the app
never loaded, the board says so in as many words. A filter that silently misses
a row reads as "no such request exists", which is a lie the board cannot afford.
A server-side ranked/searchable read of the shared store is the proper upstream
fix.

**Moderation.** Any signed-in viewer can **Report** a row to Civitai moderators.
The app owner additionally gets **Hide from board** — and that is a *suppression*,
not a deletion. The platform gives an app owner no delete (`update`/`withdraw`
are author-scoped and reject `FORBIDDEN` for anyone else), so a hide is an
owner-authored ledger entry that every client honours by filtering the target
out. **The request, its text and its votes remain on the server.** The security
boundary is the `authorUserId` check on that entry — anyone can append a
ledger-*shaped* row, because `data` is unmoderated — so a forged record is
ignored as a suppression and is never rendered as a request either. See
`src/moderation.ts`.

**Brand.** The app runs at `brandDepth: skin` (see `taste.json`): it owns its
own palette (`src/brand.ts`) rather than inheriting the host's `--civitai-*`
surface tokens, and re-points the design-system pack at it so pack components
read as one system. That transfers light/dark correctness to this repo, so every
text-on-surface pair is asserted in **both** themes against a real WCAG contrast
implementation. The host still supplies the theme via `[data-theme]` on the
block root — only the values behind it are the app's.

**Hero.** `src/assets/hero.jpg`, rendered by `<Hero>`. Swapping it is a one-file
change; nothing else references the artwork. 🔴 The band does **not** render at
the asset's aspect ratio — its height is a min-height and its width is the host
iframe's, so `object-fit: cover` crops the artwork by a width-dependent amount
and no composition can be relied on to keep bright art away from the title or
the CTA. Legibility is therefore structural: a uniform scrim floor plus an
opaque plate under the action, both measured against the brightest pixel in the
committed asset and asserted as real WCAG ratios in `src/hero.test.ts`. Swapping
the artwork means re-measuring `HERO_ART_BRIGHTEST`.

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

Coverage, in three layers:

- **Unit** (node, no DOM) — the palette and its WCAG contrast in both themes,
  the fuzzy matcher's score bands, the moderation ledger (including the forged
  record), the horizon copy as literal strings, and the motion budget.
- **Component** (jsdom) — every new control, including the overflow menu's full
  keyboard contract (`aria-expanded`, roving tab index, ArrowUp/Down wrapping,
  Home/End, Escape and item-select both restoring focus to the trigger).
- **Integration** against the SDK mock host over the real postMessage transport,
  including **failure injection** (`shared.failNext` forces `SHARED_UNAVAILABLE`
  — the rejected vote, append and report paths) and the anonymous viewer.

Both themes and `prefers-reduced-motion` are asserted *behaviourally* against
the mounted app — what the elements do, never that an attribute or a media query
exists.

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
