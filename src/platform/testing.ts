// A fake Civitai, for the dev harness and the end-to-end tests.
//
// Two halves, each the SDK's own:
//   * a scripted HOST (`createFakeTransport`) that completes the handshake and
//     names the viewer;
//   * an in-memory DOCUMENT STORE (`createFakeStorage`) built from this app's
//     real `block.manifest.json`. It is the SDK's document-store client running
//     against a server that enforces the platform's storage contract — scopes
//     and consent, the write policy, the minimum-trust gate, anonymous readers,
//     moderation, error codes and statuses. The SDK runs the platform's own
//     contract suite against it.
//
// What stays real: the board, every hook in `./hooks`, the whole of
// `./requests` (its collection/mark/sort names, its mapping, its consent retry)
// and the SDK's storage client. Only the server is fake. That is the point of
// testing here rather than by stubbing the board's store.
//
// 🔴 The manifest is IMPORTED, not restated. A fake built from a hand-copied
// declaration would go on agreeing with the board after the manifest drifted;
// built from the real file, a renamed collection or an undeclared mark is
// refused here exactly as the server would refuse it.

import { StorageError, type DocumentStorage } from '@civitai/sdk';
import {
  createFakeStorage,
  createFakeTransport,
  type FakeStorage,
  type FakeStorageSession,
  type FakeStorageViewer,
} from '@civitai/sdk/testing';

import manifest from '../../block.manifest.json';
import { REQUESTS_COLLECTION, VOTE_MARK } from './requests.js';
import type { PlatformOverrides } from './client.js';
import type { RequestValue, Theme } from './types.js';

/** A viewer of the fake: the host's identity and the store's, kept as one. */
export interface FakeViewer {
  id: number;
  username: string;
  /** Passes the minimum-trust gate. Default `true`. */
  trusted?: boolean;
}

/** One seeded request. */
export interface FakeSeed {
  value: RequestValue;
  /** Who wrote it. The viewer's own id makes it the viewer's own request. */
  authorId: number;
  /** User ids that have voted on it — seeds the tally AND each voter's mark. */
  voters?: number[];
}

export interface FakeBoardOptions {
  /** `null` is an anonymous viewer — a supported, read-only path. */
  viewer?: FakeViewer | null;
  theme?: Theme;
  seed?: FakeSeed[];
  /** Fail this many MUTATIONS (anything but a read) with a 503 before succeeding. */
  failNext?: number;
  /**
   * Scopes the viewer's token does not carry yet — e.g. `['apps:storage:publish']`
   * before they have granted consent. The store answers such a write
   * `403 consent_required`, exactly as the server does for a missing scope.
   */
  revoked?: readonly string[];
  /**
   * How the stand-in consent dialog answers: `true` grants (the token then
   * carries every manifest scope), `false` declines. Default `false`.
   */
  grantConsent?: boolean;
  /** Answer every data operation `503 storage_disabled`, as a server with no database. */
  disabled?: boolean;
}

export interface FakeBoard {
  /** Pass to `__configurePlatform`. */
  overrides: PlatformOverrides;
  /** The store, for a test that wants to assert or arrange server state directly. */
  store: FakeStorage;
  /** The store as some other user — for arranging, or reading back as them. */
  as: (viewer: FakeViewer | null) => FakeStorageSession;
  /** Every scope list the board asked the consent dialog for, in order. */
  grantRequests: (readonly string[])[];
  /** The `signal` each of those asks carried — an unbounded ask hangs forever on a closed dialog. */
  grantSignals: (AbortSignal | undefined)[];
}

export const DEV_VIEWER: FakeViewer = { id: 7777, username: 'dev-viewer' };

const toStoreViewer = (v: FakeViewer): FakeStorageViewer => ({
  id: v.id,
  username: v.username,
  trusted: v.trusted ?? true,
});

/** Mutating methods of a collection — the ones `failNext` intercepts. */
const MUTATIONS = new Set(['create', 'put', 'delete', 'mark', 'unmark', 'increment']);

/**
 * Wrap a document store so its next `failNext()` mutations reject with the
 * store's own transient envelope (`503 service_unavailable`), as a server under
 * an outage answers. Reads pass through untouched.
 */
