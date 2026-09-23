// The hooks the board calls, rebound onto @civitai/sdk.
//
// These keep the SIGNATURES the the blocks-react bridge package hooks had, so the port
// is a change of transport rather than a rewrite of 1,300 lines of board logic.
// Each one is a thin adapter; the interesting code is in `sharedStorage.ts`.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getClient } from './client.js';
import { createSharedStorage } from './sharedStorage.js';
import type { SharedStorage, Theme, Viewer } from './types.js';

export interface BlockContextValue {
  /** `false` until the host handshake lands. `viewer` is not meaningful before. */
  ready: boolean;
  /** `null` for an anonymous viewer — a supported state, not an error. */
  viewer: Viewer | null;
  theme: Theme;
}

/**
 * The viewer, the theme and whether the host has answered yet.
 *
 * Re-renders on `onChange`, which the SDK fires when any of it changes — the
 * viewer signing in mid-session, or switching theme.
 */
export function useBlockContext(): BlockContextValue {
  // 🔴 `theme: 'light'` HERE IS A SENTINEL, NOT A READING, and it matches the
  // SDK's own pre-init snapshot deliberately rather than picking a third value.
  // Before the handshake lands there is no host to ask, so this is 'light' for
  // EVERY viewer — indistinguishable from a host that really is light. Nothing
  // may paint from it; `bootThemeGuess()` in `src/bootTheme.ts` exists for
  // exactly that pre-ready window and explains why.
  const [value, setValue] = useState<BlockContextValue>({
    ready: false,
    viewer: null,
    theme: 'light',
  });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      let app;
      try {
        app = await getClient();
      } catch {
        // No host answered. The board renders its signed-out, empty state rather
        // than hanging on `ready: false` forever; BlockGate covers the case where
        // the app was opened outside civitai.com entirely.
        if (!cancelled) setValue((v) => ({ ...v, ready: true }));
        return;
      }
      if (cancelled) return;

      const read = (): BlockContextValue => ({
        ready: true,
        viewer: app.viewer ? { id: app.viewer.id, username: app.viewer.username ?? undefined } : null,
        theme: app.theme,
      });

      setValue(read());
      unsubscribe = app.onChange(() => {
        if (!cancelled) setValue(read());
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return value;
}

/**
 * The shared-storage client.
 *
 * Memoised to a stable identity because the board lists it in the dependency
 * arrays of several `useCallback`s — a fresh object per render would rebuild
 * `refreshList` every time and re-fire its effect in a loop.
 */
export function useSharedStorage(): SharedStorage {
  return useMemo(() => createSharedStorage(), []);
}

/** Starts the host's sign-in flow; the block re-initialises as a signed-in viewer. */
export function useRequestSignIn(): { requestSignIn: (returnUrl?: string) => void } {
  const requestSignIn = useCallback((returnUrl?: string) => {
    void getClient()
      .then((app) => app.host.requestSignIn(returnUrl ? { returnUrl } : undefined))
      .catch(() => {
        /* no host to sign in through — the affordance is simply inert */
      });
  }, []);
  return { requestSignIn };
}

/**
 * Keeps the iframe as tall as `ref`.
 *
 * The host owns the frame's height, so the block has to report its own. The SDK
 * runs the ResizeObserver and the de-duplication; this only binds it to the
 * element and to the component's lifetime.
 */
export function useBlockResize(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let stop: (() => void) | undefined;
    let cancelled = false;

    void getClient()
      .then((app) => {
        if (cancelled) return;
        stop = app.host.autoResize(element);
      })
      .catch(() => {
        /* no host to resize; the page sizes itself */
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [ref]);
}

/**
 * Block analytics.
 *
 * 🔴 THIS IS A NO-OP SHIM, AND THAT IS A DELIBERATE, TEMPORARY LOSS.
 * the blocks-react bridge package sent these events to the host over the bridge.
 * `@civitai/sdk` has no analytics surface and the platform has no REST twin for
 * one (there is no analytics route under `/api/v1/blocks/*`), so the events have
 * nowhere to go on this transport.
 *
 * It is a shim rather than a deletion so the board's six call sites — and the
 * tests that assert them — survive unchanged. When the SDK gains analytics, the
 * fix is this function's body, not six call sites. In dev the events are logged
 * so the surface stays observable rather than silently vanishing.
 *
 * See `README.md` → "Known gaps on the SDK transport".
 */
export function useBlockAnalytics(): {
  track: (event: string, data?: Record<string, unknown>) => void;
} {
  const track = useCallback((event: string, data?: Record<string, unknown>) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[app-requests analytics]', event, data ?? {});
    }
  }, []);
  return { track };
}
