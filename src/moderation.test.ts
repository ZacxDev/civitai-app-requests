import { describe, expect, it } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

import {
  buildSuppressionEntry,
  isModerationEntry,
  isOwner,
  MOD_ENTRY_TITLE,
  MOD_KIND,
  MOD_VERSION,
  OWNER_USER_ID,
  suppressedKeys,
  visibleRequests,
} from './moderation.js';

function row(key: string, authorUserId: number, data?: unknown): SharedListItem {
  return {
    key,
    authorUserId,
    value: { title: `Row ${key}`, ...(data !== undefined ? { data } : {}) },
    count: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    viewerVoted: false,
  };
}

function ledger(key: string, target: string, author = OWNER_USER_ID, v = MOD_VERSION) {
  return row(key, author, { kind: MOD_KIND, v, target });
}

describe('isOwner', () => {
  it('is true only for the app owner id', () => {
    expect(isOwner(OWNER_USER_ID)).toBe(true);
    expect(isOwner(8753561)).toBe(true);
  });

  it('is false for everyone else, including anonymous', () => {
    expect(isOwner(7777)).toBe(false);
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
    expect(isOwner(0)).toBe(false);
  });
});

describe('buildSuppressionEntry', () => {
  it('produces a fixed, non-user title and a structural data blob', () => {
    expect(buildSuppressionEntry('abc')).toEqual({
      title: 'Moderation record',
      data: { kind: 'app-requests/suppression', v: 1, target: 'abc' },
    });
    expect(MOD_ENTRY_TITLE).toBe('Moderation record');
  });

  it('🔴 puts NOTHING a person typed into `data` — that field is unmoderated', () => {
    const entry = buildSuppressionEntry('abc');
    const data = entry.data as Record<string, unknown>;
    // Only a marker, a version and a host-minted key. No free text of any kind.
    expect(Object.keys(data).sort()).toEqual(['kind', 'target', 'v']);
    expect(typeof data.target).toBe('string');
  });
});

describe('isModerationEntry', () => {
  it('recognises a ledger row regardless of author', () => {
    expect(isModerationEntry(ledger('l1', 'x'))).toBe(true);
    expect(isModerationEntry(ledger('l2', 'x', 4021))).toBe(true);
  });

  it('does not mistake an ordinary request for one', () => {
    expect(isModerationEntry(row('r1', 4021))).toBe(false);
    expect(isModerationEntry(row('r2', 4021, { some: 'other-app-state' }))).toBe(false);
  });

  it('rejects a malformed record rather than half-honouring it', () => {
    expect(isModerationEntry(row('m1', OWNER_USER_ID, { kind: MOD_KIND, v: 1 }))).toBe(false);
    expect(isModerationEntry(row('m2', OWNER_USER_ID, { kind: MOD_KIND, v: 1, target: '' }))).toBe(false);
    expect(isModerationEntry(row('m3', OWNER_USER_ID, { kind: MOD_KIND, target: 'x' }))).toBe(false);
    expect(isModerationEntry(row('m4', OWNER_USER_ID, 'a string'))).toBe(false);
    expect(isModerationEntry(row('m5', OWNER_USER_ID, null))).toBe(false);
  });
});

describe('suppressedKeys', () => {
  it('collects targets from owner-authored records', () => {
    const keys = suppressedKeys([row('a', 1), ledger('l1', 'a'), ledger('l2', 'b')]);
    expect([...keys].sort()).toEqual(['a', 'b']);
  });

  it('🔴 IGNORES a ledger-shaped record from anyone but the owner', () => {
    // This is the entire security boundary. `data` is unmoderated app structure,
    // so ANY viewer can append a row that looks exactly like a ledger entry.
    const keys = suppressedKeys([ledger('forged', 'victim', 4021)]);
    expect(keys.size).toBe(0);
  });

  it('ignores a record at an unknown version', () => {
    expect(suppressedKeys([ledger('l', 'a', OWNER_USER_ID, 99)]).size).toBe(0);
  });

  it('honours an explicit owner id, so the boundary is testable', () => {
    expect(suppressedKeys([ledger('l', 'a', 4021)], 4021).size).toBe(1);
  });
});

describe('visibleRequests', () => {
  it('hides an owner-suppressed row', () => {
    const out = visibleRequests([row('a', 1), row('b', 1), ledger('l', 'b')]);
    expect(out.map((r) => r.key)).toEqual(['a']);
  });

  it('never renders a ledger row as a request, even a forged one', () => {
    const out = visibleRequests([row('a', 1), ledger('forged', 'a', 4021)]);
    // 'a' survives (the forgery is ignored) and the forged record is not a row.
    expect(out.map((r) => r.key)).toEqual(['a']);
  });

  it('is a no-op on a board with no ledger', () => {
    const rows = [row('a', 1), row('b', 2)];
    expect(visibleRequests(rows).map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('returns a new array', () => {
    const rows = [row('a', 1)];
    expect(visibleRequests(rows)).not.toBe(rows);
  });

  it('suppression is order-independent — a record before its target still hides it', () => {
    const out = visibleRequests([ledger('l', 'b'), row('a', 1), row('b', 1)]);
    expect(out.map((r) => r.key)).toEqual(['a']);
  });
});

describe('the suppression contract', () => {
  it('🔴 has no code path that deletes anything', () => {
    // A guard against the single most likely future mistake: someone reading
    // "moderation" as "delete" and wiring `withdraw()` in here. The platform
    // rejects that anyway (withdraw is author-scoped), so it would fail silently
    // in production and only for rows the owner did not write.
    const source = Object.values({ buildSuppressionEntry, visibleRequests, suppressedKeys })
      .map((f) => f.toString())
      .join('\n');
    expect(source).not.toMatch(/withdraw|delete\s*\(/);
  });
});
