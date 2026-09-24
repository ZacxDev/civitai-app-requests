// The board's data layer, over REST.
//
// This is the port's substance. The app used to reach cross-user shared storage
// through the host's postMessage bridge (`useSharedStorage()` → `SHARED_LIST`,
// `SHARED_VOTE`, …). It now calls the public routes under
// `/api/v1/blocks/shared-storage/*` directly, authenticated with the block token
// `@civitai/sdk` already holds.
//
// Why the behaviour is unchanged: each REST route is a thin adapter over the
// SAME server function its bridge op called — `list` → `listSharedRows`,
// `vote` → `voteSharedRow`, and so on — so the rows, the ordering, the
// moderation gate and the trust gate are all the same code. What changed is the
// wire, not the policy.
//
// Errors: the SDK's http client turns a non-2xx into an `ApiError` whose
// `message` is the server's own string (it reads both the `{ error }` and
// `{ message }` shapes these routes use). `classifyWriteError` matches on that
// message, so it keeps working untouched.

import { getClient } from './client.js';
import type {
  SharedAppendValue,
  SharedListItem,
  SharedListResult,
  SharedStorage,
} from './types.js';

/** One row as it arrives over JSON — dates are still strings here. */
interface WireItem {
  key: string;
  authorUserId: number;
  value: SharedAppendValue;
  count: number;
  createdAt: string;
  updatedAt: string;
  viewerVoted?: boolean;
}

/**
 * Revive one wire row into the shape the board renders.
 *
 * The dates are the reason this function exists: `format.ts` calls date methods
 * on `createdAt`/`updatedAt`, and JSON has no date type, so without this the
 * rows would type-check and then throw on render.
 *
 * `viewerVoted` is defaulted rather than required because an anonymous read is
 * a supported path and a row with no viewer has nothing to report; `false` is
 * the same answer the server gives that caller.
 */
function reviveItem(raw: WireItem): SharedListItem {
  return {
    key: raw.key,
    authorUserId: raw.authorUserId,
    value: raw.value,
    count: raw.count,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    viewerVoted: raw.viewerVoted ?? false,
  };
}

const BASE = 'blocks/shared-storage';

/**
 * The shared-storage client. Stateless and safe to build per render — every
 * method awaits the client singleton, so the handshake happens once.
 */
export function createSharedStorage(): SharedStorage {
  return {
    async list(opts = {}) {
      const app = await getClient();
      const res = await app.site.get<{ items: WireItem[]; metadata?: { nextCursor?: string } }>(
        `${BASE}/list`,
        {
          query: {
            ...(opts.limit != null ? { limit: opts.limit } : {}),
            ...(opts.cursor != null ? { cursor: opts.cursor } : {}),
            ...(opts.prefix != null ? { prefix: opts.prefix } : {}),
          },
        },
      );
      return {
        items: (res.items ?? []).map(reviveItem),
        nextCursor: res.metadata?.nextCursor,
      } satisfies SharedListResult;
    },

    async append(value) {
      const app = await getClient();
      const res = await app.site.post<{ key: string }>(`${BASE}/append`, { value });
      return { key: res.key };
    },

    async update(key, value) {
      const app = await getClient();
      await app.site.post(`${BASE}/update`, { key, value });
    },

    async vote(key) {
      const app = await getClient();
      const res = await app.site.post<{ count: number }>(`${BASE}/vote`, { key });
      return res.count;
    },

    async unvote(key) {
      const app = await getClient();
      const res = await app.site.post<{ count: number }>(`${BASE}/unvote`, { key });
      return res.count;
    },

    async withdraw(key) {
      const app = await getClient();
      const res = await app.site.post<{ ok?: boolean; deleted?: boolean }>(`${BASE}/withdraw`, {
        key,
      });
      return { ok: res.ok ?? true, deleted: res.deleted ?? true };
    },

    async report(key, reason) {
      const app = await getClient();
      await app.site.post(`${BASE}/report`, { key, ...(reason ? { reason } : {}) });
    },
  };
}
