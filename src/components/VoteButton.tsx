// The up-vote control — a compact toggle composed from the pack's `<Button>`, so
// every hover / focus / active / disabled state comes from the design system.
// Under the app's skin the pack reads the app-owned `--civitai-color-*` values
// the block root writes, so this button is brand-coloured without hardcoding a
// colour here.
//
// It stays deliberately PRESENTATIONAL: the optimistic count, the in-flight
// guard, the anon → sign-in nudge and the server reconciliation all live in
// <App/>, which owns the shared-storage seam.
//
// 🔴 The `voted` prop is now hydrated from the server's `viewerVoted` rather
// than from a client-side guess. See App.tsx `isVoted()` — that change is the
// double-click-to-unvote fix and this component must never re-derive it.

import type { CSSProperties } from 'react';

import { Button } from '@civitai/blocks-react/ui';
import { useReducedMotion, transitionFor } from '../motion.js';
import { tabularNums } from '../theme.js';

export interface VoteButtonProps {
  count: number;
  /** Whether THIS viewer has voted (drives filled vs light + `aria-pressed`). */
  voted: boolean;
  /** In-flight (a vote/unvote round-trip is pending) — disables to guard double-clicks. */
  busy?: boolean;
  onClick: () => void;
  'data-testid'?: string;
}

export function VoteButton({
  count,
  voted,
  busy = false,
  onClick,
  'data-testid': testId = 'vote-btn',
}: VoteButtonProps): React.JSX.Element {
  const reduced = useReducedMotion();

  return (
    <Button
      size="sm"
      variant={voted ? 'filled' : 'light'}
      color="primary"
      disabled={busy}
      onClick={onClick}
      data-testid={testId}
      data-voted={voted ? 'true' : 'false'}
      data-motion={reduced ? 'reduced' : 'full'}
      aria-pressed={voted}
      aria-label={voted ? `Remove your vote (${count})` : `Up-vote (${count})`}
      style={{
        // Interruptible and short: the fill swap on toggle should feel like a
        // response, not a scene change.
        transition: transitionFor(['background-color', 'color', 'transform'], 'control', reduced),
        ...pillStyle,
      }}
      leftSection={
        // A distinct glyph per state — the app's own upward triangle when not
        // voted, a check when voted — so the state is legible without relying on
        // the fill-vs-light contrast alone. Decorative; the accurate accessible
        // name above carries the state for assistive tech.
        <span
          aria-hidden="true"
          data-testid={voted ? 'voted-indicator' : undefined}
          style={{ fontSize: 11, lineHeight: 1 }}
        >
          {voted ? '✓' : '▲'}
        </span>
      }
    >
      <span
        data-testid="vote-count"
        style={{ ...tabularNums, minWidth: 12, textAlign: 'center', fontWeight: 700 }}
      >
        {voted ? `Voted · ${count}` : count}
      </span>
    </Button>
  );
}

const pillStyle: CSSProperties = {
  borderRadius: 999,
  flexShrink: 0,
};
