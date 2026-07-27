// EmptyState render + inline action. The polish pass requires an empty state to
// carry a title, a muted line, AND (when there's an action) the primary action
// inline — never a lonely "nothing here" string. Assert all render so a copy of
// this template can't silently drop the action.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders the title, the muted body line, and the inline action together', () => {
    render(
      <EmptyState
        data-testid="empty"
        icon="💡"
        title="No requests yet"
        body="Be the first to suggest an app or feature."
        action={<button type="button">Suggest one</button>}
      />,
    );
    expect(screen.getByText('No requests yet')).toBeInTheDocument();
    expect(screen.getByText('Be the first to suggest an app or feature.')).toBeInTheDocument();
    // The primary action is rendered inline, not omitted.
    expect(screen.getByRole('button', { name: 'Suggest one' })).toBeInTheDocument();
  });

  it('renders without a body or action (title-only) without crashing', () => {
    render(<EmptyState data-testid="empty" title="Nothing here" />);
    expect(screen.getByTestId('empty')).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
