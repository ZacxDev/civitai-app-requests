// Setup for the jsdom (component + e2e) test project. Loaded via setupFiles in
// vite.config.ts's `dom` project.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { __configurePlatform } from './platform/client.js';

// 🔴 <App/> NOW DRIVES ITS DATA OVER HTTP, not postMessage. jsdom has no
// network, so global `fetch` is stubbed to REJECT LOUDLY: a test that reaches
// the network has forgotten to install the fake, and the rejection says so
// instead of hanging until a timeout or — worse — reaching real civitai.com.
//
// A test that wants data installs `createFakeCivitai()` through
// `__configurePlatform`, which supplies its own `fetch` to the SDK client and
// never consults this global.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in test')));
});

// The platform client is a process-wide singleton holding one host handshake.
// Reset it before each test so no viewer, token or store leaks into the next —
// without this the FIRST test's fake answers every later test, which reads as a
// passing suite that never exercised its own fixtures.
beforeEach(() => {
  __configurePlatform({});
});

// Unmount React trees + clear jsdom between tests.
afterEach(() => {
  cleanup();
});
