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
