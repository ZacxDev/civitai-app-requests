import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

import { TRUST_GATE_MESSAGE } from './errors.js';

// ---- Mock the SDK hook surface. The UI pack (`/ui`) is left REAL — those are
// pure presentational components that render fine in jsdom. ----
const h = vi.hoisted(() => ({
  ctx: {
    ready: true as boolean,
    viewer: { id: 7777, username: 'dev' } as { id: number; username: string | null } | null,
    theme: 'dark' as 'light' | 'dark',
  },
  shared: {
    list: vi.fn(),
    append: vi.fn(),
    update: vi.fn(),
    vote: vi.fn(),
    unvote: vi.fn(),
    withdraw: vi.fn(),
    getCount: vi.fn(),
    getCounts: vi.fn(),
  },
  storage: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getQuota: vi.fn(),
  },
  requestSignIn: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => h.ctx,
  useSharedStorage: () => h.shared,
  useAppStorage: () => h.storage,
  useRequestSignIn: () => ({ requestSignIn: h.requestSignIn }),
  useBlockAnalytics: () => ({ track: h.track }),
  useBlockResize: () => {},
  getTransport: () => ({}),
}));

// Import App AFTER the mock is registered.
import { App } from './App.js';

let keySeq = 0;
function makeItem(o: Partial<SharedListItem> & { title?: string }): SharedListItem {
  keySeq += 1;
  const { title, ...rest } = o;
  return {
    key: o.key ?? `k${keySeq}`,
    authorUserId: 4021,
    value: { title: title ?? `Idea ${keySeq}` },
    count: 0,
    createdAt: new Date(`2026-05-${String((keySeq % 27) + 1).padStart(2, '0')}T00:00:00Z`),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    ...rest,
  };
}

