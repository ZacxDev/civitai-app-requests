// 🔴 FIRST IMPORT, DELIBERATELY. Keep it above every other import in this file.
//
// This block renders in `<iframe sandbox="allow-scripts">` WITHOUT
// `allow-same-origin` (the host adds that flag only for trusted tiers, and every
// approved v1 block is `unverified`). At that opaque origin merely *reading*
// `window.localStorage` throws `SecurityError` — so any dependency that touches
// storage while its module body evaluates takes the whole app down before a
// single pixel is painted, usually reported as some unrelated failure.
//
// This module installs a spec-shaped in-memory `Storage` over a
// present-but-unusable one, as an import side effect. It is a no-op wherever
// storage actually works and never invents storage where there is none.
//
// Order is the entire mechanism: ES imports are hoisted and evaluated
// depth-first in source order, so no *statement* could ever run early enough —
// only an earlier import can. `src/safe-storage-order.test.ts` fails if this
// line stops being first.
//
// Today the board's own production graph has no module-scope storage touch
// (`@civitai/sdk`'s only one is inside `createSignIn()`, which this app never
// calls), so this is defensive: it closes the gap before a routine dependency
// bump silently opens it.
//
// Sourced from `@civitai/sdk` — the successor this app was ported onto in #21.
// It was temporarily imported from the predecessor `@civitai/app-sdk` (PR #23)
// only because the successor had not published a `./safe-storage` subpath yet;
// `civitai/civitai-app-starters#457` added it and `@civitai/sdk@0.7.0` shipped it
// (`npm view @civitai/sdk exports` now lists `./safe-storage`). The app therefore
// has NO production import of `@civitai/app-sdk` left — the only remaining
// reference is a test (`src/bootFragment.test.ts`), so the dependency stays but
// nothing in the shipped graph reaches it.
import '@civitai/sdk/safe-storage';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BlockGate } from './platform/BlockGate.js';

// Design-system tokens (`--civitai-*` custom properties, light/dark via
// `[data-theme]`). `injectStyles()` also injects these at runtime, but importing
// the stylesheet makes @civitai/theme an explicit, first-paint token source
// rather than a transitive side-effect of the components pack.
import '@civitai/theme/styles.css';

import { App } from './App.js';
import { Harness } from './Harness.js';
import './index.css';

// Dev harness entry.
//   VITE_DEV_HARNESS=true  -> mount the local FAKE (a scripted host plus an
//                             in-memory REST server; no real data).
//                             `pnpm run dev:harness`.
//   (unset)                -> render <App/> bare (the platform is the host).
//
// The transport allowlist the old harness had to install up-front is gone with
// the postMessage data path: the harness now hands the platform a transport and
// a `fetch` directly, so there is no cross-origin message to admit.
const useHarness = import.meta.env.VITE_DEV_HARNESS === 'true';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

// `<BlockGate>` shows an "Open on Civitai" landing when the block is loaded
// DIRECTLY (top-level at its bare `app-requests.civit.ai` origin, with no host)
// instead of hanging on the app's loading state. It's inert on the embedded
// happy path and under the harness (both complete the handshake), so the app
// renders unchanged there.
createRoot(container).render(
  <StrictMode>
    <BlockGate>
      {useHarness ? (
        <Harness>
          <App />
        </Harness>
      ) : (
        <App />
      )}
    </BlockGate>
  </StrictMode>,
);
