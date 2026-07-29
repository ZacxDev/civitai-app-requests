import { describe, expect, it } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

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

function item(partial: Partial<SharedListItem> & { key: string }): SharedListItem {
  return {
    authorUserId: 1,
    value: { title: 'x' },
    count: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

describe('authorLabel', () => {
  it('shows "you" for the viewer', () => {
    expect(authorLabel(42, 42)).toBe('you');
  });
  it('shows a neutral "A Civitai member" for others (never a raw numeric id)', () => {
    expect(authorLabel(42, 7)).toBe('A Civitai member');
    // The un-resolvable label must not leak the internal numeric handle.
    expect(authorLabel(42, 7)).not.toMatch(/#?\d/);
  });
  it('shows "A Civitai member" when the viewer is anonymous', () => {
    expect(authorLabel(42, null)).toBe('A Civitai member');
    expect(authorLabel(42, undefined)).toBe('A Civitai member');
  });
});

describe('isOwnEntry', () => {
  it('is true only when ids match and viewer is signed in', () => {
    expect(isOwnEntry(5, 5)).toBe(true);
    expect(isOwnEntry(5, 6)).toBe(false);
    expect(isOwnEntry(5, null)).toBe(false);
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
  const a = item({ key: 'a', count: 3, createdAt: new Date('2026-01-03') });
  const b = item({ key: 'b', count: 9, createdAt: new Date('2026-01-01') });
  const c = item({ key: 'c', count: 9, createdAt: new Date('2026-01-02') });

  it('top: by count desc, ties broken by recency', () => {
    const out = sortItems([a, b, c], 'top');
    expect(out.map((i) => i.key)).toEqual(['c', 'b', 'a']);
  });
  it('newest: by createdAt desc', () => {
    const out = sortItems([a, b, c], 'newest');
    expect(out.map((i) => i.key)).toEqual(['a', 'c', 'b']);
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
    expect(isWellFormedItem({ ...item({ key: 'x' }), value: undefined } as unknown as SharedListItem)).toBe(false);
    expect(isWellFormedItem({ ...item({ key: 'x' }), value: { title: 42 } } as unknown as SharedListItem)).toBe(false);
    // createdAt not a Date (e.g. a raw ISO string) — .getTime() would throw
    expect(isWellFormedItem({ ...item({ key: 'x' }), createdAt: '2026-01-01' } as unknown as SharedListItem)).toBe(false);
    // invalid Date
    expect(isWellFormedItem({ ...item({ key: 'x' }), createdAt: new Date('nope') } as unknown as SharedListItem)).toBe(false);
    // non-number count
    expect(isWellFormedItem({ ...item({ key: 'x' }), count: null } as unknown as SharedListItem)).toBe(false);
  });
  it('the guard matches what sortItems requires (a bad row would throw)', () => {
    const bad = { ...item({ key: 'bad' }), createdAt: 'not-a-date' } as unknown as SharedListItem;
    expect(isWellFormedItem(bad)).toBe(false);
    // Prove the guard is load-bearing: sortItems throws on exactly this row
    // (two elements so the comparator — which calls `.getTime()` — actually runs).
    const good = item({ key: 'good' });
    expect(() => sortItems([good, bad], 'newest')).toThrow();
    expect(() => sortItems([good, bad], 'top')).toThrow();
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