/** A promise you resolve manually — for asserting optimistic/in-flight states. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  keySeq = 0;
  h.ctx.ready = true;
  h.ctx.viewer = { id: 7777, username: 'dev' };
  h.ctx.theme = 'dark';
  h.storage.get.mockResolvedValue(null);
  h.storage.set.mockResolvedValue({ ok: true });
  h.shared.list.mockResolvedValue({ items: [], nextCursor: undefined });
  h.shared.append.mockResolvedValue({ key: 'new-key' });
  h.shared.update.mockResolvedValue(undefined);
  h.shared.vote.mockResolvedValue(1);
  h.shared.unvote.mockResolvedValue(0);
  h.shared.withdraw.mockResolvedValue({ ok: true, deleted: true });
});

describe('board rendering', () => {
  it('renders newest-first by default and shows the header count', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        // Server returns newest-first; `older` is older than `newer`.
        makeItem({ key: 'newer', title: 'Newer idea', count: 2, createdAt: new Date('2026-05-10T00:00:00Z') }),
        makeItem({ key: 'older', title: 'Older idea', count: 9, createdAt: new Date('2026-05-01T00:00:00Z') }),
      ],
      nextCursor: undefined,
    });
    render(<App />);
    expect(await screen.findByText('Newer idea')).toBeInTheDocument();
    expect(screen.getByText('Older idea')).toBeInTheDocument();
    // Default sort is "newest" → Newer (more recent) before Older, even though
    // Older has more votes.
    const rows = screen.getAllByTestId('request-row');
    expect(within(rows[0]).getByText('Newer idea')).toBeInTheDocument();
    expect(screen.getByText('2 ideas')).toBeInTheDocument();
  });

  it('the sort control is an accessible tablist (roles + aria-selected)', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 's1', title: 'Sortable' })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('Sortable');

    const tablist = screen.getByTestId('sort-control');
    expect(tablist).toHaveAttribute('role', 'tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    // Default sort = newest → the Newest tab is selected, Top is not.
    const top = tabs.find((t) => t.textContent === 'Top')!;
    const newest = tabs.find((t) => t.textContent === 'Newest')!;
    expect(newest).toHaveAttribute('aria-selected', 'true');
    expect(top).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the empty state when there are no requests', async () => {
    render(<App />);
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
  });

  it('loads the next page via the cursor on "Load more"', async () => {
    h.shared.list
      .mockResolvedValueOnce({ items: [makeItem({ key: 'p1', title: 'Page one' })], nextCursor: 'cur-1' })
      .mockResolvedValueOnce({ items: [makeItem({ key: 'p2', title: 'Page two' })], nextCursor: undefined });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Page one');

    await user.click(screen.getByTestId('load-more'));

    expect(await screen.findByText('Page two')).toBeInTheDocument();
    expect(h.shared.list).toHaveBeenLastCalledWith({ limit: 25, cursor: 'cur-1' });
  });

  it('"Top" ranks ACROSS pages: a high-vote item on page 2 rises above page 1', async () => {
    // page 1: a low-vote item + more pages; page 2: a high-vote item.
    h.shared.list
      .mockResolvedValueOnce({
        items: [makeItem({ key: 'p1', title: 'Low vote page 1', count: 1 })],
        nextCursor: 'cur-1',
      })
      .mockResolvedValueOnce({
        items: [makeItem({ key: 'p2', title: 'High vote page 2', count: 50 })],
        nextCursor: undefined,
      });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Low vote page 1');
    // Page-2 item isn't loaded yet under the default newest sort.
    expect(screen.queryByText('High vote page 2')).toBeNull();

    // Select "Top" → the bounded whole-board scan pulls page 2, then ranks.
    const tablist = screen.getByTestId('sort-control');
    await user.click(within(tablist).getAllByRole('tab').find((t) => t.textContent === 'Top')!);

    expect(await screen.findByText('High vote page 2')).toBeInTheDocument();
    const rows = screen.getAllByTestId('request-row');
    // The high-vote page-2 item now ranks first — the cross-page correctness fix.
    expect(within(rows[0]).getByText('High vote page 2')).toBeInTheDocument();
  });
});

describe('submit', () => {
  it('appends {title, body} and refreshes the list', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');
    h.shared.list.mockClear();

    await user.type(screen.getByTestId('title-input'), 'Add dark mode');
    await user.type(screen.getByTestId('body-input'), 'Please and thank you');
    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() =>
      expect(h.shared.append).toHaveBeenCalledWith({
        title: 'Add dark mode',
        body: 'Please and thank you',
      }),
    );
    // A refresh list() fires after the append.
    await waitFor(() => expect(h.shared.list).toHaveBeenCalled());
    expect(await screen.findByText('Posted')).toBeInTheDocument();
  });

  it('surfaces the server\'s specific trust-gate reason on a trust error (no crash)', async () => {
    h.shared.append.mockRejectedValueOnce(new Error('FORBIDDEN: account must be 7 days old'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    // The app surfaces the server's SPECIFIC reason verbatim (see errors.ts),
    // not a canned line — so a too-new account isn't mis-told something else.
    expect(await screen.findByText('account must be 7 days old')).toBeInTheDocument();
    // Still alive — the form is present.
    expect(screen.getByTestId('submit-btn')).toBeInTheDocument();
  });

  it('falls back to the canned gate copy when the host gives only a bare code', async () => {
    h.shared.append.mockRejectedValueOnce(new Error('FORBIDDEN'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText(TRUST_GATE_MESSAGE)).toBeInTheDocument();
  });

  it('surfaces the server message verbatim on a content rejection', async () => {
    h.shared.append.mockRejectedValueOnce(new Error('Title exceeds 200 characters'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText('Title exceeds 200 characters')).toBeInTheDocument();
  });
});

describe('voting', () => {
  it('votes with optimistic count then reconciles with the returned total', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'v1', title: 'Votable', count: 3 })],
      nextCursor: undefined,
    });
    const d = deferred<number>();
    h.shared.vote.mockReturnValueOnce(d.promise);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Votable');

    const btn = screen.getByTestId('vote-btn');
    await user.click(btn);

    // Optimistic: count is 3 -> 4 before the server responds.
    expect(h.shared.vote).toHaveBeenCalledWith('v1');
    expect(screen.getByTestId('vote-count')).toHaveTextContent('4');
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    // Server reconciles to a different total (e.g. concurrent votes) -> 5.
    d.resolve(5);
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('5'));
    // Voted-set persisted to the per-viewer KV.
    await waitFor(() =>
      expect(h.storage.set).toHaveBeenCalledWith('voted-request-keys', ['v1']),
    );
  });

  it('unvotes when already voted (voted-set hydrated from KV)', async () => {
    h.storage.get.mockResolvedValue(['u1']); // viewer already voted u1
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'u1', title: 'Already voted', count: 5 })],
      nextCursor: undefined,
    });
    h.shared.unvote.mockResolvedValue(4);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Already voted');

    const btn = screen.getByTestId('vote-btn');
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'));

    await user.click(btn);
    expect(h.shared.unvote).toHaveBeenCalledWith('u1');
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('4'));
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('one vote per user: a double-click does not double count', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'd1', title: 'Double', count: 1 })],
      nextCursor: undefined,
    });
    const d = deferred<number>();
    h.shared.vote.mockReturnValue(d.promise); // stays in-flight across both clicks
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Double');

    const btn = screen.getByTestId('vote-btn');
    await user.click(btn); // first click -> in flight, button busy
    await user.click(btn); // second click -> guarded (no-op)

    expect(h.shared.vote).toHaveBeenCalledTimes(1);

    d.resolve(2);
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('2'));
  });

  it('rolls back and shows a friendly message when a vote hits the trust gate', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'g1', title: 'Gated', count: 4 })],
      nextCursor: undefined,
    });
    h.shared.vote.mockRejectedValueOnce(new Error('account too new to vote'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Gated');

    await user.click(screen.getByTestId('vote-btn'));

    // The async action error is surfaced via a Toast (aria-live region); it
    // carries the server's specific reason.
    expect(await screen.findByText('account too new to vote')).toBeInTheDocument();
    // Count rolled back to 4, not-voted.
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('4'));
    expect(screen.getByTestId('vote-btn')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('edit own request', () => {
  it('edits the author\'s own row in place via update() — preserving key + votes', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'mine', title: 'Typo in titel', authorUserId: 7777, count: 12 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Typo in titel');

    // Own row exposes an Edit affordance.
    await user.click(screen.getByTestId('edit-btn'));
    const titleInput = screen.getByTestId('edit-title-input');
    await user.clear(titleInput);
    await user.type(titleInput, 'Typo in title (fixed)');
    await user.click(screen.getByTestId('edit-save-btn'));

    // update() called with the same key; append() NOT used (votes preserved).
    await waitFor(() =>
      expect(h.shared.update).toHaveBeenCalledWith('mine', { title: 'Typo in title (fixed)' }),
    );
    expect(h.shared.append).not.toHaveBeenCalled();
    // The row now shows the edited title and the vote count is untouched.
    expect(await screen.findByText('Typo in title (fixed)')).toBeInTheDocument();
    expect(screen.getByTestId('vote-count')).toHaveTextContent('12');
  });

  it('does not offer Edit on someone else\'s row', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'theirs', title: 'Not mine', authorUserId: 4021, count: 3 })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('Not mine');
    expect(screen.queryByTestId('edit-btn')).toBeNull();
  });
});

describe('withdraw', () => {
  it('shows withdraw only on the viewer\'s own rows and removes on click', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'mine', title: 'My idea', authorUserId: 7777, count: 1 }),
        makeItem({ key: 'theirs', title: 'Their idea', authorUserId: 4021, count: 1 }),
      ],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('My idea');

    const rows = screen.getAllByTestId('request-row');
    const mineRow = rows.find((r) => r.getAttribute('data-key') === 'mine')!;
    const theirsRow = rows.find((r) => r.getAttribute('data-key') === 'theirs')!;
    expect(within(mineRow).getByTestId('withdraw-btn')).toBeInTheDocument();
    expect(within(theirsRow).queryByTestId('withdraw-btn')).toBeNull();

    await user.click(within(mineRow).getByTestId('withdraw-btn'));
    expect(h.shared.withdraw).toHaveBeenCalledWith('mine');
    await waitFor(() => expect(screen.queryByText('My idea')).toBeNull());
    expect(screen.getByText('Their idea')).toBeInTheDocument();
  });
});

describe('theme tokens', () => {
  it('targets the live design-system --civitai-color-* vars, not the stale --ci-color-*', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 't1', title: 'Themed row', count: 1 })],
      nextCursor: undefined,
    });
    const { container } = render(<App />);
    await screen.findByText('Themed row');

    // The token-retarget root-cause fix: every inline `var(--…-color-…)` must be
    // the design-system's `--civitai-color-*`; NO element may still reference the
    // unresolved `--ci-color-*` names that rendered off-theme in the real host.
    const styled = Array.from(container.querySelectorAll<HTMLElement>('[style]'));
    const html = container.innerHTML;
    expect(html).toContain('--civitai-color-');
    for (const el of styled) {
      const style = el.getAttribute('style') ?? '';
      expect(style).not.toMatch(/--ci-color-/);
      expect(style).not.toContain('text-muted');
    }
  });
});

describe('anonymous viewer', () => {
  it('is read-only: shows a sign-in CTA instead of the form, and voting prompts sign-in', async () => {
    h.ctx.viewer = null;
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'a1', title: 'Anon-visible', count: 3 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Anon-visible');

    // No submit form; a sign-in card instead.
    expect(screen.queryByTestId('submit-btn')).toBeNull();
    expect(screen.getByTestId('signin-btn')).toBeInTheDocument();

    // Voting as anon prompts sign-in rather than mutating.
    await user.click(screen.getByTestId('vote-btn'));
    expect(h.requestSignIn).toHaveBeenCalled();
    expect(h.shared.vote).not.toHaveBeenCalled();
  });
});
