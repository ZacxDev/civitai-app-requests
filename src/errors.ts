// Error classification for shared-storage mutations (`append` / `vote` /
// `unvote` / `withdraw`). The hook rejects with the HOST's error string, so we
// classify it into a small set of kinds and render a graceful message for each.
// Pure + framework-free → covered by fast node unit tests.

export type WriteErrorKind = 'anon' | 'trust' | 'content' | 'unavailable' | 'generic';

export interface ClassifiedWriteError {
  kind: WriteErrorKind;
  /** The message to show the viewer. Never a raw stack — always human-facing. */
  message: string;
}

/** Friendly copy for the server's min-trust gate (age ≥7d / verified / etc.). */
export const TRUST_GATE_MESSAGE =
  'You need a verified account at least 7 days old (and in good standing) to post or vote. ' +
  'Once your account qualifies, come back and add your idea.';

/** Copy when the viewer is signed out and tries to mutate. */
export const ANON_MESSAGE = 'Sign in to post a request or vote.';

/** Fallback when the shared backend is transiently unavailable. */
export const UNAVAILABLE_MESSAGE =
  'The requests service is temporarily unavailable. Please try again in a moment.';

/** Generic last-resort copy when nothing else matches and there's no message. */
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** A bare uppercase code token (e.g. "FORBIDDEN") carries no reason — not copy. */
function isBareCode(s: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(s);
}

/** Strip a leading tRPC-style code prefix ("FORBIDDEN: …", "FORBIDDEN - …"). */
function stripCodePrefix(s: string): string {
  return s.replace(/^[A-Z][A-Z0-9_]+\s*[:\-]\s*/, '').trim();
}

/** Normalize any thrown value into a lowercased message string for matching. */
function messageOf(err: unknown): string {
  if (err == null) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

// Substrings that mark the host's min-TRUST gate rejection. The contract only
// guarantees "the host's error string" (no machine code), so we match the
// vocabulary the trust gate speaks — account age / verification / mute /
// onboarding / eligibility / a generic FORBIDDEN. Anything unmatched falls
// through to the server's own message, so a miss still degrades gracefully
// (the viewer sees the real reason, never a crash or a wrong canned line).
const TRUST_SIGNALS = [
  'trust',
  'verified',
  'verify',
  'email',
  '7 day',
  '7-day',
  'seven day',
  'account age',
  'too new',
  'not eligible',
  'ineligible',
  'eligib',
  'muted',
  'onboard',
  'good standing',
  'forbidden',
];

// Substrings that mark the backend being unavailable/transient.
const UNAVAILABLE_SIGNALS = ['shared_unavailable', 'unavailable', 'timeout', 'timed out'];

// Substrings that mark an anonymous-viewer rejection.
const ANON_SIGNALS = ['anonymous', 'sign in', 'signed in', 'unauthenticated', 'not authenticated'];

/**
 * Classify a rejected shared-storage mutation and produce a graceful message.
 *
 * Ordering matters: anon first (a signed-out viewer), then the trust gate, then
 * unavailable, else the entry is treated as a CONTENT rejection (title too long
 * / HTML / NSFW / minor). In every non-anon/-unavailable case we prefer the
 * SERVER'S OWN message verbatim, because it names the exact problem — the trust
 * gate's rejections ("Verify your email before contributing", "Your account is
 * too new to contribute", …) are curated server-side and already concise and
 * user-appropriate. We only fall back to a canned line when the host gave us
 * nothing usable: the generic gate copy for a bare/empty trust rejection, or
 * {@link GENERIC_MESSAGE} for anything else with no message.
 */
export function classifyWriteError(err: unknown): ClassifiedWriteError {
  const raw = messageOf(err).trim();
  const hay = raw.toLowerCase();

  if (ANON_SIGNALS.some((s) => hay.includes(s))) {
    return { kind: 'anon', message: ANON_MESSAGE };
  }
  if (TRUST_SIGNALS.some((s) => hay.includes(s))) {
    // Surface the server's SPECIFIC reason instead of a one-size-fits-all gate
    // line, so e.g. an email-unverified 3-year-old account isn't mis-told to
    // check its account age. Fall back to the generic copy only when the host
    // gave us nothing but a bare code (e.g. "FORBIDDEN") or an empty string.
    const reason = stripCodePrefix(raw);
    const specific = reason.length > 0 && !isBareCode(reason);
    return { kind: 'trust', message: specific ? reason : TRUST_GATE_MESSAGE };
  }
  if (UNAVAILABLE_SIGNALS.some((s) => hay.includes(s))) {
    return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }
  // Content rejection (or any other host error): surface the server's message,
  // which describes the exact reason. Only fall back to generic if it's empty.
  return { kind: 'content', message: raw.length > 0 ? raw : GENERIC_MESSAGE };
}
