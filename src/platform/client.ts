// The one place the app reaches @civitai/sdk.
//
// `initialize()` waits for the host's BLOCK_INIT handshake, then hands back a
// client carrying the viewer, the slot context, the theme and — the part this
// app lives on — `storage`, the App Blocks document store, authenticated with
// the block token the host minted.
//
// It is a module-level singleton because `initialize()` is a handshake, not a
// query: running it once per component would open a second conversation with
// the host and race the first. Everything below awaits the SAME promise.

import {
  initialize,
  type BlockAppClient,
  type BlockTransport,
  type DocumentStorage,
  type Scope,
} from '@civitai/sdk';

/** Swapped in by tests and the dev harness. Nothing in production sets these. */
export interface PlatformOverrides {
  transport?: BlockTransport;
  fetch?: typeof fetch;
  siteUrl?: string;
  /**
   * The document store to use instead of the client's `storage` — in practice a
   * session of `createFakeStorage()` from `@civitai/sdk/testing`, which is the
   * SDK's own document-store client running against an in-memory server that
   * enforces the platform's storage contract. A function, so a test can switch
   * the caller mid-run (e.g. after a consent grant).
   */
  storage?: () => DocumentStorage;
  /** Stand-in for the host's consent dialog (`app.requestGrants`). */
  requestGrants?: (scopes: readonly Scope[], opts: { signal?: AbortSignal }) => Promise<boolean>;
}

let overrides: PlatformOverrides = {};
let clientPromise: Promise<BlockAppClient> | null = null;

/**
 * The initialised client, or the in-flight handshake.
 *
 * Callers `await` this rather than gating on a `ready` flag, so a data call
 * issued during boot queues behind the handshake instead of failing.
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

/** The document store the board reads and writes. */
export async function getDocumentStorage(): Promise<DocumentStorage> {
  if (overrides.storage) return overrides.storage();
  return (await getClient()).storage;
}

/**
 * Ask the viewer for scopes through the host's consent dialog. Resolves `true`
 * once the re-minted token carries them, `false` when they can never be granted
 * here. 🔴 A viewer who simply CLOSES the dialog sends nothing, so without a
 * `signal` this never settles — callers must bound it.
 */
export async function requestGrants(
  scopes: readonly Scope[],
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  if (overrides.requestGrants) return overrides.requestGrants(scopes, opts);
  return (await getClient()).requestGrants(scopes, opts);
}

/**
 * Point the platform at a scripted host, a fake store and a fake `fetch`, and
 * drop any client already built. Tests call this in `beforeEach`; nothing in
 * production does.
 *
 * The reset is the load-bearing half: the singleton above would otherwise leak
 * the FIRST test's host and store into every later test, which reads as a
 * passing suite that never exercised its own fixtures.
 */
export function __configurePlatform(next: PlatformOverrides): void {
  overrides = next;
  clientPromise = null;
}
