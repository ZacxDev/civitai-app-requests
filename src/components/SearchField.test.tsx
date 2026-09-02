import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import { SearchField } from './SearchField.js';

/** A controlled wrapper, because the field is controlled by the board. */
function Controlled({ initial = '', summary }: { initial?: string; summary?: string }) {
  const [value, setValue] = useState(initial);
  return <SearchField value={value} onChange={setValue} resultSummary={summary} />;
}

describe('SearchField', () => {
  it('has an accessible name even though the label is visually hidden', () => {
    render(<Controlled />);
    expect(screen.getByRole('searchbox', { name: 'Search requests' })).toBeInTheDocument();
  });

  it('reports what the viewer types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField value="" onChange={onChange} />);

    await user.type(screen.getByTestId('search-input'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('offers no clear button until there is something to clear', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    expect(screen.queryByTestId('search-clear')).toBeNull();

    await user.type(screen.getByTestId('search-input'), 'dark');
    expect(screen.getByTestId('search-clear')).toBeInTheDocument();
  });

  it('the clear button empties the field and is properly named', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="dark" />);

    const clear = screen.getByRole('button', { name: 'Clear search' });
    await user.click(clear);

    expect(screen.getByTestId('search-input')).toHaveValue('');
    expect(screen.queryByTestId('search-clear')).toBeNull();
  });

  it('🔴 announces the match count politely — a silently emptied list is disorienting', () => {
    render(<Controlled initial="dark" summary="1 of 12 loaded requests" />);
    const summary = screen.getByTestId('search-summary');
    expect(summary).toHaveAttribute('role', 'status');
    expect(summary).toHaveAttribute('aria-live', 'polite');
    expect(summary).toHaveTextContent('1 of 12 loaded requests');
  });

  it('keeps the live region mounted when empty, so the first announcement is heard', () => {
    // A region that appears at the same moment as its content is frequently
    // missed by screen readers — it has to already exist.
    render(<Controlled />);
    expect(screen.getByTestId('search-summary')).toBeInTheDocument();
    expect(screen.getByTestId('search-summary')).toHaveTextContent('');
  });

  it('stays type="search" — the reset in index.css needs it, and so do phones', () => {
    // 0.3.2 suppressed Chromium's own ::-webkit-search-cancel-button because it
    // painted a SECOND ✕ next to this component's clear button. The cheap way
    // out would have been type="text", which hides the UA control by throwing
    // away what the type is for: the search-shaped virtual keyboard with a
    // "Search" action key, and the searchbox role the accessible-name test
    // above matches on. Both are cheap to lose by accident and invisible in
    // jsdom, so the type is pinned here rather than left to whoever edits next.
    render(<Controlled initial="dark" />);
    const input = screen.getByTestId('search-input');
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toBe(screen.getByRole('searchbox'));
  });

  it('offers exactly ONE element with a clear-search accessible name', () => {
    // The keyboard/AT half of the 0.3.2 fix. Chromium's UA cancel button is not
    // exposed to assistive tech and is not in the tab order (verified against a
    // real Chromium: one AX node named "Clear search", and Tab from the input
    // lands on this button), so the visual doubling never had an a11y twin.
    // This pins that only ONE named affordance exists here, so a future fix
    // that reaches for a second visible control has to notice.
    render(<Controlled initial="dark" />);
    expect(screen.getAllByRole('button', { name: /clear search/i })).toHaveLength(1);
  });

  it('marks its focus state so the app-owned ring is visible under the skin', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const wrapper = () => screen.getByTestId('search-input').parentElement!;

    expect(wrapper()).toHaveAttribute('data-focused', 'false');
    await user.click(screen.getByTestId('search-input'));
    expect(wrapper()).toHaveAttribute('data-focused', 'true');
  });
});
