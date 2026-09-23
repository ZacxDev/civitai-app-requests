// The shared-storage contract, restated locally.
//
// These types used to come from the blocks-react bridge package. They are declared here
// now because the app no longer talks to the host bridge for data — it calls the
// public REST routes under `/api/v1/blocks/shared-storage/*` through
// `@civitai/sdk`, which is transport-only and ships no domain types.
//
// The shapes are UNCHANGED from the bridge contract on purpose: the REST routes
// are thin adapters over the SAME server functions the bridge ops call
// (`listSharedRows`, `voteSharedRow`, …), so both transports return the same
// rows. Keeping the shapes identical is what let the port stay a transport swap
// instead of a rewrite of the board.

/**
 * One shared entry's value. `title` is REQUIRED — the shared list is a
 * community-votable list of `{ title, body? }` records and a row without a
 * title has nothing to render.
 */
export interface SharedAppendValue {
  title: string;
  /** Optional long-form body. */
  body?: string;
  /**
   * Opaque, app-owned structured payload stored alongside the moderated
   * `title`/`body`.
   *
   * 🔴 UNMODERATED. The content-safety gate runs on `title`/`body` only, so all
   * user-visible TEXT must live there and only app structure belongs here.
   */
  data?: unknown;
}

/**
 * One SHARED entry as the server returns it.
 *
 * `createdAt`/`updatedAt` are `Date` here but arrive as ISO STRINGS over JSON —
 * the client revives them (see `sharedStorage.ts`). That revival is not
 * cosmetic: `format.ts` calls date methods on these fields, so a raw string
 * would throw at render time rather than fail a type check.
 */
export interface SharedListItem {
  key: string;
  authorUserId: number;
  value: SharedAppendValue;
  count: number;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether THIS viewer has voted on this row, decided server-side. An
   * anonymous caller always reads `false`, which is correct — anon cannot vote.
   */
  viewerVoted: boolean;
}

export interface SharedListResult {
  items: SharedListItem[];
  nextCursor?: string;
}

/** The subset of the shared-storage contract this app actually uses. */
export interface SharedStorage {
  list(opts?: { limit?: number; cursor?: string; prefix?: string }): Promise<SharedListResult>;
  append(value: SharedAppendValue): Promise<{ key: string }>;
  update(key: string, value: SharedAppendValue): Promise<void>;
  vote(key: string): Promise<number>;
  unvote(key: string): Promise<number>;
  withdraw(key: string): Promise<{ ok: boolean; deleted: boolean }>;
  report(key: string, reason?: string): Promise<void>;
}

/** The viewer, or `null` when signed out. */
export interface Viewer {
  id: number;
  username?: string;
}

export type Theme = 'light' | 'dark';
