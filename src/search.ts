// Fuzzy search over the loaded board.
//
// 🔴 HORIZON: there is no server-side search. This filters the rows the block
// has actually loaded and nothing else, so past the scan horizon a request that
// exists will simply not appear — which reads to a viewer as "no such request".
// The UI therefore states the horizon whenever a search is active, reusing the
// same disclosure pattern the "Top" ranking already used. Do not remove that
// note without also removing this filter.
//
// Pure + framework-free so it is covered by fast node unit tests with literal
// expected values.

import type { SharedListItem } from '@civitai/blocks-react';

/** Lowercase, strip punctuation to spaces, collapse runs. Total. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Is `needle` a subsequence of `haystack` (chars in order, gaps allowed)? */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1;
  }
  return i === needle.length;
}

// Score bands. Deliberately coarse and literal so a unit test pins VALUES rather
// than re-deriving the formula it is supposed to be checking.
export const SCORE_PREFIX = 1;
export const SCORE_WORD_START = 0.9;
export const SCORE_SUBSTRING = 0.75;
export const SCORE_SUBSEQUENCE = 0.4;
export const SCORE_NONE = 0;

/**
 * How well a single query token matches a single normalized field.
 * Returns one of the SCORE_* bands above — never an interpolated value.
 */
export function tokenScore(token: string, normalizedField: string): number {
  if (token.length === 0) return SCORE_NONE;
  const idx = normalizedField.indexOf(token);
  if (idx === 0) return SCORE_PREFIX;
  if (idx > 0) {
    // A match right after a space starts a word — much stronger signal than a
    // match buried mid-word ("ext" in "text").
    return normalizedField[idx - 1] === ' ' ? SCORE_WORD_START : SCORE_SUBSTRING;
  }
  return isSubsequence(token, normalizedField) ? SCORE_SUBSEQUENCE : SCORE_NONE;
}

/** Bonus added once when EVERY query token matched inside the title. */
export const TITLE_BONUS = 0.25;

/**
 * Relevance of one request to a query. `0` means "does not match" and the row is
 * filtered out; anything above is a match. Every query token must match
 * somewhere (title or body) — an AND, so adding a word narrows rather than
 * widens, which is what people expect from a search box.
 */
export function requestScore(query: string, item: SharedListItem): number {
  const q = normalize(query);
  if (q.length === 0) return SCORE_NONE;
  const tokens = q.split(' ');

  const title = normalize(item.value.title ?? '');
  const body = normalize(item.value.body ?? '');
  const both = body.length > 0 ? `${title} ${body}` : title;

  let total = 0;
  let allInTitle = true;
  for (const t of tokens) {
    const inTitle = tokenScore(t, title);
    const best = inTitle > 0 ? inTitle : tokenScore(t, both);
    if (best === SCORE_NONE) return SCORE_NONE; // AND semantics
    if (inTitle === 0) allInTitle = false;
    total += best;
  }
  const mean = total / tokens.length;
  return allInTitle ? mean + TITLE_BONUS : mean;
}

/**
 * Filter the board by a query, PRESERVING the caller's order.
 *
 * Order is deliberately not relevance: the list's own sort (Top by votes, or
 * Newest) is the promise the toolbar makes, and re-ranking on relevance would
 * quietly break it — "search within the top-voted requests" is the honest
 * reading. An empty/whitespace query returns the input unchanged (same array
 * contents, new array), never an empty list.
 */
export function filterRequests(query: string, items: SharedListItem[]): SharedListItem[] {
  if (normalize(query).length === 0) return items.slice();
  return items.filter((it) => requestScore(query, it) > SCORE_NONE);
}
