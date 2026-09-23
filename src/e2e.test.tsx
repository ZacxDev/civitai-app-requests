// End-to-end: drive the REAL <App/> against a fake civitai.com, with NO hook
// mocking. Everything between the board and the network is the shipping code —
// the platform hooks and the whole REST client, including its URL building,
// query parameters, date revival and error handling. Only the server is fake.
//
// 🔴 THIS USED TO DRIVE A MOCK HOST OVER POSTMESSAGE, AND THAT IS EXACTLY WHY IT
// CHANGED. After the move to `@civitai/sdk` the board sends no `SHARED_*`
// messages; it makes HTTP calls. A mock host would now answer a conversation
// nobody is having, and these tests would pass while exercising nothing. The
// fake therefore sits where the real boundary moved to: `fetch`.
//
// Covers the three things a happy path cannot: the FAILURE-INJECTION path
// (`failNext` forces a 503), the ANONYMOUS viewer, and the vote-hydration
// regression.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import { OWNER_USER_ID } from './moderation.js';
import { __configurePlatform } from './platform/client.js';
import { createFakeCivitai, type MockSharedSeed } from './platform/testing.js';

const VIEWER = { id: 7777, username: 'dev-viewer' };

const SEED: MockSharedSeed[] = [
  { value: { title: 'Prompt library app' }, authorUserId: 4021, voters: [1, 2, 3] },
  { value: { title: 'My own idea' }, authorUserId: 7777, voters: [1] },
];

function renderApp(extra?: {
  viewer?: typeof VIEWER | null;
  seed?: MockSharedSeed[];
  failNext?: number;
  theme?: 'light' | 'dark';
}) {
  const fake = createFakeCivitai({
    viewer: extra?.viewer === undefined ? VIEWER : extra.viewer,
    seed: extra?.seed ?? SEED,
    failNext: extra?.failNext,
    theme: extra?.theme ?? 'dark',
  });
  // Installed BEFORE render so the board's first call already sees the fake.
  // `test-setup.ts` resets the singleton between tests, so no fake outlives its
  // own test.
  __configurePlatform({ transport: fake.transport, fetch: fake.fetch });
  return render(<App />);
}

function rowFor(title: string): HTMLElement {
  const rows = screen.getAllByTestId('request-row');
  const row = rows.find((r) => within(r).queryByText(title));
  if (!row) throw new Error(`no row titled ${title}`);
  return row;
}

