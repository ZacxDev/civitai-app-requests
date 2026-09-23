// A fake Civitai, for the dev harness and the end-to-end tests.
//
// 🔴 WHY THIS REPLACED THE SDK MOCK HOST. The old harness played a mock HOST and
// answered the board's `SHARED_*` postMessage ops. After the port the board does
// not send those messages — it makes REST calls — so a mock host would answer a
// conversation nobody is having any more, and the e2e tests would pass while
// exercising nothing. The fake therefore sits where the real boundary now is:
// `fetch`.
//
// What stays real: the board, every hook in `./hooks`, and the whole of
// `./sharedStorage` — including its URL construction, its query parameters, its
// date revival and its error handling. Only the server is fake. That is the
// point of testing here rather than by stubbing the client.

import { createFakeTransport } from '@civitai/sdk/testing';

import type { SharedAppendValue, SharedListItem, Theme } from './types.js';

/** One seeded row. `voters` seeds both the count and the one-vote-per-user set. */
export interface MockSharedSeed {
  value: SharedAppendValue;
  authorUserId: number;
  voters?: number[];
  /**
   * Pin this row's key.
   *
   * 🔴 USE THIS WHENEVER A TEST NEEDS TO REFER TO A ROW BY KEY — for instance a
   * moderation ledger entry naming its target. The real server mints an opaque
   * ULID, so any test that guesses a key is asserting against a fake's internals
   * rather than the platform's contract. The previous suite hardcoded
   * `shared_2`, which was the old mock host's minting convention and nothing the
   * real server ever produces; it would have gone on passing while describing
   * something untrue. Naming the key here keeps the test independent of how
   * either server mints one.
   */
  key?: string;
}

export interface FakeCivitaiOptions {
  /** `null` is an anonymous viewer — a supported, read-only path. */
  viewer?: { id: number; username?: string } | null;
  theme?: Theme;
  seed?: MockSharedSeed[];
  /** Fail this many mutations before succeeding, for the failure-path scenarios. */
  failNext?: number;
  /** Rows per page. Small by default so cursor paging is actually exercised. */
  pageSize?: number;
}

interface Row {
  key: string;
  authorUserId: number;
  value: SharedAppendValue;
  voters: Set<number>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeCivitai {
  /** Pass to `__configurePlatform`. */
  transport: ReturnType<typeof createFakeTransport>;
  /** Pass to `__configurePlatform`. */
  fetch: typeof fetch;
  /** The live store, for a test that wants to assert server state directly. */
  rows: () => SharedListItem[];
}

const VIEWER_DEFAULT = { id: 7777, username: 'dev-viewer' };

/**
 * Build a fake host + a fake civitai.com.
 *
 * The REST behaviour mirrors the real routes closely enough that the board
 * cannot tell them apart: `list` pages by opaque cursor and stamps each row's
 * `viewerVoted` for the CALLER, mutations refuse an anonymous caller the way
 * the block-scope middleware does, and `withdraw` only removes the caller's own
 * row.
 */
export function createFakeCivitai(options: FakeCivitaiOptions = {}): FakeCivitai {
  const viewer = options.viewer === undefined ? VIEWER_DEFAULT : options.viewer;
  const pageSize = options.pageSize ?? 20;
  let failuresLeft = options.failNext ?? 0;

  let counter = 0;
  const now = Date.now();
  const store: Row[] = (options.seed ?? []).map((s, i) => ({
    key: s.key ?? `seed-${(counter += 1)}`,
    authorUserId: s.authorUserId,
    value: s.value,
    voters: new Set(s.voters ?? []),
    // Descending so the seed's first entry is the NEWEST, which is the order
    // the board's "Newest" sort expects to receive.
    createdAt: new Date(now - i * 60_000),
    updatedAt: new Date(now - i * 60_000),
  }));

  const toItem = (row: Row): SharedListItem => ({
    key: row.key,
    authorUserId: row.authorUserId,
    value: row.value,
    count: row.voters.size,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    viewerVoted: viewer ? row.voters.has(viewer.id) : false,
  });

  const transport = createFakeTransport({
    ready: true,
    hostOrigin: 'https://civitai.com',
    viewer: viewer ? { id: viewer.id, username: viewer.username ?? null } : null,
    theme: options.theme ?? 'dark',
    token: { raw: 'fake-block-token', scopes: [], expiresAt: new Date(now + 15 * 60_000) },
  });
  // The client asks the host for a token; without an answer `initialize()` never
  // resolves and every test times out on a blank board.
  transport.handle('REQUEST_TOKEN', () => ({
    token: { token: 'fake-block-token', expiresAt: new Date(now + 15 * 60_000).toISOString() },
  }));

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  /** The real routes reject an anonymous mutation; so does this. */
  const requireViewer = (): Response | null =>
    viewer ? null : json(403, { error: 'Sign in to contribute — anonymous callers cannot write.' });

  /** Consume one scripted failure, if any are left. */
  const scriptedFailure = (): Response | null => {
    if (failuresLeft <= 0) return null;
    failuresLeft -= 1;
    return json(503, { error: 'SHARED_UNAVAILABLE: the requests service is unavailable' });
  };

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url);
    const path = url.pathname.replace(/^.*\/api\/v1\/blocks\/shared-storage\//, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (path === 'list') {
      const limit = Number(url.searchParams.get('limit') ?? pageSize);
      const cursor = url.searchParams.get('cursor');
      const start = cursor ? Number(cursor) : 0;
      const slice = store.slice(start, start + limit);
      const next = start + limit < store.length ? String(start + limit) : undefined;
      return json(200, {
        items: slice.map((row) => ({
          ...toItem(row),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        metadata: { nextCursor: next },
      });
    }

    const refusal = requireViewer() ?? scriptedFailure();
    if (refusal) return refusal;
    const me = viewer as { id: number };

    const find = () => store.find((r) => r.key === body.key);

    switch (path) {
      case 'append': {
        const key = `new-${(counter += 1)}`;
        store.unshift({
          key,
          authorUserId: me.id,
          value: body.value as SharedAppendValue,
          voters: new Set(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return json(200, { key });
      }
      case 'update': {
        const row = find();
        if (!row) return json(404, { error: 'No such entry' });
        if (row.authorUserId !== me.id) return json(403, { error: 'Not your entry' });
        row.value = body.value as SharedAppendValue;
        row.updatedAt = new Date();
        return json(200, { ok: true });
      }
      case 'vote': {
        const row = find();
        if (!row) return json(404, { error: 'No such entry' });
        row.voters.add(me.id);
        return json(200, { count: row.voters.size });
      }
      case 'unvote': {
        const row = find();
        if (!row) return json(404, { error: 'No such entry' });
        row.voters.delete(me.id);
        return json(200, { count: row.voters.size });
      }
      case 'withdraw': {
        const index = store.findIndex((r) => r.key === body.key);
        if (index < 0) return json(200, { ok: true, deleted: false });
        if (store[index]!.authorUserId !== me.id) return json(403, { error: 'Not your entry' });
        store.splice(index, 1);
        return json(200, { ok: true, deleted: true });
      }
      case 'report':
        return json(200, { ok: true });
      default:
        return json(404, { error: `Unhandled route: ${path}` });
    }
  };

  return { transport, fetch: fakeFetch, rows: () => store.map(toItem) };
}
