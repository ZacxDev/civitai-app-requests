// Owner moderation for the App Requests board — an owner-authored SUPPRESSION
// ledger, not deletion.
//
// 🔴 READ THIS BEFORE CHANGING ANYTHING HERE.
//
// The shared-storage platform has NO owner-moderation capability. `update` and
// `withdraw` are AUTHOR-scoped (the app owner is not special and is rejected
// FORBIDDEN on someone else's row), and `report()` files for PLATFORM moderator
// review — its own contract states that filing a report does not hide the row.
//
// So what this module implements is a CLIENT-SIDE SOFT-HIDE:
//
//   * the app owner appends an ordinary shared entry that names a target key;
//   * every client filters that target out of the board before rendering.
//
// The targeted row STILL EXISTS server-side, still holds its votes, and is still
// returned by `list()`. It is hidden, not deleted. That distinction is load-
// bearing — a future maintainer who reads this as deletion will make a wrong
// promise to someone about their data being gone. The UI copy says "hide", the
// analytics event says "suppressed", and there is no code path here that removes
// anything.
//
// Trust model: a ledger entry is honoured ONLY when its `authorUserId` equals
// {@link OWNER_USER_ID}. Anyone can append an entry that LOOKS like a ledger
// record — `data` is unmoderated app structure — so the author check is the
// entire security boundary. Never widen it to "any entry with this shape".
//
// Placement of fields: the target key and the marker live in `data` because they
// are STRUCTURAL values, which is what `data` is for. Nothing a person typed
// goes in there — the optional operator reason is deliberately NOT persisted,
// because free text belongs in the moderated `title`/`body` fields and a
// moderation note is not something the board should render.

import type { SharedAppendValue, SharedListItem } from '@civitai/blocks-react';

/**
 * The Civitai user id that owns this app. Only entries authored by this id are
 * honoured as moderation records.
 */
export const OWNER_USER_ID = 8753561;

/** Marker stored in the entry's opaque `data` blob. Versioned so v2 can coexist. */
export const MOD_KIND = 'app-requests/suppression';
export const MOD_VERSION = 1;

/** The title carried by a ledger entry. Visible only if a client fails to filter it. */
export const MOD_ENTRY_TITLE = 'Moderation record';

interface ModData {
  kind: typeof MOD_KIND;
  v: number;
  /** The shared key this record suppresses. */
  target: string;
}

/** True when the viewer is the app owner and may write ledger entries. */
export function isOwner(viewerId: number | null | undefined): boolean {
  return viewerId === OWNER_USER_ID;
}

/** Narrow an unknown `data` blob to a well-formed moderation record. */
function readModData(data: unknown): ModData | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== MOD_KIND) return null;
  if (typeof d.v !== 'number') return null;
  if (typeof d.target !== 'string' || d.target.length === 0) return null;
  return { kind: MOD_KIND, v: d.v, target: d.target };
}

/**
 * Is this row a moderation ledger entry AT ALL (regardless of who wrote it)?
 *
 * Used to keep ledger rows off the board. Note this is deliberately NOT
 * author-checked: a forged record must still not be rendered as a request, even
 * though it must not be honoured as a suppression either.
 */
export function isModerationEntry(item: SharedListItem): boolean {
  return readModData(item.value.data) != null;
}

/**
 * The set of keys suppressed by the OWNER. Forged records — a ledger-shaped
 * entry authored by anyone else — are ignored here, which is the whole security
 * boundary of this feature.
 */
export function suppressedKeys(items: SharedListItem[], ownerId: number = OWNER_USER_ID): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    if (it.authorUserId !== ownerId) continue;
    const d = readModData(it.value.data);
    if (d && d.v === MOD_VERSION) out.add(d.target);
  }
  return out;
}

/**
 * The rows a client should actually render: real requests, minus ledger entries
 * (never rendered), minus owner-suppressed targets (hidden, still on the server).
 */
export function visibleRequests(
  items: SharedListItem[],
  ownerId: number = OWNER_USER_ID,
): SharedListItem[] {
  const hidden = suppressedKeys(items, ownerId);
  return items.filter((it) => !isModerationEntry(it) && !hidden.has(it.key));
}

/**
 * Build the ledger entry the owner appends to hide `targetKey`.
 *
 * The append itself is an ordinary shared write with the ordinary trust gate —
 * there is no privileged call. `title` is a fixed, non-user string so it passes
 * the content belt unremarkably.
 */
export function buildSuppressionEntry(targetKey: string): SharedAppendValue {
  return {
    title: MOD_ENTRY_TITLE,
    data: { kind: MOD_KIND, v: MOD_VERSION, target: targetKey } satisfies ModData,
  };
}
