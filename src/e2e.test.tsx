// End-to-end: drive the REAL <App/> against a fake Civitai, with NO hook
// mocking. Everything between the board and the store is the shipping code —
// the platform hooks, `src/platform/requests.ts` (collection, mark and sort
// names, the document mapping, the consent retry) and the SDK's own
// document-store client. Only the server is fake: `createFakeStorage` from
// `@civitai/sdk/testing`, built from this app's real `block.manifest.json`,
// which enforces the platform's storage contract (scopes and consent, the write
// policy, the min-trust gate, anonymous readers, moderation, error envelopes).
//
// Covers what a happy path cannot: FAILURE INJECTION (a 503 on the next
// mutation), a DISABLED store, the ANONYMOUS viewer, an UNTRUSTED viewer,
// publish CONSENT (granted and declined), a CONCURRENT edit, and the
// vote-hydration regression.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import {
  CONFLICT_MESSAGE,
  CONSENT_MESSAGE,
  CONTENT_REJECTED_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from './errors.js';
import { __configurePlatform } from './platform/client.js';
import { REQUESTS_COLLECTION, VOTE_MARK } from './platform/requests.js';
import {
  createFakeBoard,
  DEV_VIEWER,
  type FakeBoardOptions,
  type FakeSeed,
} from './platform/testing.js';
import type { RequestValue } from './platform/types.js';

const SEED: FakeSeed[] = [
  { value: { title: 'Prompt library app' }, authorId: 4021, voters: [1, 2, 3] },
  { value: { title: 'My own idea' }, authorId: DEV_VIEWER.id, voters: [1] },
];

const T = { timeout: 5000 };

async function renderApp(options: FakeBoardOptions = {}) {
  const fake = await createFakeBoard({ seed: SEED, ...options });
  // Installed BEFORE render so the board's first call already sees the fake.
  // `test-setup.ts` resets the singleton between tests, so no fake outlives its
  // own test.
  __configurePlatform(fake.overrides);
  render(<App />);
  return fake;
}

function rowFor(title: string): HTMLElement {
  const rows = screen.getAllByTestId('request-row');
  const row = rows.find((r) => within(r).queryByText(title));
  if (!row) throw new Error(`no row titled ${title}`);
  return row;
}

/** Whether the board's FIRST row is the request with this title. */
function firstRowIs(title: string): boolean {
  const [first] = screen.getAllByTestId('request-row');
  return first != null && within(first).queryByText(title) != null;
}

/** The board's documents as a given viewer reads them, straight from the store. */
async function serverDocs(fake: Awaited<ReturnType<typeof createFakeBoard>>, viewer = DEV_VIEWER) {
  const page = await fake
    .as(viewer)
    .storage.collection<RequestValue>(REQUESTS_COLLECTION)
    .list({ limit: 100 });
  return page.items;
}

