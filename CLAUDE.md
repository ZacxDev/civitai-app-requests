# App Requests — agent guide

A Civitai **App Block**: a full-page app served at `/apps/run/app-requests`
where anyone posts an app/feature idea and up-votes other people's. It is built
entirely on the **cross-user shared store** (`useSharedStorage()`), plus
`report()` and `user:read:self`. **No Buzz, no generation** — nothing here can
charge a viewer.

The load-bearing invariants, all documented in [`README.md`](./README.md):

- **Horizon honesty** (`src/disclosure.ts`). Top-ranking and search both run
  over a *bounded* client-side scan (≤8 pages × 25). Whenever the server still
  holds rows the app never loaded, the board must say so. A filter that
  silently misses a row reads as "no such request exists", which is a lie.
- **Moderation is suppression, not deletion** (`src/moderation.ts`). The
  platform gives an app owner no delete, so "Hide from board" is an
  owner-authored ledger entry every client honours. The `authorUserId` check is
  the whole security boundary — `data` is unmoderated, so anyone can append a
  ledger-*shaped* row and it must be ignored as a suppression **and** never
  rendered as a request.
- **Vote state comes from the server's `viewerVoted`**, never from a local
  per-viewer set. The old KV set is what produced the double-click-to-unvote
  bug; do not reintroduce a client-side mirror of it.
- **Layout is measured against the block's own box, not the viewport**
  (`src/layout.ts`, the only place a threshold is named). `unmeasured` is not
  `narrow`: every structural branch is gated on `measured`. Tiers differ in
  *arrangement only* — every element, testid and handler exists at every tier.
- **Hero legibility is structural, not compositional** (`src/hero.ts`). Swapping
  `src/assets/hero.jpg` means re-measuring `HERO_ART_BRIGHTEST`.

This repo is a **public OSS mirror** — block source only, no infrastructure
internals. Keep it that way.

## Get a shell

`pnpm` is **not on PATH** outside the dev shell. The flake pins the toolchain:

```bash
direnv allow          # or: nix develop
pnpm install --frozen-lockfile
```

| Task | Command |
|---|---|
| The gates CI runs | `pnpm test && pnpm build` |
| Types only | `pnpm typecheck` |
| Mock host (SDK `createMockHost`) | `pnpm run dev:harness` → http://localhost:5187 |
| Inside the real host, over a tunnel | `civitai app dev-tunnel` (drives `pnpm run dev:tunnel`) |
| Real-browser layout instruments | `pnpm run measure:search-clear`, `pnpm run measure:toolbar` |
| Platform approve-time validator | `civitai app validate` (the Go CLI, installed separately — the flake does not ship it) |

