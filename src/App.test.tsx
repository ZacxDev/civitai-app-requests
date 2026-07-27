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
}));

vi.mock('@civitai/blocks-react', () => ({
  useBlockContext: () => h.ctx,
  useSharedStorage: () => h.shared,
  useAppStorage: () => h.storage,
  useRequestSignIn: () => ({ requestSignIn: h.requestSignIn }),
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
  h.shared.vote.mockResolvedValue(1);
  h.shared.unvote.mockResolvedValue(0);
  h.shared.withdraw.mockResolvedValue({ ok: true, deleted: true });
});

describe('board rendering', () => {
  it('renders the list newest/top and the header count', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'a', title: 'Alpha idea', count: 2 }),
        makeItem({ key: 'b', title: 'Beta idea', count: 9 }),
      ],
      nextCursor: undefined,
    });
    render(<App />);
    expect(await screen.findByText('Alpha idea')).toBeInTheDocument();
    expect(screen.getByText('Beta idea')).toBeInTheDocument();
    // Default sort is "top" → Beta (9) before Alpha (2).
    const rows = screen.getAllByTestId('request-row');
    expect(within(rows[0]).getByText('Beta idea')).toBeInTheDocument();
    expect(screen.getByText('2 ideas')).toBeInTheDocument();
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

  it('surfaces the friendly trust-gate message on a trust error (no crash)', async () => {
    // A BARE code carries no reason, so errors.ts falls back to the curated gate
    // copy (a specific reason like "FORBIDDEN: account too new" would be surfaced
    // verbatim instead — see classifyWriteError).
    h.shared.append.mockRejectedValueOnce(new Error('FORBIDDEN'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText(TRUST_GATE_MESSAGE)).toBeInTheDocument();
    // Still alive — the form is present.
    expect(screen.getByTestId('submit-btn')).toBeInTheDocument();
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
    // Bare code → the curated gate copy (see the submit trust-gate test above).
    h.shared.vote.mockRejectedValueOnce(new Error('FORBIDDEN'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Gated');

    await user.click(screen.getByTestId('vote-btn'));

    expect(await screen.findByText(TRUST_GATE_MESSAGE)).toBeInTheDocument();
    // Count rolled back to 4, not-voted.
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('4'));
    expect(screen.getByTestId('vote-btn')).toHaveAttribute('aria-pressed', 'false');
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
