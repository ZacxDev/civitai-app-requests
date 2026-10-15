// Error classification for the board's store calls (list, post, edit, vote,
// withdraw, report). Pure + framework-free → covered by fast node unit tests.
//
// The document store refuses in ONE envelope with a machine-readable `code`
// (`StorageError.code` in `@civitai/sdk`), so a refusal is classified by that
// code — deterministically, never by guessing at prose. The substring matching
// further down is kept only as the fallback for an error that carries no code
// (a network failure, or anything thrown before a request was made).
//
// Duck-typed on `code` rather than `instanceof StorageError` so this module
// stays free of the SDK: only `src/platform/` imports `@civitai/sdk`.

export type WriteErrorKind =
  | 'anon'
  | 'trust'
  | 'consent'
  | 'content'
  | 'conflict'
  | 'gone'
  | 'rate'
  | 'unavailable'
  | 'generic';

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

/** The viewer declined (or could not be asked for) permission to publish. */
export const CONSENT_MESSAGE =
  'Posting to the board needs your permission to publish here. Allow it when Civitai asks, then try again.';

/** The store's moderation refused the text. */
export const CONTENT_REJECTED_MESSAGE =
  "That didn't pass Civitai's content rules. Please rephrase it and try again.";

/** The document grew past the store's per-document ceiling. */
export const TOO_LARGE_MESSAGE = 'That request is too long to save. Please shorten it.';

/** The app's (or this viewer's) storage allowance is used up. */
export const QUOTA_MESSAGE = 'The board has no room for more right now. Please try again later.';

/** The request changed (edited elsewhere) since this board loaded it; the board reloads. */
export const CONFLICT_MESSAGE =
  'This request changed since the board loaded, so the board has been refreshed. Check the latest version and edit again.';

/** The request is gone — withdrawn by its author or removed by a moderator. */
export const GONE_MESSAGE = 'That request is no longer on the board.';

/** A rate limit fired. */
export const RATE_LIMITED_MESSAGE = "You're doing that a little too fast. Please wait a moment and try again.";

/** `not_eligible` reasons that are about the VIEWER's account (the min-trust gate). */
const TRUST_REASONS = new Set([
  'ineligible',
  'restricted',
  'onboarding_incomplete',
  'email_unverified',
  'account_too_new',
  'membership_required',
]);

/** Store codes that mean "transient — the platform, not the viewer". */
const UNAVAILABLE_CODES = new Set([
  'storage_disabled',
  'service_unavailable',
  'moderation_unavailable',
  'consent_unavailable',
  'internal_error',
  'index_building',
]);

/** A bare uppercase code token (e.g. "FORBIDDEN") carries no reason — not copy. */
function isBareCode(s: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(s);
}

/** Strip a leading tRPC-style code prefix ("FORBIDDEN: …", "FORBIDDEN - …"). */
function stripCodePrefix(s: string): string {
  return s.replace(/^[A-Z][A-Z0-9_]+\s*[:\-]\s*/, '').trim();
}

/** The store's refusal code, when the error carries one. */
function codeOf(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object' || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/** `details.reason` of a store refusal, when present. */
function reasonOf(err: unknown): string | undefined {
  const details = (err as { details?: unknown } | null)?.details;
  if (details == null || typeof details !== 'object') return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * Classify a refusal that carries a document-store `code`. A code this board has
 * no specific copy for gets the generic line, never the store's own message —
 * those are written for developers ("sign in required", "write_policy"), not
 * for viewers. The one exception is the min-trust gate, below.
 */
function classifyStorageCode(code: string, err: unknown): ClassifiedWriteError {
  switch (code) {
    case 'sign_in_required':
    case 'unauthenticated':
      return { kind: 'anon', message: ANON_MESSAGE };
    case 'not_eligible': {
      // The min-trust gate's messages ("Verify your email before contributing",
      // "Your account is too new to contribute", …) are curated server-side and
      // name the exact problem — surface them. Other `not_eligible` reasons are
      // about the APP (not approved, revoked) and have nothing for a viewer.
      const reason = reasonOf(err);
      if (reason === undefined || TRUST_REASONS.has(reason)) {
        const raw = messageOf(err).trim();
        return { kind: 'trust', message: raw.length > 0 && !isBareCode(raw) ? raw : TRUST_GATE_MESSAGE };
      }
      return { kind: 'generic', message: GENERIC_MESSAGE };
    }
    case 'consent_required':
      return { kind: 'consent', message: CONSENT_MESSAGE };
    case 'content_rejected':
      return { kind: 'content', message: CONTENT_REJECTED_MESSAGE };
    case 'too_large':
      return { kind: 'content', message: TOO_LARGE_MESSAGE };
    case 'quota_exceeded':
      return { kind: 'unavailable', message: QUOTA_MESSAGE };
    case 'version_conflict':
      return { kind: 'conflict', message: CONFLICT_MESSAGE };
    case 'not_found':
      return { kind: 'gone', message: GONE_MESSAGE };
    case 'rate_limited':
      return { kind: 'rate', message: RATE_LIMITED_MESSAGE };
    default:
      if (UNAVAILABLE_CODES.has(code)) return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE };
      return { kind: 'generic', message: GENERIC_MESSAGE };
  }
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
 * Classify a rejected store call and produce a graceful message.
 *
 * A refusal carrying a store `code` is decided by the code alone (above). What
 * follows is the FALLBACK for an error without one. Ordering matters: anon first (a signed-out viewer), then the trust gate, then
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
  const code = codeOf(err);
  if (code !== undefined) return classifyStorageCode(code, err);

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
