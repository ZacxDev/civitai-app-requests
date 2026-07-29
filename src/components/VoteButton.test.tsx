// VoteButton a11y + toggle affordances. A pure-props component (pack Button), so
// it renders without providers. Asserts the toggle exposes an accurate accessible
// name and `aria-pressed` in BOTH states, forwards clicks, and guards while busy —
// the affordances a screen reader relies on, and the ones the design-system pass
// added. An unasserted affordance regresses silently on the next refactor.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VoteButton } from './VoteButton.js';

describe('VoteButton a11y + interaction', () => {
  it('exposes aria-pressed=false and an "Up-vote" accessible name when NOT voted', () => {
    render(<VoteButton count={12} voted={false} onClick={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Up-vote (12)' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('vote-count')).toHaveTextContent('12');
  });

  it('exposes aria-pressed=true and a "Remove your vote" accessible name when voted', () => {
    render(<VoteButton count={13} voted onClick={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Remove your vote (13)' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an explicit "Voted" affordance (check + label) only in the voted state', () => {
    const { rerender } = render(<VoteButton count={5} voted={false} onClick={vi.fn()} />);
    // Not voted: no voted indicator, count shows the bare number.
    expect(screen.queryByTestId('voted-indicator')).toBeNull();
    expect(screen.getByTestId('vote-count')).toHaveTextContent('5');
    expect(screen.getByTestId('vote-count')).not.toHaveTextContent('Voted');

    // Voted: a distinct check indicator appears and the label reads "Voted".
    rerender(<VoteButton count={6} voted onClick={vi.fn()} />);
    expect(screen.getByTestId('voted-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('vote-count')).toHaveTextContent('Voted');
    // The count is still legible alongside the affordance.
    expect(screen.getByTestId('vote-count')).toHaveTextContent('6');
  });

  it('forwards a click when not busy', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<VoteButton count={1} voted={false} onClick={onClick} />);
    await user.click(screen.getByTestId('vote-btn'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled (guarding double-clicks) while busy', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<VoteButton count={1} voted={false} busy onClick={onClick} />);
    const btn = screen.getByTestId('vote-btn');
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
