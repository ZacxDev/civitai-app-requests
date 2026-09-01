// End-to-end: drive the REAL <App/> against the published SDK mock host
// (`createMockHost` via `<Harness>`), exercising the actual `SHARED_*`
// postMessage round-trips with no hook mocking. Proves the app integrates with
// the real transport + shared-store contract, not just our fakes.
//
// Covers the three things a happy path cannot: the FAILURE-INJECTION path
// (`shared.failNext` forces `SHARED_UNAVAILABLE`), the ANONYMOUS viewer, and the
// vote-hydration regression.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Harness, type MockSharedSeed } from '@civitai/blocks-react/testing';

import { App } from './App.js';
import { OWNER_USER_ID } from './moderation.js';

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
  return render(
    <Harness
      applyUrlToggles={false}
      showLog={false}
      theme={extra?.theme ?? 'dark'}
      viewer={extra?.viewer === undefined ? VIEWER : extra.viewer}
      shared={{ seed: extra?.seed ?? SEED, failNext: extra?.failNext }}
    >
      <App />
    </Harness>,
  );
}

function rowFor(title: string): HTMLElement {
  const rows = screen.getAllByTestId('request-row');
  const row = rows.find((r) => within(r).queryByText(title));
  if (!row) throw new Error(`no row titled ${title}`);
  return row;
}

describe('e2e against the SDK mock host', () => {
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

  describe('owner moderation', () => {
    it('an owner-authored ledger entry hides its target for every viewer', async () => {
      // Written by the OWNER, so every client honours it.
      renderApp({
        seed: [
          { value: { title: 'Ordinary request' }, authorUserId: 4021, voters: [1] },
          { value: { title: 'Suppressed request' }, authorUserId: 4021, voters: [1, 2] },
          {
            value: {
              title: 'Moderation record',
              // `shared_2` is the host-minted key of the second seed row (the mock
              // mints `shared_<n>` in seed order) — this is the ledger's target.
              data: { kind: 'app-requests/suppression', v: 1, target: 'shared_2' },
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
