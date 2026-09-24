// The one place the app reaches @civitai/sdk.
//
// `initialize()` waits for the host's BLOCK_INIT handshake, then hands back a
// client carrying the viewer, the slot context, the theme and — the part this
// app lives on — `site`, a REST client that signs every call with the block
// token the host minted.
//
// It is a module-level singleton because `initialize()` is a handshake, not a
// query: running it once per component would open a second conversation with
// the host and race the first. Everything below awaits the SAME promise.

import { initialize, type BlockAppClient, type BlockTransport } from '@civitai/sdk';

/** Swapped in by tests so the app talks to a scripted host + a fake `fetch`. */
export interface PlatformOverrides {
  transport?: BlockTransport;
  fetch?: typeof fetch;
  siteUrl?: string;
}

let overrides: PlatformOverrides = {};
let clientPromise: Promise<BlockAppClient> | null = null;

/**
 * The initialised client, or the in-flight handshake.
 *
 * Callers `await` this rather than gating on a `ready` flag, so a data call
 * issued during boot queues behind the handshake instead of failing. That is
 * what keeps `shared.list()` callable from the first effect.
 */
export function getClient(): Promise<BlockAppClient> {
  const existing = clientPromise;
  if (existing) return existing;
  const started = initialize({
    ...(overrides.transport ? { transport: overrides.transport } : {}),
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
    ...(overrides.siteUrl ? { siteUrl: overrides.siteUrl } : {}),
  });
  clientPromise = started;
  return started;
}

/**
 * Point the platform at a scripted host and a fake `fetch`, and drop any client
 * already built. Tests call this in `beforeEach`; nothing in production does.
 *
 * The reset is the load-bearing half: the singleton above would otherwise leak
 * the FIRST test's host and store into every later test, which reads as a
 * passing suite that never exercised its own fixtures.
 */
export function __configurePlatform(next: PlatformOverrides): void {
  overrides = next;
  clientPromise = null;
}
