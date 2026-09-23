// The "Open on Civitai" landing for a DIRECTLY loaded block.
//
// Ported from the blocks-react bridge package's `BlockGate` when the app moved to
// `@civitai/sdk`, which ships no UI. Without it, a block opened at its own bare
// `app-requests.civit.ai` origin — a shared link, a social unfurl, a crawler —
// hangs forever on the loading state, because nobody is there to send the
// handshake it is waiting for.
//
// It is inert on both paths that DO have a host: an embedded block is never
// top-level, and the dev harness posts its handshake immediately.

import { useEffect, useState, type ReactNode } from 'react';

import { getClient } from './client.js';

const CIVIT_AI_SUFFIX = '.civit.ai';
const CIVITAI_HOST = 'civitai.com';
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** How long to wait for a host before calling a top-level load "direct". */
const DEFAULT_TIMEOUT_MS = 2_500;

/**
 * Derive `civitai.com/apps/run/<slug>` from a deployed block's hostname.
 *
 * Returns `null` for anything that is not a `<slug>.civit.ai` origin, so a
 * localhost or preview host gets the generic copy instead of a broken link.
 */
export function hostToRunUrl(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  // Normalise, then strip trailing FQDN dots with a linear trim rather than a
  // `/\.+$/` regex, which backtracks O(n²) on a string of many dots (ReDoS).
  const normalized = hostname.trim().toLowerCase();
  let end = normalized.length;
  while (end > 0 && normalized.charCodeAt(end - 1) === 46 /* '.' */) end -= 1;
  const host = normalized.slice(0, end);
  if (!host.endsWith(CIVIT_AI_SUFFIX)) return null;
  const slug = host.slice(0, host.length - CIVIT_AI_SUFFIX.length).split('.')[0] ?? '';
  if (!slug || !DNS_LABEL.test(slug)) return null;
  return `https://${CIVITAI_HOST}/apps/run/${slug}`;
}

/**
 * Whether this page is the top-level window.
 *
 * The `window.self === window.top` IDENTITY comparison is used because it is
 * same-origin-safe — unlike reading `window.top.location`, it cannot throw a
 * SecurityError when the parent is another origin.
 */
function isTopLevel(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

/**
 * `true` once the block is known to be loaded directly, with no host.
 *
 * Both conditions must hold: the page is top-level AND no host answered within
 * `timeoutMs`. A host that answers — embedded or harness — clears the timer, so
 * this can never flip true underneath a working block.
 */
export function useDirectLoad(timeoutMs = DEFAULT_TIMEOUT_MS): boolean {
  const [direct, setDirect] = useState(false);

  useEffect(() => {
    if (!isTopLevel()) return;

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) setDirect(true);
    }, timeoutMs);

    void getClient()
      .then(() => {
        // A host answered — this is embedded or harnessed, never direct.
        settled = true;
        clearTimeout(timer);
      })
      .catch(() => {
        /* leave the timer to decide; a rejection IS the direct-load case */
      });

    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [timeoutMs]);

  return direct;
}

const wrapperStyle: React.CSSProperties = {
  minHeight: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
  background: 'var(--civitai-color-surface-2)',
  color: 'var(--civitai-color-text)',
};

const cardStyle: React.CSSProperties = {
  maxWidth: 420,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 24,
  borderRadius: 12,
  background: 'var(--civitai-color-surface-1)',
  border: '1px solid var(--civitai-color-border)',
  textAlign: 'center',
};

const brandStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--civitai-color-primary)',
};

const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 700 };

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  color: 'var(--civitai-color-text-subtle)',
};

const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 4,
  padding: '10px 16px',
  borderRadius: 8,
  background: 'var(--civitai-color-primary)',
  color: 'var(--civitai-color-surface-1)',
  fontWeight: 600,
  textDecoration: 'none',
};

/** The landing shown instead of the board when there is no host. */
export function DirectLoadFallback({ hostname }: { hostname?: string }): React.JSX.Element {
  const runUrl = hostToRunUrl(
    hostname ?? (typeof window === 'undefined' ? null : window.location.hostname),
  );

  return (
    <div style={wrapperStyle} data-testid="direct-load-fallback">
      <div style={cardStyle}>
        <span style={brandStyle}>Civitai App</span>
        <span style={titleStyle}>App Requests</span>
        <span style={bodyStyle}>
          This app runs inside Civitai, where it can see who you are and show the community&rsquo;s
          requests.
        </span>
        {runUrl ? (
          <a style={linkStyle} href={runUrl}>
            Open on Civitai
          </a>
        ) : (
          <a style={linkStyle} href={`https://${CIVITAI_HOST}/apps`}>
            Browse apps on Civitai
          </a>
        )}
      </div>
    </div>
  );
}

export interface BlockGateProps {
  children: ReactNode;
  /** Milliseconds to wait for a host before showing the landing. */
  timeoutMs?: number;
  /** Replaces the default landing. */
  fallback?: ReactNode;
  /** Overrides the hostname the run URL is derived from. A testing seam. */
  hostname?: string;
}

/** Renders `children` when a host is present, the landing when one is not. */
export function BlockGate({
  children,
  timeoutMs,
  fallback,
  hostname,
}: BlockGateProps): React.JSX.Element {
  const directLoad = useDirectLoad(timeoutMs);
  if (directLoad) return <>{fallback ?? <DirectLoadFallback hostname={hostname} />}</>;
  return <>{children}</>;
}
