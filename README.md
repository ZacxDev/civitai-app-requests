# App Requests

A first-party Civitai App Block: a community voting board where anyone suggests
an app or feature they'd like on Civitai and up-votes others' ideas.

> This is a Civitai **onsite App Block** — it runs in-platform at
> `app-requests.civit.ai`, embedded by the Civitai host. Open it via
> [`civitai.com/apps/run/app-requests`](https://civitai.com/apps/run/app-requests),
> not the bare subdomain. See the [Civitai developer docs](https://developer.civitai.com).

## What this is

A sandboxed page app served in an iframe by the Civitai host, built on the App
Blocks **document store** — one shared collection, declared in
`block.manifest.json`:

```json
"storage": { "collections": {
  "requests": { "visibility": "shared", "write": "own", "marks": ["vote"] }
}}
```

- **`requests`** — every viewer reads it, signed in or not; a signed-in viewer
  `create`s a `{ title, body? }` request, and only its author can edit it in
  place (`put`, conditional on the version the board loaded, so a concurrent
  edit is refused rather than overwritten — votes survive an edit) or withdraw
  it (`delete`, which takes its votes with it).
- **`vote`** — a per-viewer mark: one per person per request, set with
  `mark(key, 'vote')` and taken back with `unmark`. The store keeps the tally
  and reports each viewer's own marks on every document, which is what the vote
  button hydrates from — a vote cast on another device shows as cast.
- **`report`** — the built-in mark on every shared collection. It files the
  request for **Civitai moderator** review; it does not hide it, and it cannot
  be withdrawn.
- **`user:read:self`** — whether the viewer is signed in. Authorship comes from
  the store itself (`author.isViewer`); no numeric user id ever reaches the app.
- **`useBlockAnalytics()`** — fire-and-forget submit / vote / withdraw / edit /
  sort / error-boundary events (a local no-op shim; see *Known gaps*).

No Buzz, no generation. Scopes (must match `block.manifest.json`):
**`apps:storage`** (read the board, vote, withdraw your own, report),
**`apps:storage:publish`** (consent-gated: posting or editing publishes the
viewer's text where everyone can read it — the board asks once, through the
host's consent dialog, the first time it is needed), and `user:read:self`.
`src/storage-manifest.test.ts` pins the names the code sends to the names the
manifest declares, and the scopes to exactly what the declaration needs.

**Sorting.** The board defaults to **Top** — which ideas people want most is the
whole point of the board. Both orders are the store's own sorts: Top is
`-mark:vote`, Newest is `-createdAt`, ties broken by key. Ranking is therefore
over the WHOLE board: the first page is the true top 25, first paint costs
exactly one round-trip, and switching order is a fresh query (a cursor belongs
to the order that issued it).

**Search** filters the loaded rows (fuzzy, title and body, AND semantics across
words) and preserves the active order rather than re-ranking on relevance.

🔴 **Search is honest about its horizon** (`src/disclosure.ts`): whenever the
server still has rows the board never loaded, the board says so in as many
words, and a no-match offers "Load more and search again". A filter that
silently misses a row reads as "no such request exists", which is a lie the
board cannot afford. (Top used to carry the same admission, back when it was a
client-side ranking over a bounded scan of a newest-first store; it no longer
needs one.)

**Moderation.** Any signed-in viewer can **Report** a request to Civitai
moderators. Moderation is the platform's: every create and edit passes the
store's content scanner, and a moderator can hide or delete a reported request,
after which it is simply not listed. The app owner has no hide of their own —
see *Known gaps*.

**Width.** The board lays out against **its own box**, not the browser window.
A block is an iframe in whatever slot the host gave it, and slot width is not
monotonic in viewport width — the `model.sidebar_top` slot is ~360px on a phone
and only ~430px on a 1440px desktop — so `useBlockBreakpoint(rootRef)` observes
the block root with a `ResizeObserver` and reports a tier on civitai's px scale
(`480 / 768 / 1024 / 1184 / 1440`, **not** Mantine's stock em scale, which agrees
on 768 alone). `src/layout.ts` is the only place a threshold is named:

| tier | toolbar | hero CTA | request row |
|---|---|---|---|
| `base` (< 480) | stacked, sort switcher full-width | own line, stretched | vote pill in the row's footer |
| `xs` (480–767) | stacked, sort switcher full-width | own line, stretched | vote pill back in the left rail |
| `sm`+ (≥ 768) | one row | inline, right-aligned | left rail — the 0.3.x layout, unchanged |

🔴 Two properties hold that together, and both are asserted rather than assumed.
**Unmeasured is not narrow:** the hook reports `tier: 'base'` before its first
measurement lands, which is indistinguishable from a 360px slot, so every
structural branch is gated on `measured` and the unmeasured frame renders the
regular layout — no paint-then-undo. And **the two arrangements differ in
arrangement only**: every element, every `data-testid` and every handler exists
at every tier, which is what keeps the store-capture recipe's `board-ready`
anchor and its two ordinal `sort-control` selectors valid at all widths.
Purely cosmetic scaling is `clamp()` in the inline styles rather than a
stylesheet media query — an inline style outranks any non-`!important` rule, so
a media query here would ship inert.

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
onboarded) on every write, vote and report, and scans every create and edit —
moderation is server-authoritative. Refusals arrive with a machine-readable
`code`, and `src/errors.ts` maps each code to viewer-facing copy
(`sign_in_required`, `not_eligible`, `consent_required`, `content_rejected`,
`version_conflict`, `not_found`, `rate_limited`, and the transient
`storage_disabled`/`service_unavailable` family) — inline for form errors, a
Toast for async vote/edit/withdraw errors — and never crashes on a rejected
call. The title (≤200) and details (≤4096) limits are enforced by the composer;
the store itself caps only the document's bytes. User text is rendered as
escaped React children (no HTML injection).

## Develop

The toolchain is pinned by a nix flake — `pnpm` and `node` are not expected on
`PATH` outside it. `.nvmrc` is the single authority for the node major: the
flake reads it and CI reads it via `actions/setup-node`'s `node-version-file`.

```bash
direnv allow           # or: nix develop
pnpm install --frozen-lockfile
pnpm run dev:harness   # http://localhost:5187 — SDK mock host, seeded in-memory board
```

The harness plays BOTH halves of the platform locally: a scripted host that
completes the handshake, and the SDK's in-memory document store
(`createFakeStorage` from `@civitai/sdk/testing`, built from this app's real
manifest), seeded with a small board (`src/platform/testing.ts`). Everything
between the board and that store is the real shipping code. The `mock scenarios`
panel can toggle anonymous / signed-in and force the next mutation to fail.
Nothing is written to Civitai.

## The platform seam

This app runs on **`@civitai/sdk`**. It holds the block token the host mints and
reads and writes its data through the document store
(`app.storage.collection('requests')`); the host bridge is used only for things
that are genuinely host UI (sign-in, the consent dialog, iframe resize).
`src/platform/requests.ts` is the one place that maps the board's operations
onto the store.

Everything platform-shaped lives behind `src/platform/`, and it is the only
directory that imports `@civitai/sdk`. The board's ~1,300 lines are written
against those names, so changing transports again means changing that directory
rather than the board.

### Known gaps

**Lost with the move to the document store (phase 1 has no equivalent):**

- **The owner's "Hide from board" is gone.** It was a client-side soft-hide: the
  owner appended a ledger row naming a target, and every client filtered the
  target out after checking the ledger row's numeric `authorUserId`. The
  document store hands an app no author id (only `author.isViewer`, or a
  username under `showAuthor`), and owner-written documents (`write: "owner"`)
  are refused in phase 1, so there is nothing to verify a ledger entry against.
  Rather than rebuild the boundary on something weaker, the affordance is
  removed; hiding is a Civitai moderator action on a reported request.
- **The server no longer enforces the title/details length limits or strips
  HTML.** The legacy store did; the document store caps only the document's
  bytes. The composer still enforces 200/4096 characters, and text is rendered
  escaped, so nothing renders as HTML — but a client other than this board could
  store longer text.

**Carried over from the previous transport:**

- **Analytics is a no-op.** `useBlockAnalytics` is a local shim
  (`src/platform/hooks.ts`), so the board's `track()` events currently go
  nowhere (they log in dev). The `@civitai/sdk` this app now builds against does
  ship `app.host.track`, but it records only events declared under
  `analytics.events` in the manifest — a separate, reviewable manifest change
  that this port deliberately does not make. The call sites are kept so that
  wiring them up is a change to one function plus that declaration.
- **`Modal` is implemented here, not imported.** The components pack ships a
  modal only as a Lit custom element, which under jsdom leaves its children in
  the document while closed and exposes no `role="dialog"`. Both matter for a
  modal holding the composer, so `src/platform/ui.tsx` implements one.

Separately, one **deliberate behaviour change** rode along with the port:

- **The sort switcher is now a `radiogroup`, not a `tablist`.** The previous pack
  rendered `role="tablist"` with `role="tab"` segments. That was the wrong
  pattern: a tab controls a panel via `aria-controls`, and this control has never
  had one — it picks a value and the single list below it re-sorts, so
  screen-reader users were promised a tabbed interface that does not exist. It
  now uses the components pack's default `toggle` mode, which is the WAI-ARIA
  radio-group pattern. The assertion in `App.test.tsx` was **inverted rather than
  relaxed**, and additionally pins that the element does not still claim to be a
  tab set.

## Test + build

```bash
pnpm test        # vitest: pure-logic (node) + component/e2e (jsdom) suites
pnpm build       # tsc --noEmit && vite build → dist/
```

Coverage, in three layers:

- **Unit** (node, no DOM) — the palette and its WCAG contrast in both themes,
  the fuzzy matcher's score bands, the error mapping driven by real store
  refusals, the manifest↔code storage seam, the horizon copy as literal strings,
  and the motion budget.
- **Component** (jsdom) — every new control, including the overflow menu's full
  keyboard contract (`aria-expanded`, roving tab index, ArrowUp/Down wrapping,
  Home/End, Escape and item-select both restoring focus to the trigger).
- **Integration** (`src/e2e.test.tsx`) — the real board, hooks, `requests.ts`
  and SDK client against the SDK's fake document store built from this app's
  manifest: server-side Top/Newest across pages, votes and their server-side
  marks, the hydration regression, post/edit/withdraw/report read back from the
  store, a lost-race edit (`version_conflict`), publish consent granted and
  declined, the trust gate, moderation rejection, a disabled store, **failure
  injection** (`failNext` answers the next mutation `503 service_unavailable` —
  the rejected vote, post and report paths) and the anonymous viewer.

Both themes and `prefers-reduced-motion` are asserted *behaviourally* against
the mounted app — what the elements do, never that an attribute or a media query
exists.

### 🔴 The fourth layer: what jsdom structurally cannot see

```bash
pnpm run dev:harness &                 # or: vite preview, to measure the BUILT css
pnpm run measure:search-clear          # --url http://localhost:5187 by default
pnpm run measure:toolbar               # stacked-toolbar geometry at 4 widths
```

jsdom does not render. It has no layout, no user-agent pseudo-elements and no
pixels, so a whole class of defect passes through the suite untouched — 0.3.2
was one: the browser painted **two** ✕ clear controls inside the search field
(its own `::-webkit-search-cancel-button` next to this app's clear button) while
every assertion above stayed green, because both elements were exactly where
they were meant to be.

`scripts/measure-search-clear.mjs` drives a real headless Chromium over CDP,
puts the pointer on the field, screenshots the right-hand end of it at 4x,
decodes the PNG and counts painted glyph clusters. It exits non-zero unless the
count is 1 — and it measures two control states alongside, which at 0.3.1
returned three different numbers (0 / 1 / 2), so the counter is demonstrably
tracking the screen rather than sitting on a constant.

Two things it taught, both easy to get wrong:

- **Hover is load-bearing.** Blink keeps that button at `opacity: 0` until
  `:hover` or `:focus`, so a scripted screenshot with the pointer parked
  elsewhere shows one ✕ on completely broken code.
- **Measure the BUILT stylesheet, not just the dev server.** `vite build`
  minifies `-webkit-appearance` out of the fix for this project's target, so
  dist ships only the unprefixed declaration. It still works — but the source
  and the artifact are different files and only one of them is the product.

`scripts/measure-toolbar-geometry.mjs` is the second instrument in this layer,
and it exists because the width-adaptive work walked straight into the same
trap. 🔴 **A flex basis is axis-relative, so flipping a container re-aims it.**
The search wrapper carried `flex: 1 1 220px`, written for a row where `220px`
is a minimum *width*; the stacked toolbar sets `flex-direction: column`, and the
identical declaration became a 220px **height** with `flex-grow: 1` holding it
there. Measured at 375px: the wrapper laid out at **220px around 53px of
content — ~167px of dead space**, while every assertion in the suite stayed
green, because `data-layout` really did read `stacked` and every testid really
was present. The layout *decision* was right; only the *sizing* was wrong, and
sizing is precisely what jsdom does not have.

It measures two things that fail differently — each toolbar child's box height
against the union of its own children's boxes (the **effect**, in pixels), and
each child's resolved `flex-basis` while the container is a column (the
**mechanism**) — at 375 / 519 / 900 / 1440, and it carries the same
control-must-move property as the script above: the toolbar's direction and the
wrapper's basis have to *differ* between the narrow and wide widths, or an
emulation that never applied would measure one width four times and report a
confident PASS.

The cause is also pinned in CI, where no browser is available: `src/responsive.test.tsx`
walks the rendered tree and asserts that **no column flex container has a child
with a fixed-length `flex-basis`** — the relationship, read off the resolved
longhand, so `flex: 1 1 220px`, `flexBasis: '220px'` and `flex: 0 1 220px` are
one finding and a reword cannot walk past it. Scanning by container *axis* is
what lets the request row keep its perfectly correct `flex: 1 1 260px` in a row
without a false positive.

## Submit

```bash
civitai login        # once
civitai app submit   # packages manifest + src + build config (platform rebuilds)
```

## Links

- Developer docs — [developer.civitai.com](https://developer.civitai.com)
- Live app — [app-requests.civit.ai](https://app-requests.civit.ai)
- SDK — [`@civitai/sdk`](https://www.npmjs.com/package/@civitai/sdk) (what this app runs on)
- Design system — [`@civitai/components-react`](https://www.npmjs.com/package/@civitai/components-react)
- Block message contract — [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk)
- CLI — [`github.com/civitai/cli`](https://github.com/civitai/cli)