describe('e2e against a fake civitai.com', () => {
  it('lists the seeded shared entries through the real transport', async () => {
    renderApp();
    expect(await screen.findByText('Prompt library app', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('My own idea')).toBeInTheDocument();
    // Seed voters=[1,2,3] -> count 3.
    expect(within(rowFor('Prompt library app')).getByTestId('vote-count')).toHaveTextContent('3');
  });

  it('casts a real vote and the count increments', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Prompt library app', {}, { timeout: 5000 });

    const row = rowFor('Prompt library app');
    await user.click(within(row).getByTestId('vote-btn'));

    await waitFor(() =>
      expect(within(rowFor('Prompt library app')).getByTestId('vote-count')).toHaveTextContent('4'),
    );
    expect(within(rowFor('Prompt library app')).getByTestId('vote-btn')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /**
   * 🔴 REGRESSION — "double-click to unvote".
   *
   * The board is seeded with a row THIS VIEWER has already voted on, exactly as
   * the server would report it after a vote cast on another device or in an
   * earlier session. Before the fix, vote state was read from a client-side
   * store that knows nothing about either, so the button rendered "not voted",
   * the first click hit the idempotent `vote()` and changed nothing, and the
   * viewer had to click a SECOND time to actually remove their vote.
   *
   * Matrix: RED at 928f261 (pre-change) — the first assertion fails with
   * aria-pressed="false". GREEN at HEAD.
   */
  it('REGRESSION: hydrates vote state from the server, so ONE click unvotes', async () => {
    const user = userEvent.setup();
    renderApp({
      seed: [
        // `voters` includes the VIEWER's own id — the viewer has already voted.
        { value: { title: 'Already voted by me' }, authorUserId: 4021, voters: [1, 2, VIEWER.id] },
      ],
    });
    await screen.findByText('Already voted by me', {}, { timeout: 5000 });

    const btn = () => within(rowFor('Already voted by me')).getByTestId('vote-btn');
    const count = () => within(rowFor('Already voted by me')).getByTestId('vote-count');

    // Hydrated from `viewerVoted`, not guessed.
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
    expect(count()).toHaveTextContent('3');

    // ONE click removes the vote. (Before the fix this click was a no-op `vote()`.)
    await user.click(btn());

    await waitFor(() => expect(count()).toHaveTextContent('2'));
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('appends a new request through the host and shows it on the board', async () => {
    const user = userEvent.setup();
    renderApp({ seed: [] });
    await screen.findByText('No requests yet', {}, { timeout: 5000 });

    await user.click(screen.getByTestId('empty-suggest'));
    await user.type(await screen.findByTestId('title-input'), 'Brand new idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText('Brand new idea', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  describe('failure injection', () => {
    it('a rejected VOTE rolls the optimistic count back and says why', async () => {
      const user = userEvent.setup();
      renderApp({
        seed: [{ value: { title: 'Fails to vote' }, authorUserId: 4021, voters: [1, 2] }],
        failNext: 1, // the host answers the next SHARED mutation SHARED_UNAVAILABLE
      });
      await screen.findByText('Fails to vote', {}, { timeout: 5000 });

      const count = () => within(rowFor('Fails to vote')).getByTestId('vote-count');
      expect(count()).toHaveTextContent('2');

      await user.click(within(rowFor('Fails to vote')).getByTestId('vote-btn'));

      // The failure is surfaced…
      expect(
        await screen.findByText(/temporarily unavailable/i, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      // …and the optimistic +1 is visibly rolled back.
      await waitFor(() => expect(count()).toHaveTextContent('2'));
      expect(within(rowFor('Fails to vote')).getByTestId('vote-btn')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('a rejected APPEND keeps the composer open with the draft intact', async () => {
      const user = userEvent.setup();
      renderApp({ seed: [], failNext: 1 });
      await screen.findByText('No requests yet', {}, { timeout: 5000 });

      await user.click(screen.getByTestId('empty-suggest'));
      await user.type(await screen.findByTestId('title-input'), 'Doomed idea');
      await user.click(screen.getByTestId('submit-btn'));

      expect(
        await screen.findByText(/temporarily unavailable/i, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      // The composer did NOT close and the typed draft was not thrown away.
      expect(screen.getByTestId('title-input')).toHaveValue('Doomed idea');
    });

    it('a rejected REPORT surfaces the error rather than a false confirmation', async () => {
      const user = userEvent.setup();
      renderApp({
        seed: [{ value: { title: 'Report me' }, authorUserId: 4021, voters: [] }],
        failNext: 1,
      });
      await screen.findByText('Report me', {}, { timeout: 5000 });

      const row = rowFor('Report me');
      await user.click(within(row).getByTestId('row-menu-btn'));
      await user.click(await within(row).findByTestId('report-btn'));

      expect(
        await screen.findByText(/temporarily unavailable/i, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Reported to Civitai moderators/)).toBeNull();
    });
  });

  describe('anonymous viewer', () => {
    it('reads the board but is offered NO mutation at all', async () => {
      renderApp({ viewer: null });
      await screen.findByText('Prompt library app', {}, { timeout: 5000 });

      // Reads work signed out…
      expect(screen.getAllByTestId('request-row').length).toBeGreaterThan(0);
      // …and every mutation affordance is withheld, because the platform would
      // hard-reject each of them.
      expect(screen.queryByTestId('open-composer-btn')).toBeNull();
      expect(screen.queryByTestId('row-menu-btn')).toBeNull();
      expect(screen.queryByTestId('submit-btn')).toBeNull();
      expect(screen.getByTestId('signin-btn')).toBeInTheDocument();
    });
  });

  /**
   * 🔴 CURSOR PAGING, THROUGH THE REAL CLIENT. Added because a mutation sweep
   * found it unguarded: deleting the `cursor` query parameter from
   * `sharedStorage.list()` left the ENTIRE suite green. The board's own paging
   * tests live in `App.test.tsx`, which MOCKS `useSharedStorage` — so they check
   * that the board asks for the next page, never that the client sends the ask.
   * Nothing else here paged, because every other seed is smaller than one page.
   *
   * The board requests `PAGE_SIZE` (25) rows at a time, so the winner is seeded
   * at index 30 — reachable ONLY by following a cursor. With the parameter
   * dropped the server re-serves page 1 forever and this row never appears.
   */
  it('follows the list cursor across pages, so a page-2 row can win Top', async () => {
    const filler: MockSharedSeed[] = Array.from({ length: 40 }, (_, i) => ({
      value: { title: `Filler request ${i}` },
      authorUserId: 4021,
      voters: [1],
    }));
    // Index 30 is on the SECOND page (page size 25) and out-votes everything.
    filler[30] = {
      value: { title: 'Winner from page two' },
      authorUserId: 4021,
      voters: Array.from({ length: 99 }, (_, n) => n + 1),
    };

    renderApp({ seed: filler });

    expect(
      await screen.findByText('Winner from page two', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(rowFor('Winner from page two')).getByTestId('vote-count')).toHaveTextContent('99');
  });

  describe('owner moderation', () => {
    it('an owner-authored ledger entry hides its target for every viewer', async () => {
      // Written by the OWNER, so every client honours it.
      renderApp({
        seed: [
          { value: { title: 'Ordinary request' }, authorUserId: 4021, voters: [1] },
          {
            key: 'row-to-suppress',
            value: { title: 'Suppressed request' },
            authorUserId: 4021,
            voters: [1, 2],
          },
          {
            value: {
              title: 'Moderation record',
              // The ledger names its target by key. The key is PINNED on the seed
              // above rather than guessed: the real server mints an opaque ULID,
              // so a hardcoded key would only ever match a fake's convention.
              data: { kind: 'app-requests/suppression', v: 1, target: 'row-to-suppress' },
            },
            authorUserId: OWNER_USER_ID,
            voters: [],
          },
        ],
      });
      expect(await screen.findByText('Ordinary request', {}, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByText('Suppressed request')).toBeNull();
      expect(screen.queryByText('Moderation record')).toBeNull();
    });
  });
});