function withScriptedFailures(storage: DocumentStorage, failuresLeft: () => boolean): DocumentStorage {
  return {
    info: (opts) => storage.info(opts),
    collection: <T extends object = Record<string, unknown>>(name: string) => {
      const coll = storage.collection<T>(name);
      return new Proxy(coll, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof prop !== 'string' || !MUTATIONS.has(prop) || typeof value !== 'function') {
            return value;
          }
          return (...args: unknown[]) => {
            if (failuresLeft()) {
              const message = 'storage is temporarily unavailable';
              return Promise.reject(
                new StorageError(503, 'service_unavailable', message, {
                  code: 'service_unavailable',
                  message,
                  error: message,
                }),
              );
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    },
  };
}

/**
 * Build a fake host + a fake document store and seed the board.
 *
 * Async because seeding goes THROUGH the store as each author and each voter —
 * the same calls a real board would have made — rather than writing its rows
 * directly; the fake has no back door, which is what keeps it honest.
 * Seeds are created oldest-first so the FIRST seed is the NEWEST, on a clock
 * one minute apart.
 */
export async function createFakeBoard(options: FakeBoardOptions = {}): Promise<FakeBoard> {
  const viewer = options.viewer === undefined ? DEV_VIEWER : options.viewer;
  const seed = options.seed ?? [];

  const realNow = Date.now();
  let clock = realNow - (seed.length + 1) * 60_000;
  let seeding = true;

  const store = createFakeStorage({
    manifest,
    viewer: viewer ? toStoreViewer(viewer) : null,
    now: () => (seeding ? clock : Date.now()),
    ...(options.disabled ? { disabled: true } : {}),
  });
  const as = (v: FakeViewer | null) => store.as({ viewer: v ? toStoreViewer(v) : null });

  // Arrange: author each seed, then cast each voter's mark, as those users and
  // with every manifest scope. A disabled store refuses these too, so a
  // disabled board is always empty.
  if (!options.disabled) {
    for (let i = seed.length - 1; i >= 0; i -= 1) {
      const s = seed[i]!;
      clock += 60_000;
      // Arranging sessions are always TRUSTED: a seed is history, and an
      // untrusted test viewer must still be able to own a seeded request.
      const authorSession = store.as({
        viewer: {
          ...toStoreViewer(
            viewer && s.authorId === viewer.id ? viewer : { id: s.authorId, username: `user_${s.authorId}` },
          ),
          trusted: true,
        },
        scopes: manifest.scopes,
      });
      const doc = await authorSession.storage.collection<RequestValue>(REQUESTS_COLLECTION).create(s.value);
      for (const voterId of s.voters ?? []) {
        const voter =
          viewer && voterId === viewer.id ? viewer : { id: voterId, username: `user_${voterId}` };
        await store
          .as({ viewer: { ...toStoreViewer(voter), trusted: true }, scopes: manifest.scopes })
          .storage.collection(REQUESTS_COLLECTION)
          .mark(doc.key, VOTE_MARK);
      }
    }
  }
  seeding = false;

  let failures = options.failNext ?? 0;
  const consume = () => {
    if (failures <= 0) return false;
    failures -= 1;
    return true;
  };

  // The board's own session. Without the revoked scopes until consent is
  // granted; with every manifest scope after.
  const revoked = new Set(options.revoked ?? []);
  const sessionFor = (granted: boolean) =>
    withScriptedFailures(
      store.as({
        viewer: viewer ? toStoreViewer(viewer) : null,
        scopes: granted ? manifest.scopes : manifest.scopes.filter((sc) => !revoked.has(sc)),
      }).storage,
      consume,
    );
  let boardStorage = sessionFor(revoked.size === 0);
  const grantRequests: (readonly string[])[] = [];
  const grantSignals: (AbortSignal | undefined)[] = [];

  const transport = createFakeTransport({
    ready: true,
    hostOrigin: 'https://civitai.com',
    viewer: viewer ? { id: viewer.id, username: viewer.username } : null,
    theme: options.theme ?? 'dark',
    token: { raw: 'fake-block-token', scopes: [], expiresAt: new Date(realNow + 15 * 60_000) },
  });
  // The client asks the host for a token; without an answer `initialize()` never
  // resolves and every test times out on a blank board.
  transport.handle('REQUEST_TOKEN', () => ({
    token: { token: 'fake-block-token', expiresAt: new Date(realNow + 15 * 60_000).toISOString() },
  }));

  return {
    overrides: {
      transport,
      // Nothing on the data path may reach the network; the setup file's global
      // `fetch` stub rejects loudly if anything tries.
      storage: () => boardStorage,
      requestGrants: async (scopes, opts) => {
        grantRequests.push(scopes);
        grantSignals.push(opts.signal);
        if (!options.grantConsent) return false;
        boardStorage = sessionFor(true);
        return true;
      },
    },
    store,
    as,
    grantRequests,
    grantSignals,
  };
}
