// The board's data contract, restated locally.
//
// The board reads and writes ONE shared collection of the App Blocks document
// store, `requests` (declared in `block.manifest.json` → `storage`). `@civitai/sdk`
// ships the documents generically (`StorageDocument<T>`, with `marks`, `author`
// and `viewer` blocks); the board renders a narrower, flatter shape, and this
// file is that shape. `./requests.ts` is the one place that maps between them.
//
// Keeping the board on its own type is what let the move off the legacy
// cross-user store stay a change to `src/platform/` plus the handful of call
// sites whose semantics genuinely changed, rather than a rewrite of the board.

/** The board's sort orders. Each maps onto one of the store's built-in sorts. */
export type SortMode = 'top' | 'newest';

/**
 * One request's document `data` — exactly what is persisted, nothing else.
 *
 * Every field is user text, and the whole document is scanned by the store's
 * moderation on every create and edit.
 */
export interface RequestValue {
  title: string;
  /** Optional long-form body. */
  body?: string;
}

/**
 * One request as the board renders it.
 *
 * `createdAt`/`updatedAt` are `Date`s — the SDK revives them from the wire's ISO
 * strings, and `format.ts` calls date methods on them.
 */
export interface RequestItem {
  key: string;
  value: RequestValue;
  /** The `vote` mark's server tally. */
  count: number;
  /**
   * Whether THIS viewer has set the `vote` mark, decided server-side (the
   * document's `viewer.marks`). An anonymous reader always reads `false`, which
   * is correct — anon cannot vote.
   */
  viewerVoted: boolean;
  /**
   * Whether THIS viewer wrote the request (`author.isViewer`). The store never
   * hands an app a numeric author id, so this boolean is the whole of what the
   * board can know about authorship — and all it needs, since it only drives
   * the edit/withdraw affordances.
   */
  own: boolean;
  /** The document version: +1 per data write. Edits are conditional on it. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestPage {
  items: RequestItem[];
  /** Present exactly when the server may hold more rows for THIS query. */
  nextCursor?: string;
}

/** The board's data layer. See `./requests.ts` for what each call maps onto. */
export interface RequestStore {
  /** One page in `sort` order. A cursor is valid only with the sort that issued it. */
  list(opts: { sort: SortMode; limit?: number; cursor?: string }): Promise<RequestPage>;
  /** Create a request authored by the viewer; resolves with the stored document. */
  append(value: RequestValue): Promise<RequestItem>;
  /** Replace the viewer's own request, only if it is still at `ifVersion`. */
  update(key: string, value: RequestValue, opts: { ifVersion: number }): Promise<RequestItem>;
  /** Set the viewer's `vote` mark; resolves with the new tally (`undefined` if the server sent none). */
  vote(key: string): Promise<number | undefined>;
  /** Remove the viewer's `vote` mark; resolves with the new tally (`undefined` if the server sent none). */
  unvote(key: string): Promise<number | undefined>;
  /** Delete the viewer's own request (and, with it, its marks). */
  withdraw(key: string): Promise<{ deleted: boolean }>;
  /** File the built-in `report` mark for Civitai moderator review. */
  report(key: string): Promise<void>;
}

/** The viewer, or `null` when signed out. */
export interface Viewer {
  id: number;
  username?: string;
}

export type Theme = 'light' | 'dark';
