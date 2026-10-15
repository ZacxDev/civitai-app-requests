// 🔴 THE SEAM BETWEEN THE CODE AND THE MANIFEST'S `storage` DECLARATION.
//
// The document store refuses, at RUNTIME, any collection the approved manifest
// does not declare (`collection_not_declared`) and any mark it does not list.
// Nothing at build time connects the names `src/platform/requests.ts` sends to
// the names `block.manifest.json` declares — a rename on either side
// type-checks, builds, and ships a board where every call fails.
//
// The e2e suite would catch most of that too (its fake is built FROM the
// manifest), but only for the paths it happens to drive. This pins the
// RELATIONSHIP directly: every name the code uses is declared, the declaration
// asks for nothing the code does not use, and the scopes are exactly what the
// declaration needs — no more (a review-gated, consent-gated scope is a cost to
// every viewer), no less.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PUBLISH_SCOPE,
  REPORT_MARK,
  REQUESTS_COLLECTION,
  SORT_PARAM,
  VOTE_MARK,
} from './platform/requests.js';

interface Collection {
  visibility?: string;
  write?: string;
  marks?: string[];
  counters?: string[];
  indexes?: Record<string, string>;
  showAuthor?: boolean;
}
interface Manifest {
  scopes: string[];
  scopeJustifications?: Record<string, string>;
  storage?: { collections: Record<string, Collection> };
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'block.manifest.json'), 'utf8'),
) as Manifest;

describe('block.manifest.json `storage` ↔ src/platform/requests.ts', () => {
  const collections = manifest.storage?.collections ?? {};
  const requests = collections[REQUESTS_COLLECTION];

  it('declares exactly the one collection the board uses', () => {
    expect(Object.keys(collections)).toEqual([REQUESTS_COLLECTION]);
  });

  it('is a SHARED collection viewers write as authors (`own`)', () => {
    // `own`: eligible viewers create; only the author edits or deletes. That is
    // the board's edit/withdraw model. (`anyone`/`owner` are refused in phase 1.)
    expect(requests?.visibility).toBe('shared');
    expect(requests?.write).toBe('own');
  });

  it('declares the vote mark the code sets — and does NOT declare the built-in report', () => {
    expect(requests?.marks).toEqual([VOTE_MARK]);
    // `report` is built in on every shared collection; declaring it is refused.
    expect(requests?.marks).not.toContain(REPORT_MARK);
  });

  it('every sort the board sends is a built-in sort or a DECLARED mark', () => {
    for (const param of Object.values(SORT_PARAM)) {
      const field = param.replace(/^-/, '');
      if (field.startsWith('mark:')) {
        expect(requests?.marks).toContain(field.slice('mark:'.length));
      } else {
        expect(['key', 'createdAt', 'updatedAt']).toContain(field);
      }
    }
  });

  it('declares nothing the board does not use (no counters, indexes or author names)', () => {
    expect(requests?.counters).toBeUndefined();
    expect(requests?.indexes).toBeUndefined();
    // `showAuthor` would hand every reader each author's username. The board
    // renders one uniform author label, so it must not ask for them.
    expect(requests?.showAuthor).toBeUndefined();
  });
});

describe('scopes', () => {
  it('are exactly what the declaration needs, with the legacy shared-store scopes gone', () => {
    expect([...manifest.scopes].sort()).toEqual(
      ['apps:storage', PUBLISH_SCOPE, 'user:read:self'].sort(),
    );
    expect(manifest.scopes.filter((s) => s.startsWith('apps:storage:shared'))).toEqual([]);
  });

  it('justify the sensitive publish scope (required at submit)', () => {
    expect(manifest.scopeJustifications?.[PUBLISH_SCOPE]?.trim().length ?? 0).toBeGreaterThan(0);
    // Justifications for scopes not requested are rejected at submit.
    for (const key of Object.keys(manifest.scopeJustifications ?? {})) {
      expect(manifest.scopes).toContain(key);
    }
  });
});