**Toolchain pins.** `.nvmrc` is the single authority for the node major — the
flake reads it, and CI reads it via `node-version-file`. pnpm's major is stated
twice (`flake.nix`'s `pnpmMajor` and the `pnpm/action-setup` step) because the
action reads only its own input or a `packageManager` field this repo
deliberately does not declare — adding one would change what the *platform's*
builder does, since `block.manifest.json`'s `buildCommand` runs against the same
`package.json`. `src/toolchain-lockstep.test.ts` fails if those two drift, if
someone hardcodes a node version back into the workflow, or if the manifest's
`buildCommand` stops using pnpm while pnpm's is the only lockfile in the tree.

Only `x86_64-linux` is exercised. The flake evaluates for `aarch64-linux` and
`aarch64-darwin` too; `x86_64-darwin` is absent because nixpkgs-unstable dropped
it.

## Where a change belongs

Most work that *looks* like a bug here is a gap one layer down. Canonical
checkouts live at `~/workspace/civit/<repo-name>`; sibling directories with a
suffix are topic worktrees of the same remotes, usually on a feature branch.

| The change is about | Repo | Local |
|---|---|---|
| This block's UI, board logic, ranking, search, moderation ledger | **`ZacxDev/civitai-app-requests`** (here) | — |
| A hook, a type, the mock host, the design system — anything imported from `@civitai/*` | **`civitai/civitai-app-starters`** | `civitai-app-starters` |
| Host/server behavior: the `/apps/run` page surface, block token + scope enforcement, the money path, **app storage (incl. the shared store's ranking/search and `viewerVoted`)**, the workflow read-model, submit/approval | **`civitai/civitai`** | `civitai` |
| `civitai app init/validate/submit`, login, dev tunnel | **`civitai/cli`** (Go) | `cli` |
| Public developer docs (developer.civitai.com) | **`civitai/civitai-developer-docs`** | `civitai-developer-docs` |

**All five `@civitai/*` dependencies ship from the one starters repo** —
`packages/civitai-app-sdk`, `civitai-blocks-react`, `civitai-components`,
`civitai-components-react`, `civitai-theme`. A missing hook, a wrong type, a
mock host that doesn't simulate something: that is a PR there, not a workaround
here. **A server-side ranked/searchable read of the shared store is the proper
upstream fix** for the bounded-scan horizon — that one is `civitai/civitai`.

Useful landmarks in `civitai/civitai`: `src/pages/apps/run` (the page surface),
`src/pages/api/blocks/manifest-schema.ts` + `submit-version.ts`,
`src/server/services/blocks/`.

Sibling app blocks worth reading for prior art:
`ZacxDev/civitai-app-gen-matrix`, `…-model-benchmarking`,
`…-playable-collections`, `…-custom-generators`, `…-sensei`.

## Documentation sources, in authority order

1. **The installed package itself.** `node_modules/@civitai/<pkg>/dist/*.d.ts`
   and its `README.md` are the only source guaranteed to describe *the version
   this repo builds against*. Check `package.json` for that version first.
   Subpaths matter: `@civitai/app-sdk` exports `./blocks`, `./scopes`,
   `./orchestrator`, `./schemas/app-block/v1.json`; `@civitai/blocks-react`
   exports `./ui` and `./testing`.
2. **https://developer.civitai.com/apps/** — `guide/{quickstart,concepts,embedding,theming,text-to-image,comfy-cloud}`
   and `reference/{hooks,manifest,messages,scopes,components,generation,cli}`.
   Best for *why* and for the message-bridge contract. ⚠️ The generated pages
   carry a `sources:` front-matter naming the package version they were built
   from, and it **lags** the version here — when the page and the `.d.ts`
   disagree, the `.d.ts` wins.
3. **The starters repo** — `docs/build-your-first-app-block.md`,
   `starters/examples/*` (one runnable example per feature), and
   `starters/civitai-block-starter` (what `civitai app init` clones).
4. **The host implementation** in `civitai/civitai` — last-resort ground truth
   for server behavior the docs don't specify (which errors the shared store
   returns, what a scope actually gates, how the trust gate is evaluated).

For React 19 / Vite / Vitest specifics, use the `context7` MCP tools rather than
recalling from memory.

## Verifying a change

`pnpm test` runs **two vitest projects** and both must be read — a failure in
one is invisible in the other:

- **`node`** — `src/*.test.ts`, pure logic, no DOM: the palette's WCAG contrast
  in both themes, the fuzzy matcher, the moderation ledger (including the
  forged record), the horizon copy, the motion budget, the two lockstep guards.
- **`dom`** — `src/*.test.tsx`, jsdom + Testing Library, driving `<App/>`
  against the SDK mock host over the real postMessage transport, with failure
  injection (`shared.failNext`) and the anonymous viewer.

**What jsdom structurally cannot see is a fourth layer, and it is not in CI.**
jsdom has no layout and no pixels. `scripts/measure-search-clear.mjs` and
`scripts/measure-toolbar-geometry.mjs` drive a real headless Chromium over CDP
and are the only instruments that catch a painted-pixel defect (0.3.2's double
✕; the stacked toolbar's axis-flipped `flex-basis`). Run them against the
**built** stylesheet when a change touches CSS — `vite build` minifies
declarations the dev server serves. `src/responsive.test.tsx` pins the *cause*
of the second one in CI, where no browser exists.

**What cannot be verified here at all:** the live board is server-authoritative.
The min-trust gate (verified, ≥7d, not muted), content moderation on
`append`/`update`, and cross-user visibility of a real vote all need a real
mod-gated host and a second account. No local run, harness run or green suite
proves any of them. Say so plainly rather than reporting a green suite as if it
covered the platform.

New guards should pin a *relationship* that cannot rot on a routine bump, and be
watched failing before they are trusted. `src/version-lockstep.test.ts` and
`src/toolchain-lockstep.test.ts` are the pattern to copy — both explain, in the
file, the incident they exist to prevent.

## Release protocol

- `block.manifest.json` and `package.json` versions move **together**, and the
  manifest's *content* is fingerprinted per released version in
  `release-manifest-ledger.json`. `src/version-lockstep.test.ts` enforces both.
- 🔴 **Changing what the manifest says without bumping the version produces a
  change that CAN NEVER SHIP** — `civitai app submit` refuses a version not
  strictly above the highest approved one, so the merge lands on `main` while
  production keeps serving the old tree. It has happened twice here (`dde1a6c`,
  PR #15). To cut a release: bump `version` in **both** files, then add the new
  `version -> hash` line the failing test prints.
- The tree carries exactly **one** lockfile, `pnpm-lock.yaml`. The manifest's
  `buildCommand` is `pnpm run build` and the platform runs it against this same
  `package.json` — which is why no `packageManager` field is declared here.
- If a `@civitai/*` bump is ever refused by pnpm's `minimumReleaseAge` freshness
  gate at install time, add a `pnpm-workspace.yaml` with `packages: ['.']` and a
  `minimumReleaseAgeExclude` for the pinned versions. This repo has not needed
  one — do not add it speculatively.
- `.env.production` bakes the allowed parent origins into the bundle at build
  time. Wrong value = the transport drops every host message and the iframe
  renders blank.
