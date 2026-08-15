// The up-vote control — a compact toggle composed from the pack's `<Button>`, so
// every hover / focus / active / disabled state (and the theming) comes from the
// design system for free rather than a hand-rolled clickable element.
//
// It is deliberately PRESENTATIONAL: the optimistic count, the double-click
// guard, the anon → sign-in nudge, and the vote/unvote reconciliation all live in
// <App/> (which owns the shared-storage seam). This component just renders the
// current state and forwards the click — so the app's tested vote flow is
// unchanged by the design pass.

import { Button } from '@civitai/blocks-react/ui';
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
  return (
    <Button
      size="sm"
      variant={voted ? 'filled' : 'light'}
      color="primary"
      disabled={busy}
      onClick={onClick}
      data-testid={testId}
      data-voted={voted ? 'true' : 'false'}
      aria-pressed={voted}
      aria-label={voted ? `Remove your vote (${count})` : `Up-vote (${count})`}
      leftSection={
        // A distinct glyph per state — a check when the viewer has voted, the
        // up-caret otherwise — so the voted state is legible on its own, not only
        // via the fill-vs-light contrast (which some viewers can't distinguish).
        // Purely decorative; the accurate accessible name above carries the state
        // for assistive tech.
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
