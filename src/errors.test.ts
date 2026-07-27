import { describe, expect, it } from 'vitest';

import {
  ANON_MESSAGE,
  classifyWriteError,
  GENERIC_MESSAGE,
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
