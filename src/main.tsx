import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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

createRoot(container).render(
  <StrictMode>
    {useHarness ? (
      <Harness>
        <App />
      </Harness>
    ) : (
      <App />
    )}
  </StrictMode>,
);
