import { describe, expect, it } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

import {
  authorLabel,
  isOverLimit,
  isOwnEntry,
  lengthHint,
  relativeTime,
  sortItems,
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
  it('shows "user #N" for others', () => {
    expect(authorLabel(42, 7)).toBe('user #42');
  });
  it('shows "user #N" when the viewer is anonymous', () => {
    expect(authorLabel(42, null)).toBe('user #42');
    expect(authorLabel(42, undefined)).toBe('user #42');
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
