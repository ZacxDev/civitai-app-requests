/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

import { DEV_ALLOWED_HOSTS, devServerSecurityHeaders } from './src/dev-embed.js';

// base MUST be '/' — the platform serves the build output at the root of the
// app's own subdomain and server-owns the manifest iframe.src. No path prefix.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // `civitai app dev-tunnel` runs `dev:tunnel`, which sets CIVITAI_DEV_TUNNEL_HMR=1.
  // When tunneling, Vite's injected `@vite/client` must open its HMR socket over
  // the PUBLIC tunnel host (`wss://dev-<16hex>.civit.ai:443`), NOT the dev
  // server's own `ws://localhost:5187` — which the browser INSIDE the tunneled
  // iframe cannot reach. Setting `clientPort: 443` + `protocol: 'wss'` while
  // LEAVING `ws.host` UNSET makes the client derive the host from
  // `location.hostname` (the tunneled host, minted at runtime). For plain dev /
  // dev:harness the flag is unset and HMR stays at its default local ws.
  const tunnelHmr =
    env.CIVITAI_DEV_TUNNEL_HMR === '1' || env.CIVITAI_DEV_TUNNEL_HMR === 'true';

  return {
    base: '/',
    plugins: [react()],
    server: {
      // The dev harness fires a fake BLOCK_INIT from window.location.origin and
      // the SDK IframeTransport drops any postMessage whose origin isn't its
      // allowed parent origin. Pin host+port so that origin is stable.
      host: 'localhost',
      port: 5187,
      strictPort: true,
      // `civitai app dev-tunnel` serves THIS dev server, through a reverse
      // tunnel, as a dev-*.civit.ai host that civitai.com iframes. allowedHosts
      // admits the tunneled host; the CSP lets civitai.com frame it (both
      // DEV-ONLY — `server.*` never applies to `vite build`). See dev-embed.ts.
      allowedHosts: DEV_ALLOWED_HOSTS,
      headers: devServerSecurityHeaders(),
      // Route HMR over the tunnel ONLY when `dev:tunnel` set the gate flag.
      ...(tunnelHmr ? { ws: { clientPort: 443, protocol: 'wss' as const } } : {}),
    },
    build: {
      target: 'es2022',
      rollupOptions: { output: { manualChunks: undefined } },
    },
    test: {
      // Two suites in one `vitest run`:
      //  - `node`: pure-logic unit tests (*.test.ts) — no DOM, fast.
      //  - `dom` : component + e2e tests (*.test.tsx) — jsdom + testing-library,
      //            driving <App/> against mocked hooks / the SDK mock host.
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: ['src/**/*.test.tsx'],
            setupFiles: ['./src/test-setup.ts'],
          },
        },
      ],
    },
  };
});