describe('e2e against the SDK fake document store', () => {
  it('lists the seeded requests through the real client, tallies from the vote mark', async () => {
    await renderApp();
    expect(await screen.findByText('Prompt library app', {}, T)).toBeInTheDocument();
    expect(screen.getByText('My own idea')).toBeInTheDocument();
    // Three voters cast the `vote` mark -> the tally reads 3.
    expect(within(rowFor('Prompt library app')).getByTestId('vote-count')).toHaveTextContent('3');
  });

  it('own-row affordances come from the store\'s `author.isViewer`, not an id', async () => {
    const user = userEvent.setup();
    await renderApp();
    await screen.findByText('My own idea', {}, T);

    await user.click(within(rowFor('My own idea')).getByTestId('row-menu-btn'));
    expect(await within(rowFor('My own idea')).findByTestId('edit-btn')).toBeInTheDocument();
    expect(within(rowFor('My own idea')).queryByTestId('report-btn')).toBeNull();

    await user.click(within(rowFor('Prompt library app')).getByTestId('row-menu-btn'));
    expect(await within(rowFor('Prompt library app')).findByTestId('report-btn')).toBeInTheDocument();
    expect(within(rowFor('Prompt library app')).queryByTestId('edit-btn')).toBeNull();
  });

  it('casts a real vote: the tally increments and the SERVER holds the viewer\'s mark', async () => {
    const user = userEvent.setup();
    const fake = await renderApp();
    await screen.findByText('Prompt library app', {}, T);

    await user.click(within(rowFor('Prompt library app')).getByTestId('vote-btn'));

    await waitFor(() =>
      expect(within(rowFor('Prompt library app')).getByTestId('vote-count')).toHaveTextContent('4'),
    );
    expect(within(rowFor('Prompt library app')).getByTestId('vote-btn')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Read back from the store, as the viewer: the mark is theirs and counted.
    const doc = (await serverDocs(fake)).find((d) => d.data.title === 'Prompt library app')!;
    expect(doc.marks[VOTE_MARK]).toBe(4);
    expect(doc.viewer?.marks).toContain(VOTE_MARK);
  });

  /**
   * 🔴 REGRESSION — "double-click to unvote".
   *
   * The board is seeded with a request THIS VIEWER has already voted on, exactly
   * as the store reports it after a vote cast on another device. Vote state must
   * hydrate from the document's `viewer.marks`; a client-side guess renders "not
   * voted", the first click is an idempotent no-op `mark`, and the viewer has to
   * click a SECOND time to actually remove their vote.
   */
  it('REGRESSION: hydrates vote state from the server, so ONE click unvotes', async () => {
    const user = userEvent.setup();
    const fake = await renderApp({
      seed: [{ value: { title: 'Already voted by me' }, authorId: 4021, voters: [1, 2, DEV_VIEWER.id] }],
    });
    await screen.findByText('Already voted by me', {}, T);

    const btn = () => within(rowFor('Already voted by me')).getByTestId('vote-btn');
    const count = () => within(rowFor('Already voted by me')).getByTestId('vote-count');

    expect(btn()).toHaveAttribute('aria-pressed', 'true');
    expect(count()).toHaveTextContent('3');

    await user.click(btn());

    await waitFor(() => expect(count()).toHaveTextContent('2'));
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    const [doc] = await serverDocs(fake);
    expect(doc!.marks[VOTE_MARK]).toBe(2);
    expect(doc!.viewer?.marks).not.toContain(VOTE_MARK);
  });

  it('Top is the store\'s vote ranking across pages: a page-2 row can win, and leads', async () => {
    // 40 requests; the board pages 25 at a time. The winner is created at index
    // 30 — on the SECOND page of newest-first order — so only a server-side
    // `-mark:vote` sort can put it on the first page the board loads.
    const filler: FakeSeed[] = Array.from({ length: 40 }, (_, i) => ({
      value: { title: `Filler request ${i}` },
      authorId: 4021,
      voters: [1],
    }));
    filler[30] = {
      value: { title: 'Winner from page two' },
      authorId: 4021,
      voters: Array.from({ length: 12 }, (_, n) => n + 100),
    };
    await renderApp({ seed: filler });

    expect(await screen.findByText('Winner from page two', {}, T)).toBeInTheDocument();
    expect(firstRowIs('Winner from page two')).toBe(true);
    expect(within(rowFor('Winner from page two')).getByTestId('vote-count')).toHaveTextContent('12');
    // One page loaded, and the board says nothing about a ranking horizon.
    expect(screen.getAllByTestId('request-row')).toHaveLength(25);
    expect(screen.queryByTestId('horizon-note')).toBeNull();
  });

  it('Newest is the store\'s `-createdAt`, and Load more follows ITS cursor', async () => {
    const user = userEvent.setup();
    const filler: FakeSeed[] = Array.from({ length: 30 }, (_, i) => ({
      value: { title: `Request ${i}` },
      authorId: 4021,
      // Votes rise with age, so Top and Newest disagree on every position.
      voters: Array.from({ length: i }, (_, n) => n + 1),
    }));
    await renderApp({ seed: filler });
    await screen.findByText('Request 29', {}, T);
    expect(firstRowIs('Request 29')).toBe(true); // Top: most votes

    const newest = within(screen.getByTestId('sort-control'))
      .getAllByRole('radio')
      .find((t) => t.textContent === 'Newest')!;
    await user.click(newest);
    await waitFor(() => expect(firstRowIs('Request 0')).toBe(true)); // seed 0 is the newest
    expect(screen.queryByText('Request 29')).toBeNull(); // on page 2 of THIS order

    await user.click(screen.getByTestId('load-more'));
    expect(await screen.findByText('Request 29', {}, T)).toBeInTheDocument();
    expect(screen.getAllByTestId('request-row')).toHaveLength(30);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('posts a new request: it shows at once, and the server holds it as the viewer\'s', async () => {
    const user = userEvent.setup();
    const fake = await renderApp({ seed: [] });
    await screen.findByText('No requests yet', {}, T);

    await user.click(screen.getByTestId('empty-suggest'));
    await user.type(await screen.findByTestId('title-input'), 'Brand new idea');
    await user.type(screen.getByTestId('body-input'), 'With details');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText('Brand new idea', {}, T)).toBeInTheDocument();
    const [mine] = await serverDocs(fake);
    expect(mine!.data).toEqual({ title: 'Brand new idea', body: 'With details' });
    expect(mine!.author).toEqual({ kind: 'user', isViewer: true });
    // …and to anyone else it is someone else's, with no identity attached.
    const [theirs] = await serverDocs(fake, { id: 4021, username: 'user_4021' });
    expect(theirs!.author).toEqual({ kind: 'user', isViewer: false });
  });

  it('🔴 a fresh 0-vote post stays on screen under Top even when page 1 is full', async () => {
    // Under Top a brand-new request ranks LAST, so on a board longer than one
    // page the reload after posting does not contain it. It must not vanish.
    const user = userEvent.setup();
    const filler: FakeSeed[] = Array.from({ length: 30 }, (_, i) => ({
      value: { title: `Voted request ${i}` },
      authorId: 4021,
      voters: [1, 2],
    }));
    await renderApp({ seed: filler });
    await screen.findByText('Voted request 0', {}, T);

    await user.click(screen.getByTestId('open-composer-btn'));
    await user.type(await screen.findByTestId('title-input'), 'Zero votes yet');
    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() => expect(screen.queryByTestId('title-input')).toBeNull());
    await waitFor(() => expect(firstRowIs('Zero votes yet')).toBe(true));
  });

  it('edits the viewer\'s own request in place — same key, votes kept', async () => {
    const user = userEvent.setup();
    const fake = await renderApp({
      seed: [{ value: { title: 'Typo in titel' }, authorId: DEV_VIEWER.id, voters: [1, 2] }],
    });
    await screen.findByText('Typo in titel', {}, T);
    const [before] = await serverDocs(fake);

    await user.click(within(rowFor('Typo in titel')).getByTestId('row-menu-btn'));
    await user.click(await screen.findByTestId('edit-btn'));
    const input = screen.getByTestId('edit-title-input');
    await user.clear(input);
    await user.type(input, 'Typo in title');
    await user.click(screen.getByTestId('edit-save-btn'));

    expect(await screen.findByText('Typo in title', {}, T)).toBeInTheDocument();
    const [after] = await serverDocs(fake);
    expect(after!.key).toBe(before!.key);
    expect(after!.version).toBe(before!.version + 1);
    expect(after!.marks[VOTE_MARK]).toBe(2);
    expect(within(rowFor('Typo in title')).getByTestId('vote-count')).toHaveTextContent('2');
  });

  it('🔴 an edit that lost a race is REFUSED (version_conflict), not silently overwritten', async () => {
    const user = userEvent.setup();
    const fake = await renderApp({
      seed: [{ value: { title: 'Original text' }, authorId: DEV_VIEWER.id }],
    });
    await screen.findByText('Original text', {}, T);

    // The same viewer edits it from another device after this board loaded.
    const [doc] = await serverDocs(fake);
    await fake
      .as(DEV_VIEWER)
      .storage.collection<RequestValue>(REQUESTS_COLLECTION)
      .put(doc!.key, { title: 'Edited elsewhere' });

    await user.click(within(rowFor('Original text')).getByTestId('row-menu-btn'));
    await user.click(await screen.findByTestId('edit-btn'));
    await user.clear(screen.getByTestId('edit-title-input'));
    await user.type(screen.getByTestId('edit-title-input'), 'Stale edit');
    await user.click(screen.getByTestId('edit-save-btn'));

    expect(await screen.findByText(CONFLICT_MESSAGE, {}, T)).toBeInTheDocument();
    const [after] = await serverDocs(fake);
    expect(after!.data.title).toBe('Edited elsewhere');

    // The board reloaded around the conflict: cancel the stale form and the
    // NEWER text is what the row shows.
    await user.click(screen.getByTestId('edit-cancel-btn'));
    expect(await screen.findByText('Edited elsewhere', {}, T)).toBeInTheDocument();
  });

  it('withdraws the viewer\'s own request from the server', async () => {
    const user = userEvent.setup();
    const fake = await renderApp();
    await screen.findByText('My own idea', {}, T);

    await user.click(within(rowFor('My own idea')).getByTestId('row-menu-btn'));
    await user.click(await screen.findByTestId('withdraw-btn'));
    await user.click(within(screen.getByRole('dialog')).getByTestId('withdraw-confirm-btn'));

    await waitFor(() => expect(screen.queryByText('My own idea')).toBeNull());
    expect((await serverDocs(fake)).map((d) => d.data.title)).toEqual(['Prompt library app']);
  });

  it('reports through the built-in `report` mark and does not hide the row', async () => {
    const user = userEvent.setup();
    const fake = await renderApp();
    await screen.findByText('Prompt library app', {}, T);

    await user.click(within(rowFor('Prompt library app')).getByTestId('row-menu-btn'));
    await user.click(await within(rowFor('Prompt library app')).findByTestId('report-btn'));

    expect(await screen.findByText(/Reported to Civitai moderators/, {}, T)).toBeInTheDocument();
    expect(screen.getByText('Prompt library app')).toBeInTheDocument();
    const reported = fake.store.calls.filter(
      (c) => c.method !== 'GET' && c.path.endsWith('/report') && c.status < 300,
    );
    expect(reported).toHaveLength(1);
  });

  describe('failure injection', () => {
    it('a rejected VOTE rolls the optimistic count back and says why', async () => {
      const user = userEvent.setup();
      await renderApp({
        seed: [{ value: { title: 'Fails to vote' }, authorId: 4021, voters: [1, 2] }],
        failNext: 1,
      });
      await screen.findByText('Fails to vote', {}, T);
      const count = () => within(rowFor('Fails to vote')).getByTestId('vote-count');
      expect(count()).toHaveTextContent('2');

      await user.click(within(rowFor('Fails to vote')).getByTestId('vote-btn'));

      expect(await screen.findByText(UNAVAILABLE_MESSAGE, {}, T)).toBeInTheDocument();
      await waitFor(() => expect(count()).toHaveTextContent('2'));
      expect(within(rowFor('Fails to vote')).getByTestId('vote-btn')).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('a rejected POST keeps the composer open with the draft intact', async () => {
      const user = userEvent.setup();
      await renderApp({ seed: [], failNext: 1 });
      await screen.findByText('No requests yet', {}, T);

      await user.click(screen.getByTestId('empty-suggest'));
      await user.type(await screen.findByTestId('title-input'), 'Doomed idea');
      await user.click(screen.getByTestId('submit-btn'));

      expect(await screen.findByText(UNAVAILABLE_MESSAGE, {}, T)).toBeInTheDocument();
      expect(screen.getByTestId('title-input')).toHaveValue('Doomed idea');
    });

    it('a rejected REPORT surfaces the error rather than a false confirmation', async () => {
      const user = userEvent.setup();
      await renderApp({ seed: [{ value: { title: 'Report me' }, authorId: 4021 }], failNext: 1 });
      await screen.findByText('Report me', {}, T);

      await user.click(within(rowFor('Report me')).getByTestId('row-menu-btn'));
      await user.click(await within(rowFor('Report me')).findByTestId('report-btn'));

      expect(await screen.findByText(UNAVAILABLE_MESSAGE, {}, T)).toBeInTheDocument();
      expect(screen.queryByText(/Reported to Civitai moderators/)).toBeNull();
    });

    it('a DISABLED store (503 storage_disabled) shows a retryable load error, not an empty board', async () => {
      await renderApp({ disabled: true });
      expect(await screen.findByText("Couldn't load requests", {}, T)).toBeInTheDocument();
      expect(screen.getByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
      expect(screen.getByTestId('list-retry')).toBeInTheDocument();
      // 🔴 Never "No requests yet": an outage must not read as an empty board.
      expect(screen.queryByText('No requests yet')).toBeNull();
    });

    it('moderation-rejected text keeps the draft and says so', async () => {
      const user = userEvent.setup();
      await renderApp({ seed: [] });
      await screen.findByText('No requests yet', {}, T);

      await user.click(screen.getByTestId('empty-suggest'));
      // The fake's scanner refuses this term, as the server's scanner refuses
      // real policy violations — `422 content_rejected`.
      await user.type(await screen.findByTestId('title-input'), 'Idea contract-blocked-term');
      await user.click(screen.getByTestId('submit-btn'));

      expect(await screen.findByText(CONTENT_REJECTED_MESSAGE, {}, T)).toBeInTheDocument();
      expect(screen.getByTestId('title-input')).toHaveValue('Idea contract-blocked-term');
    });
  });

  describe('the minimum-trust gate', () => {
    it('an untrusted viewer is told why on a POST, and the draft is kept', async () => {
      const user = userEvent.setup();
      await renderApp({ viewer: { ...DEV_VIEWER, trusted: false } });
      await screen.findByText('Prompt library app', {}, T);

      await user.click(screen.getByTestId('open-composer-btn'));
      await user.type(await screen.findByTestId('title-input'), 'Too new to post');
      await user.click(screen.getByTestId('submit-btn'));

      // `403 not_eligible` with a viewer reason: the store's own message is
      // surfaced (the server's trust-gate copy is curated for viewers).
      expect(await screen.findByText(/cannot write shared data yet/, {}, T)).toBeInTheDocument();
      expect(screen.getByTestId('title-input')).toHaveValue('Too new to post');
    });

    it('…and on a VOTE, which the gate also covers: the optimistic +1 rolls back', async () => {
      const user = userEvent.setup();
      await renderApp({ viewer: { ...DEV_VIEWER, trusted: false } });
      await screen.findByText('Prompt library app', {}, T);

      await user.click(within(rowFor('Prompt library app')).getByTestId('vote-btn'));

      expect(await screen.findByText(/cannot write shared data yet/, {}, T)).toBeInTheDocument();
      await waitFor(() =>
        expect(within(rowFor('Prompt library app')).getByTestId('vote-count')).toHaveTextContent('3'),
      );
    });
  });

  describe('publish consent', () => {
    it('asks once for `apps:storage:publish`, then posts when it is granted', async () => {
      const user = userEvent.setup();
      const fake = await renderApp({ seed: [], revoked: ['apps:storage:publish'], grantConsent: true });
      await screen.findByText('No requests yet', {}, T);

      await user.click(screen.getByTestId('empty-suggest'));
      await user.type(await screen.findByTestId('title-input'), 'Needs consent');
      await user.click(screen.getByTestId('submit-btn'));

      expect(await screen.findByText('Needs consent', {}, T)).toBeInTheDocument();
      expect(fake.grantRequests).toEqual([['apps:storage:publish']]);
      // 🔴 Bounded: a viewer who closes the dialog sends nothing, so an ask
      // without a signal would leave the composer spinning forever.
      expect(fake.grantSignals[0]).toBeInstanceOf(AbortSignal);
      expect((await serverDocs(fake)).map((d) => d.data.title)).toEqual(['Needs consent']);
    });

    it('a DECLINED consent explains itself and keeps the draft', async () => {
      const user = userEvent.setup();
      const fake = await renderApp({ seed: [], revoked: ['apps:storage:publish'], grantConsent: false });
      await screen.findByText('No requests yet', {}, T);

      await user.click(screen.getByTestId('empty-suggest'));
      await user.type(await screen.findByTestId('title-input'), 'Declined');
      await user.click(screen.getByTestId('submit-btn'));

      expect(await screen.findByText(CONSENT_MESSAGE, {}, T)).toBeInTheDocument();
      expect(screen.getByTestId('title-input')).toHaveValue('Declined');
      expect(fake.grantRequests).toHaveLength(1);
      expect(await serverDocs(fake)).toHaveLength(0);
    });

    it('voting does NOT need publish consent (marks need only `apps:storage`)', async () => {
      const user = userEvent.setup();
      const fake = await renderApp({ revoked: ['apps:storage:publish'] });
      await screen.findByText('Prompt library app', {}, T);

      await user.click(within(rowFor('Prompt library app')).getByTestId('vote-btn'));
      await waitFor(() =>
        expect(within(rowFor('Prompt library app')).getByTestId('vote-count')).toHaveTextContent('4'),
      );
      expect(fake.grantRequests).toHaveLength(0);
    });
  });

  describe('anonymous viewer', () => {
    it('reads the board but is offered NO mutation at all', async () => {
      await renderApp({ viewer: null });
      await screen.findByText('Prompt library app', {}, T);

      expect(screen.getAllByTestId('request-row').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('open-composer-btn')).toBeNull();
      expect(screen.queryByTestId('row-menu-btn')).toBeNull();
      expect(screen.queryByTestId('submit-btn')).toBeNull();
      expect(screen.getByTestId('signin-btn')).toBeInTheDocument();
      // Nobody's row is "own" to an anonymous reader.
      expect(screen.queryByTestId('edit-btn')).toBeNull();
    });
  });
});
