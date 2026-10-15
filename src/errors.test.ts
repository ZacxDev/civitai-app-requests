import { StorageError } from '@civitai/sdk';
import { createFakeStorage, FAKE_STORAGE_MODERATION } from '@civitai/sdk/testing';
import { describe, expect, it } from 'vitest';

import {
  ANON_MESSAGE,
  classifyWriteError,
  CONFLICT_MESSAGE,
  CONSENT_MESSAGE,
  CONTENT_REJECTED_MESSAGE,
  GENERIC_MESSAGE,
  GONE_MESSAGE,
  TRUST_GATE_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from './errors.js';

describe('classifyWriteError', () => {
  it('surfaces the server\'s SPECIFIC trust-gate reason instead of a canned line', () => {
    // The real, curated server strings — each must reach the viewer verbatim so
    // the actual failing condition is shown (an email-unverified 3yr-old account
    // must NOT be told to check its account age).
    for (const msg of [
      'Verify your email before contributing',
      'Complete onboarding before contributing',
      'Your account has been restricted',
      'Your account is too new to contribute',
      'A membership is required to contribute',
      'Your account is not eligible for this action',
      'You must verify your email to post',
      'Your account is too new to vote',
      'user is muted',
      'not eligible: finish onboarding first',
    ]) {
      expect(classifyWriteError(new Error(msg)).message).toBe(msg);
    }
  });

  it('strips a bare code prefix from the server reason', () => {
    const c = classifyWriteError(new Error('FORBIDDEN: account must be at least 7 days old'));
    expect(c.kind).toBe('trust');
    expect(c.message).toBe('account must be at least 7 days old');
  });

  it('falls back to the generic gate copy for a bare FORBIDDEN with no reason', () => {
    const c = classifyWriteError(new Error('FORBIDDEN'));
    expect(c.kind).toBe('trust');
    expect(c.message).toBe(TRUST_GATE_MESSAGE);
  });

  it('surfaces the SERVER message verbatim for a content rejection', () => {
    const c = classifyWriteError(new Error('Title exceeds 200 characters'));
    expect(c.kind).toBe('content');
    expect(c.message).toBe('Title exceeds 200 characters');
  });

  it('surfaces an NSFW/blocked content rejection verbatim', () => {
    const c = classifyWriteError(new Error('Request blocked: prohibited content'));
    expect(c.kind).toBe('content');
    expect(c.message).toBe('Request blocked: prohibited content');
  });

  it('classifies anonymous rejections', () => {
    const c = classifyWriteError(new Error('anonymous viewers cannot append'));
    expect(c.kind).toBe('anon');
    expect(c.message).toBe(ANON_MESSAGE);
  });

  it('classifies transient unavailability', () => {
    const c = classifyWriteError(new Error('SHARED_UNAVAILABLE'));
    expect(c.kind).toBe('unavailable');
    expect(c.message).toBe(UNAVAILABLE_MESSAGE);
  });

  it('falls back to a generic message when there is no message', () => {
    expect(classifyWriteError(new Error('')).message).toBe(GENERIC_MESSAGE);
    expect(classifyWriteError(undefined).message).toBe(GENERIC_MESSAGE);
    expect(classifyWriteError(null).message).toBe(GENERIC_MESSAGE);
  });

  it('accepts a bare string or {message} object', () => {
    expect(classifyWriteError('too new to post').kind).toBe('trust');
    expect(classifyWriteError({ message: 'Title exceeds 200 characters' }).message).toBe(
      'Title exceeds 200 characters',
    );
  });
});

// 🔴 The document store refuses with a machine-readable `code`, and the board
// classifies by that code. These cases are driven by REAL refusals — each error
// below is produced by the SDK's fake document store (`createFakeStorage`,
// which runs the platform's storage contract) through the SDK's own client, so
// the objects carry exactly the `code`/`status`/`details` shape the server's
// envelope produces. A hand-built `{ code }` literal would only test this file
// against its own assumptions.
describe('classifyWriteError — document-store refusals, by code', () => {
  const manifest = {
    scopes: ['apps:storage', 'apps:storage:publish', 'user:read:self'],
    storage: { collections: { requests: { visibility: 'shared', write: 'own', marks: ['vote'] } } },
  };

  async function refusal(run: () => Promise<unknown>): Promise<StorageError> {
    try {
      await run();
    } catch (err) {
      expect(err).toBeInstanceOf(StorageError);
      return err as StorageError;
    }
    throw new Error('expected the store to refuse');
  }

  it('sign_in_required (anonymous write) → the sign-in copy', async () => {
    const fake = createFakeStorage({ manifest, viewer: null });
    const err = await refusal(() => fake.storage.collection('requests').create({ title: 'x' }));
    expect([err.status, err.code]).toEqual([401, 'sign_in_required']);
    expect(classifyWriteError(err)).toEqual({ kind: 'anon', message: ANON_MESSAGE });
  });

  it('storage_disabled (503) → the transient copy, never the raw message', async () => {
    const fake = createFakeStorage({ manifest, disabled: true });
    const err = await refusal(() => fake.storage.collection('requests').list());
    expect([err.status, err.code]).toEqual([503, 'storage_disabled']);
    expect(classifyWriteError(err)).toEqual({ kind: 'unavailable', message: UNAVAILABLE_MESSAGE });
  });

  it('not_eligible for a VIEWER reason → the trust gate, with the store\'s own reason', async () => {
    const fake = createFakeStorage({ manifest, viewer: { username: 'newbie', trusted: false } });
    const err = await refusal(() => fake.storage.collection('requests').create({ title: 'x' }));
    expect([err.status, err.code, err.details?.reason]).toEqual([403, 'not_eligible', 'account_too_new']);
    expect(classifyWriteError(err)).toEqual({ kind: 'trust', message: err.message });
  });

  it('not_eligible for an APP reason → generic, not mis-told as an account problem', async () => {
    const fake = createFakeStorage({ manifest, appStatus: 'pending' });
    const err = await refusal(() => fake.storage.collection('requests').list());
    expect([err.code, err.details?.reason]).toEqual(['not_eligible', 'app_not_approved']);
    expect(classifyWriteError(err)).toEqual({ kind: 'generic', message: GENERIC_MESSAGE });
  });

  it('consent_required → the consent copy', async () => {
    const fake = createFakeStorage({ manifest, consent: { revoked: ['apps:storage:publish'] } });
    const err = await refusal(() => fake.storage.collection('requests').create({ title: 'x' }));
    expect([err.status, err.code]).toEqual([403, 'consent_required']);
    expect(classifyWriteError(err)).toEqual({ kind: 'consent', message: CONSENT_MESSAGE });
  });

  it('content_rejected (422) → the content copy', async () => {
    const fake = createFakeStorage({ manifest });
    const err = await refusal(() =>
      fake.storage.collection('requests').create({ title: FAKE_STORAGE_MODERATION.blockedText }),
    );
    expect([err.status, err.code]).toEqual([422, 'content_rejected']);
    expect(classifyWriteError(err)).toEqual({ kind: 'content', message: CONTENT_REJECTED_MESSAGE });
  });

  it('version_conflict (409) → the conflict copy', async () => {
    const fake = createFakeStorage({ manifest });
    const doc = await fake.storage.collection('requests').create({ title: 'x' });
    const err = await refusal(() =>
      fake.storage.collection('requests').put(doc.key, { title: 'y' }, { ifVersion: doc.version + 5 }),
    );
    expect([err.status, err.code]).toEqual([409, 'version_conflict']);
    expect(classifyWriteError(err)).toEqual({ kind: 'conflict', message: CONFLICT_MESSAGE });
  });

  it('not_found (404) → the gone copy', async () => {
    const fake = createFakeStorage({ manifest });
    const err = await refusal(() => fake.storage.collection('requests').mark('NOPE', 'vote'));
    expect([err.status, err.code]).toEqual([404, 'not_found']);
    expect(classifyWriteError(err)).toEqual({ kind: 'gone', message: GONE_MESSAGE });
  });

  it('a report cannot be withdrawn (400 invalid_request) → generic', async () => {
    // The board never offers it; pinned so a future "undo report" learns the
    // store refuses it rather than discovering that in production.
    const fake = createFakeStorage({ manifest });
    const doc = await fake.storage.collection('requests').create({ title: 'x' });
    const err = await refusal(() => fake.storage.collection('requests').unmark(doc.key, 'report'));
    expect([err.status, err.code]).toEqual([400, 'invalid_request']);
    expect(classifyWriteError(err)).toEqual({ kind: 'generic', message: GENERIC_MESSAGE });
  });

  it('rate_limited (429) → the rate copy', () => {
    expect(classifyWriteError(new StorageError(429, 'rate_limited', 'slow down', {})).kind).toBe('rate');
  });

  it('🔴 a code wins over prose: an unknown code never falls into the substring heuristics', () => {
    // "forbidden" would match the TRUST heuristic; the code says otherwise.
    const err = new StorageError(403, 'write_policy', 'forbidden: write_policy', {});
    expect(classifyWriteError(err)).toEqual({ kind: 'generic', message: GENERIC_MESSAGE });
  });
});
