// The board's data layer, over the App Blocks document store.
//
// The board used to live on the legacy cross-user shared store
// (`/api/v1/blocks/shared-storage/*`): rows with a numeric `authorUserId`, a
// bare vote `count` and `viewerVoted`, newest-first only. It now lives on ONE
// declared shared collection, `requests`, through `app.storage.collection()`:
//
//   board op      document store
//   ─────────     ──────────────────────────────────────────────────────────
//   list          list({ sort: '-mark:vote' | '-createdAt', limit, cursor })
//   append        create({ title, body? })          (needs apps:storage:publish)
//   update        put(key, data, { ifVersion })      (needs apps:storage:publish)
//   vote/unvote   mark/unmark(key, 'vote')           → the server's tally
//   withdraw      delete(key)                        (author only)
//   report        mark(key, 'report')                (built in; never withdrawn)
//
// Three things the store now does that the board used to approximate:
//   * RANKING is server-side. `-mark:vote` orders the whole collection, so the
//     first page IS the top of the board — no bounded client-side scan.
//   * VOTE STATE is the document's own `viewer.marks`, so a vote cast on
//     another device hydrates correctly with no per-viewer mirror.
//   * AUTHORSHIP is `author.isViewer`. No numeric user id ever reaches the app.
//
// 🔴 The names below — the collection, the mark, the scope — must match what
// `block.manifest.json` declares, or every call is refused at runtime
// (`collection_not_declared`, an undeclared mark). `src/storage-manifest.test.ts`
// pins that relationship.

import { StorageError, type Scope, type StorageDocument } from '@civitai/sdk';

import { getDocumentStorage, requestGrants } from './client.js';
import type { RequestItem, RequestStore, RequestValue, SortMode } from './types.js';

/** The declared shared collection the board lives in. */
export const REQUESTS_COLLECTION = 'requests';
/** The declared per-viewer mark that is a vote. */
export const VOTE_MARK = 'vote';
/** The built-in mark on every shared collection; files for Civitai moderator review. */
export const REPORT_MARK = 'report';
/** Creating or editing a document other viewers read needs this consent-gated scope. */
export const PUBLISH_SCOPE: Scope = 'apps:storage:publish';

/**
 * How long a post waits on the consent dialog before giving up. A viewer who
 * closes the dialog sends NOTHING (the SDK's grant only ever resolves on a
 * re-minted token or an "ungrantable" push), so an unbounded wait would leave
 * the composer spinning forever. On expiry the post fails with the consent copy
 * ("allow it, then try again"); a grant that lands later still counts, since the
 * next attempt goes out under the re-minted token.
 */
export const CONSENT_WAIT_MS = 30_000;

/** The store's built-in sort for each board order. Ties break on key, server-side. */
export const SORT_PARAM: Record<SortMode, string> = {
  top: `-mark:${VOTE_MARK}`,
  newest: '-createdAt',
};

/** Map one stored document onto the row the board renders. */
export function toRequestItem(doc: StorageDocument<RequestValue>): RequestItem {
  return {
    key: doc.key,
    // `data` was written by some viewer's copy of this app, possibly an older
    // one, so its shape is a fact about the data rather than a promise.
    // `isWellFormedItem` (format.ts) is what drops a row that does not fit.
    value: doc.data,
    count: doc.marks[VOTE_MARK] ?? 0,
    viewerVoted: doc.viewer?.marks.includes(VOTE_MARK) ?? false,
    own: doc.author.kind === 'user' && doc.author.isViewer,
    version: doc.version,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Only the persisted fields: an absent body is OMITTED, never stored as `undefined`. */
function toData(value: RequestValue): RequestValue {
  return value.body ? { title: value.title, body: value.body } : { title: value.title };
}

/**
 * Run a write that needs `apps:storage:publish`; if the viewer has not granted
 * it yet, ask once through the host's consent dialog and retry once.
 *
 * A declined (or ungrantable) consent re-throws the ORIGINAL `consent_required`
 * refusal, so the board's error mapping explains it rather than a generic
 * failure. Nothing retries more than once.
 */
async function withPublishConsent<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!(err instanceof StorageError) || err.code !== 'consent_required') throw err;
    const granted = await requestGrants([PUBLISH_SCOPE], {
      signal: AbortSignal.timeout(CONSENT_WAIT_MS),
    }).catch(() => false);
    if (!granted) throw err;
    return write();
  }
}

async function requests() {
  return (await getDocumentStorage()).collection<RequestValue>(REQUESTS_COLLECTION);
}

/**
 * The board's store. Stateless and safe to build per render — every method
 * resolves the storage client on use, so the host handshake happens once.
 */
export function createRequestStore(): RequestStore {
  return {
    async list({ sort, limit, cursor }) {
      const page = await (await requests()).list({
        sort: SORT_PARAM[sort],
        ...(limit != null ? { limit } : {}),
        ...(cursor != null ? { cursor } : {}),
      });
      return {
        items: page.items.map(toRequestItem),
        // `null` exactly on the last page; the board's contract is "absent".
        ...(page.nextCursor != null ? { nextCursor: page.nextCursor } : {}),
      };
    },

    // The collection is re-resolved on the retry, not captured: after a grant
    // the write must go out under the storage client that holds the new grant.
    async append(value) {
      return toRequestItem(
        await withPublishConsent(async () => (await requests()).create(toData(value))),
      );
    },

    async update(key, value, { ifVersion }) {
      return toRequestItem(
        await withPublishConsent(async () =>
          (await requests()).put(key, toData(value), { ifVersion }),
        ),
      );
    },

    async vote(key) {
      // `count` is always present for a DECLARED mark (only `report`'s is
      // withheld); `undefined` is passed through rather than read as 0, so the
      // board keeps its optimistic tally instead of rendering a wrong one.
      return (await (await requests()).mark(key, VOTE_MARK)).count;
    },

    async unvote(key) {
      return (await (await requests()).unmark(key, VOTE_MARK)).count;
    },

    async withdraw(key) {
      return (await requests()).delete(key);
    },

    async report(key) {
      await (await requests()).mark(key, REPORT_MARK);
    },
  };
}
