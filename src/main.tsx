import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BlockGate } from '@civitai/blocks-react/ui';

// Design-system tokens (`--civitai-*` custom properties, light/dark via
// `[data-theme]`). The pack's injectBlocksStyles() also injects these at runtime,
// but importing the stylesheet makes @civitai/theme an explicit, first-paint
// token source rather than a transitive side-effect of the pack.
import '@civitai/theme/styles.css';

import { App } from './App.js';
import { Harness } from './Harness.js';
import { installHarnessTransport } from './dev-transport.js';
import './index.css';

// Dev harness entry.
//   VITE_DEV_HARNESS=true  -> mount the SDK MOCK host (synthetic shared store,
//                             no real data). `npm run dev:harness`.
//   (unset)                -> render <App/> bare (the platform is the host).
const useHarness = import.meta.env.VITE_DEV_HARNESS === 'true';

// The mock host replies from window.location.origin; the SDK transport drops
// mismatched-origin messages. Allowlist this origin BEFORE any hook runs so
// BLOCK_INIT lands. (Prod reads VITE_BLOCK_ALLOWED_PARENT_ORIGINS instead.)
if (useHarness) installHarnessTransport();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

// `<BlockGate>` shows an "Open on Civitai" landing when the block is loaded
// DIRECTLY (top-level at its bare `app-requests.civit.ai` origin, with no
// BLOCK_INIT) instead of hanging on the app's loading state. It's inert on the
// embedded happy path and the dev harness (both post BLOCK_INIT), so the app
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
