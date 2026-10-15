import { describe, expect, it } from 'vitest';

import type { RequestItem } from './platform/index.js';

import {
  authorLabel,
  findSimilarRequests,
  isOverLimit,
  isOwnEntry,
  isWellFormedItem,
  lengthHint,
  relativeTime,
  sortItems,
  titleSimilarity,
  BODY_MAX,
  TITLE_MAX,
} from './format.js';

function item(partial: Partial<RequestItem> & { key: string }): RequestItem {
  return {
    value: { title: 'x' },
    count: 0,
    own: false,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    viewerVoted: false,
    ...partial,
  };
}

describe('authorLabel', () => {
  // 🔴 REGRESSION (0.3.0 → 0.3.1). 0.3.0 returned `you` when the author was the
  // viewer, so every card on your own board said "you" while everyone else's
  // said "A Civitai member". This assertion is RED on 0.3.0.
  it("is the SAME label on the viewer's own row as on anyone else's", () => {
    expect(authorLabel(item({ key: 'mine', own: true }))).toBe('A Civitai member');
    expect(authorLabel(item({ key: 'mine', own: true }))).toBe(
      authorLabel(item({ key: 'theirs', own: false })),
    );
  });

  it('never says "you" for any row', () => {
    for (const own of [true, false]) {
      for (const viewerVoted of [true, false]) {
        const label = authorLabel(item({ key: 'k', own, viewerVoted }));
        expect(label).toBe('A Civitai member');
        expect(label).not.toMatch(/\byou\b/i);
      }
    }
  });

  it('never renders a handle or number', () => {
    expect(authorLabel(item({ key: '01HZX4021', own: false }))).not.toMatch(/#?\d/);
  });
});

describe('isOwnEntry', () => {
  it("is the store's own `author.isViewer` (mapped onto `own`)", () => {
    expect(isOwnEntry(item({ key: 'a', own: true }))).toBe(true);
    expect(isOwnEntry(item({ key: 'b', own: false }))).toBe(false);
  });

  // 🔴 The two must stay INDEPENDENT. Making the label uniform is a copy change;
  // it must not have quietly taken own-post recognition with it, and a later
  // "simplification" that derives one from the other must fail here rather than
  // in production. This is a SEAM guard, not a component guard: it pins the
  // relationship (label constant, gate varies) over the same inputs.
  it('still distinguishes own rows even though the label does not', () => {
    const cases = [item({ key: 'a', own: true }), item({ key: 'b', own: false })];
    for (const c of cases) {
      expect(isOwnEntry(c)).toBe(c.own);
      expect(authorLabel(c)).toBe('A Civitai member');
    }
    // The gate really does vary over this set — otherwise the line above would
    // be pinning a constant against another constant and prove nothing.
    expect(new Set(cases.map(isOwnEntry)).size).toBe(2);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  it('handles just-now / minutes / hours / days', () => {
    expect(relativeTime(new Date('2026-06-01T11:59:30Z'), now)).toBe('just now');
    expect(relativeTime(new Date('2026-06-01T11:30:00Z'), now)).toBe('30m ago');
    expect(relativeTime(new Date('2026-06-01T09:00:00Z'), now)).toBe('3h ago');
    expect(relativeTime(new Date('2026-05-27T12:00:00Z'), now)).toBe('5d ago');
  });
  it('clamps a future date to just-now (no negatives)', () => {
    expect(relativeTime(new Date('2026-06-01T13:00:00Z'), now)).toBe('just now');
  });
});

describe('sortItems', () => {
  // Fixtures chosen so KEY order and CREATED order disagree on every tie: `d`
  // has the highest key but is the oldest, so a tie-break on recency and the
  // server's tie-break on key produce different boards.
  const a = item({ key: 'a', count: 3, createdAt: new Date('2026-01-04') });
  const b = item({ key: 'b', count: 9, createdAt: new Date('2026-01-02') });
  const c = item({ key: 'c', count: 9, createdAt: new Date('2026-01-03') });
  const d = item({ key: 'd', count: 9, createdAt: new Date('2026-01-01') });
  const n1 = item({ key: 'n1', count: 0, createdAt: new Date('2026-02-01') });
  const n2 = item({ key: 'n2', count: 0, createdAt: new Date('2026-02-01') });

  it("top: by tally desc, ties broken by KEY desc — the store's own order for `-mark:vote`", () => {
    expect(sortItems([a, b, c, d], 'top').map((i) => i.key)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('newest: by createdAt desc', () => {
    expect(sortItems([a, b, c, d], 'newest').map((i) => i.key)).toEqual(['a', 'c', 'b', 'd']);
  });
  it("newest: an equal createdAt breaks on KEY desc, as the store's `-createdAt` does", () => {
    expect(sortItems([n1, n2], 'newest').map((i) => i.key)).toEqual(['n2', 'n1']);
    expect(sortItems([n2, n1], 'newest').map((i) => i.key)).toEqual(['n2', 'n1']);
  });
  it('does not mutate the input', () => {
    const input = [a, b, c];
    sortItems(input, 'top');
    expect(input.map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('isWellFormedItem', () => {
  it('accepts a fully-formed row', () => {
    expect(isWellFormedItem(item({ key: 'ok' }))).toBe(true);
  });
  it('rejects rows that would throw in sortItems / render', () => {
    // null / undefined
    expect(isWellFormedItem(null)).toBe(false);
    expect(isWellFormedItem(undefined)).toBe(false);
    // missing value / non-string title
    expect(isWellFormedItem({ ...item({ key: 'x' }), value: undefined } as unknown as RequestItem)).toBe(false);
    expect(isWellFormedItem({ ...item({ key: 'x' }), value: { title: 42 } } as unknown as RequestItem)).toBe(false);
    // createdAt not a Date (e.g. a raw ISO string) — .getTime() would throw
    expect(isWellFormedItem({ ...item({ key: 'x' }), createdAt: '2026-01-01' } as unknown as RequestItem)).toBe(false);
    // invalid Date
    expect(isWellFormedItem({ ...item({ key: 'x' }), createdAt: new Date('nope') } as unknown as RequestItem)).toBe(false);
    // non-number count
    expect(isWellFormedItem({ ...item({ key: 'x' }), count: null } as unknown as RequestItem)).toBe(false);
  });
  it('the guard matches what sortItems requires (a bad row would throw)', () => {
    const bad = { ...item({ key: 'bad' }), createdAt: 'not-a-date' } as unknown as RequestItem;
    expect(isWellFormedItem(bad)).toBe(false);
    // Prove the guard is load-bearing: sortItems throws on exactly this row
    // (two elements so the comparator — which calls `.getTime()` — actually runs).
    // Only `newest` reads the date now: `top` orders by tally then key, as the
    // store does, so it no longer touches `createdAt`. `relativeTime` still
    // does, on every rendered row, so the guard is load-bearing either way.
    const good = item({ key: 'good' });
    expect(() => sortItems([good, bad], 'newest')).toThrow();
    expect(() => relativeTime((bad as RequestItem).createdAt)).toThrow();
  });
});

describe('length hints', () => {
  it('lengthHint reports "used / max"', () => {
    expect(lengthHint('abc', TITLE_MAX)).toBe(`3 / ${TITLE_MAX}`);
  });
  it('isOverLimit trips only past the ceiling', () => {
    expect(isOverLimit('x'.repeat(TITLE_MAX), TITLE_MAX)).toBe(false);
    expect(isOverLimit('x'.repeat(TITLE_MAX + 1), TITLE_MAX)).toBe(true);
    expect(isOverLimit('x'.repeat(BODY_MAX + 1), BODY_MAX)).toBe(true);
  });
});

describe('titleSimilarity', () => {
  it('is 1 for the same meaningful tokens (ignoring case/punctuation/stopwords)', () => {
    expect(titleSimilarity('Dark mode toggle', 'dark-mode toggle!')).toBe(1);
  });
  it('is high for a near-duplicate', () => {
    expect(titleSimilarity('Add a dark mode', 'Dark mode toggle')).toBeGreaterThan(0.34);
  });
  it('is 0 when there is no meaningful overlap', () => {
    expect(titleSimilarity('Prompt library app', 'Video export queue')).toBe(0);
  });
  it('is 0 when a side has only stopwords/short tokens', () => {
    expect(titleSimilarity('the a an app', 'Dark mode toggle')).toBe(0);
  });
  it('is symmetric', () => {
    expect(titleSimilarity('a b c', 'c b a')).toBe(titleSimilarity('c b a', 'a b c'));
  });
});

describe('findSimilarRequests', () => {
  const board = [
    item({ key: 'dm', value: { title: 'Dark mode toggle' } }),
    item({ key: 'pl', value: { title: 'Prompt library with tags' } }),
    item({ key: 'vq', value: { title: 'Video export queue' } }),
  ];

  it('surfaces a near-duplicate already on the board, most-similar first', () => {
    const out = findSimilarRequests('Add a dark mode', board);
    expect(out.map((i) => i.key)).toContain('dm');
    expect(out[0].key).toBe('dm');
  });
  it('returns nothing for an unrelated draft', () => {
    expect(findSimilarRequests('A brand new music studio', board)).toEqual([]);
  });
  it('stays quiet for very short drafts (< 4 chars)', () => {
    expect(findSimilarRequests('Dar', board)).toEqual([]);
  });
  it('caps the number of matches at the requested limit', () => {
    const many = [
      item({ key: 'a', value: { title: 'Prompt library tags' } }),
      item({ key: 'b', value: { title: 'Prompt library folders' } }),
      item({ key: 'c', value: { title: 'Prompt library search' } }),
      item({ key: 'd', value: { title: 'Prompt library sync' } }),
    ];
    expect(findSimilarRequests('Prompt library export', many, 2)).toHaveLength(2);
  });
});
