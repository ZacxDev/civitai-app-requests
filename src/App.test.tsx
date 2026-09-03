import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

import { TRUST_GATE_MESSAGE } from './errors.js';
import { OWNER_USER_ID } from './moderation.js';

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
    get: vi.fn(),
    append: vi.fn(),
    update: vi.fn(),
    vote: vi.fn(),
    unvote: vi.fn(),
    withdraw: vi.fn(),
    report: vi.fn(),
    getCount: vi.fn(),
    getCounts: vi.fn(),
  },
  requestSignIn: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@civitai/blocks-react', async (importOriginal) => ({
  // 🔴 REAL MODULE FIRST, overrides after. The SDK hook surface below is still
  // stubbed; what the spread buys is that `useBlockBreakpoint` is the REAL
  // hook. jsdom has no `ResizeObserver`, so it stays `{ tier: 'base',
  // measured: false }` — the unmeasured state — and src/layout.ts maps that to
  // the REGULAR layout. That is the point: these suites go on asserting the
  // 0.3.3 tree, and they do it against the real hook rather than a stub that
  // could drift from it. The width-tier behaviour is exercised in
  // src/responsive.test.tsx, which sets an observed width explicitly.
  ...(await importOriginal<typeof import('@civitai/blocks-react')>()),
  useBlockContext: () => h.ctx,
  useSharedStorage: () => h.shared,
  useRequestSignIn: () => ({ requestSignIn: h.requestSignIn }),
  useBlockAnalytics: () => ({ track: h.track }),
  useBlockResize: () => {},
  getTransport: () => ({}),
}));

// Import App AFTER the mock is registered.
import { App } from './App.js';

/**
 * The app's own stylesheet, as text, for the 0.3.2 guards near the bottom.
 *
 * Read off disk rather than imported, and via `process.cwd()` rather than
 * `import.meta.url`, because both of the obvious routes are quietly wrong here:
 * `.test.tsx` runs under the `dom` project, where `import.meta.url` is an
 * `http:` URL that `fs` refuses; and `import css from './index.css?raw'`
 * resolves to the EMPTY STRING, because vitest stubs CSS imports out by default
 * (`test.css: false`) and the `?raw` suffix does not exempt it. An empty string
 * is the dangerous one — every `.not.toContain()` below would have passed.
 */
function readIndexCss(): string {
  const source = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  if (source.trim().length === 0) throw new Error('src/index.css read back empty');
  return source;
}

let keySeq = 0;
function makeItem(
  o: Partial<SharedListItem> & { title?: string; body?: string; data?: unknown },
): SharedListItem {
  keySeq += 1;
  const { title, body, data, ...rest } = o;
  return {
    key: o.key ?? `k${keySeq}`,
    authorUserId: 4021,
    value: {
      title: title ?? `Idea ${keySeq}`,
      ...(body !== undefined ? { body } : {}),
      ...(data !== undefined ? { data } : {}),
    },
    count: 0,
    createdAt: new Date(`2026-05-${String((keySeq % 27) + 1).padStart(2, '0')}T00:00:00Z`),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    viewerVoted: false,
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

/** Open the composer modal — posting is a SECONDARY action behind it now. */
async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('open-composer-btn'));
  return screen.findByTestId('title-input');
}

/** Open a row's overflow menu and return it. Edit/withdraw/report live in there. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByTestId('row-menu-btn'));
  return within(row).findByTestId('row-menu');
}

function tabs() {
  return within(screen.getByTestId('sort-control')).getAllByRole('tab');
}

beforeEach(() => {
  vi.clearAllMocks();
  keySeq = 0;
  h.ctx.ready = true;
  h.ctx.viewer = { id: 7777, username: 'dev' };
  h.ctx.theme = 'dark';
  h.shared.list.mockResolvedValue({ items: [], nextCursor: undefined });
  h.shared.append.mockResolvedValue({ key: 'new-key' });
  h.shared.update.mockResolvedValue(undefined);
  h.shared.vote.mockResolvedValue(1);
  h.shared.unvote.mockResolvedValue(0);
  h.shared.withdraw.mockResolvedValue({ ok: true, deleted: true });
  h.shared.report.mockResolvedValue(undefined);
});

describe('board rendering', () => {
  it('defaults to TOP: the most-voted request is first, not the most recent', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        // Server order is newest-first; `newer` has FEWER votes than `older`.
        makeItem({ key: 'newer', title: 'Newer idea', count: 2, createdAt: new Date('2026-05-10T00:00:00Z') }),
        makeItem({ key: 'older', title: 'Older idea', count: 9, createdAt: new Date('2026-05-01T00:00:00Z') }),
      ],
      nextCursor: undefined,
    });
    render(<App />);
    expect(await screen.findByText('Older idea')).toBeInTheDocument();

    const rows = screen.getAllByTestId('request-row');
    // 🔴 The IA decision: the board's primary object is what people want MOST.
    expect(within(rows[0]).getByText('Older idea')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Newer idea')).toBeInTheDocument();
    expect(screen.getByTestId('request-count')).toHaveTextContent('2');
  });

  it('switching to Newest re-orders by recency', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'newer', title: 'Newer idea', count: 2, createdAt: new Date('2026-05-10T00:00:00Z') }),
        makeItem({ key: 'older', title: 'Older idea', count: 9, createdAt: new Date('2026-05-01T00:00:00Z') }),
      ],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Older idea');

    await user.click(tabs().find((t) => t.textContent === 'Newest')!);

    await waitFor(() =>
      expect(within(screen.getAllByTestId('request-row')[0]).getByText('Newer idea')).toBeInTheDocument(),
    );
  });

  it('the sort control is an accessible tablist with Top selected by default', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 's1', title: 'Sortable' })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('Sortable');

    const tablist = screen.getByTestId('sort-control');
    expect(tablist).toHaveAttribute('role', 'tablist');
    const all = within(tablist).getAllByRole('tab');
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.textContent === 'Top')!).toHaveAttribute('aria-selected', 'true');
    expect(all.find((t) => t.textContent === 'Newest')!).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the empty state when there are no requests', async () => {
    render(<App />);
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
  });

  it('exposes a data-condition-independent ready anchor', async () => {
    // The capture recipe anchors on `board-ready`. It must be mounted with ZERO
    // requests AND with many — the old anchor (`submit-btn`) is now inside a
    // modal and would have silently broken the recipe.
    render(<App />);
    await screen.findByText('No requests yet');
    expect(screen.getByTestId('board-ready')).toBeInTheDocument();
    expect(screen.queryByTestId('submit-btn')).toBeNull();
  });

  it('ranks ACROSS pages on cold boot, then stops at the horizon and says so', async () => {
    // A board bigger than the 8-page scan horizon: every page yields a cursor.
    // Page 3 holds the high-vote row, so a page-1-only ranking would miss it.
    h.shared.list.mockImplementation((arg?: { cursor?: string }) => {
      const n = arg?.cursor ? Number(arg.cursor.replace('cur-', '')) : 0;
      return Promise.resolve({
        items: [
          makeItem({
            key: `p${n}`,
            title: n === 3 ? 'High vote deep page' : `Row page ${n}`,
            count: n === 3 ? 50 : 1,
          }),
        ],
        nextCursor: `cur-${n + 1}`,
      });
    });
    render(<App />);
    await screen.findByText('Row page 0');

    // The background scan pulls the deep page and re-ranks it to the top.
    expect(await screen.findByText('High vote deep page')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getAllByTestId('request-row')[0]).getByText('High vote deep page')).toBeInTheDocument(),
    );

    // 🔴 The horizon binds (a cursor survives the cap) → the board SAYS so.
    const note = await screen.findByTestId('horizon-note');
    expect(note).toHaveTextContent('Ranked across the first 9 requests — the board is larger.');
  });

  it('first paint costs exactly ONE list round-trip even though Top is the default', async () => {
    // 🔴 The cold-boot cost of defaulting to a scanned order. Page 1 must reach
    // the screen before the deep scan runs, or making Top the default would be a
    // first-paint regression of up to nine sequential round-trips.
    const page2 = deferred<{ items: SharedListItem[]; nextCursor?: string }>();
    h.shared.list.mockImplementation((arg?: { cursor?: string }) => {
      if (!arg?.cursor) {
        return Promise.resolve({
          items: [makeItem({ key: 'first', title: 'Painted first', count: 1 })],
          nextCursor: 'cur-1',
        });
      }
      return page2.promise;
    });
    render(<App />);

    // Row is on screen while page 2 is still in flight.
    expect(await screen.findByText('Painted first')).toBeInTheDocument();
    expect(screen.queryByTestId('app-loading')).toBeNull();
    expect(screen.getByTestId('scanning')).toBeInTheDocument();

    page2.resolve({ items: [], nextCursor: undefined });
    await waitFor(() => expect(screen.queryByTestId('scanning')).toBeNull());
  });

  it('does not claim a partial ranking when the whole board fits', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'n1', title: 'Only row', count: 1 })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('Only row');
    expect(screen.queryByTestId('horizon-note')).toBeNull();
  });

  it('loads the next page via the cursor on "Load more"', async () => {
    let deepest = 0;
    h.shared.list.mockImplementation((arg?: { cursor?: string }) => {
      const n = arg?.cursor ? Number(arg.cursor.replace('cur-', '')) : 0;
      deepest = Math.max(deepest, n);
      return Promise.resolve({
        items: [makeItem({ key: `p${n}`, title: `Row page ${n}`, count: 1 })],
        nextCursor: `cur-${n + 1}`,
      });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Row page 0');
    await waitFor(() => expect(screen.queryByTestId('scanning')).toBeNull());
    const afterScan = deepest; // the horizon: 8 scan pages past page 1

    await user.click(screen.getByTestId('load-more'));

    // Load more extends PAST the horizon by another scan window.
    await waitFor(() => expect(deepest).toBeGreaterThan(afterScan));
    expect(await screen.findByText(`Row page ${afterScan + 1}`)).toBeInTheDocument();
  });
});

describe('information architecture', () => {
  it('posting is a SECONDARY action behind a composer, not the first thing on screen', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'r1', title: 'A request', count: 3 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('A request');

    // The form is not mounted until asked for.
    expect(screen.queryByTestId('title-input')).toBeNull();
    const cta = screen.getByTestId('open-composer-btn');
    expect(cta).toHaveTextContent('Request an app');
    // Secondary, not filled-primary.
    expect(cta).toHaveAttribute('data-variant', 'light');

    await openComposer(user);
    expect(screen.getByTestId('title-input')).toBeInTheDocument();
  });

  it('drops the explainer copy the controls already show', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'r1', title: 'A request', count: 3 })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('A request');
    // The old footer restated what the vote button and the moderation flow show.
    expect(screen.queryByText(/one vote each/i)).toBeNull();
    expect(screen.queryByText(/Be kind and constructive/i)).toBeNull();
    expect(screen.queryByText(/Suggest an app or feature/i)).toBeNull();
  });

  it('leads with the board: the hero carries the name and one tagline, nothing more', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'r1', title: 'A request', count: 3 })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('A request');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('App Requests');
    expect(screen.getByTestId('hero-tagline')).toHaveTextContent('Ask. Vote. Watch it get built.');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

// 🔴 Both of these are 0.3.1 REGRESSION tests, at the level the defects were
// actually seen at: on the running board, not in a pure function. Each is RED on
// 0.3.0.
describe('0.3.1 fixes, end to end on the board', () => {
  const mixedBoard = () => ({
    items: [
      // The viewer's own row...
      makeItem({ key: 'mine', title: 'My own request', count: 5, authorUserId: 7777 }),
      // ...and someone else's.
      makeItem({ key: 'theirs', title: 'Their request', count: 3, authorUserId: 4021 }),
    ],
    nextCursor: undefined,
  });

  it('never labels a row "you" — every author reads the same', async () => {
    // 0.3.0 rendered "you" on the viewer's own rows, so your own request looked
    // like a different KIND of row from everyone else's.
    h.shared.list.mockResolvedValue(mixedBoard());
    render(<App />);
    await screen.findByText('My own request');

    const rows = screen.getAllByTestId('request-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText('A Civitai member')).toBeInTheDocument();
    }
    // Nothing anywhere on the board says it, in any casing — including the row
    // the viewer wrote, which is the one 0.3.0 got wrong.
    expect(within(rows[0]).queryByText(/\byou\b/i)).toBeNull();
    expect(within(rows[1]).queryByText(/\byou\b/i)).toBeNull();
  });

  it('still recognises the viewer\'s own row through the AFFORDANCES', async () => {
    // The seam: making the label uniform must not have taken own-post
    // recognition with it. `authorLabel` and `isOwnEntry` stay independent.
    h.shared.list.mockResolvedValue(mixedBoard());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('My own request');

    const own = screen.getByText('My own request').closest('[data-testid="request-row"]');
    const other = screen.getByText('Their request').closest('[data-testid="request-row"]');

    const ownMenu = await openRowMenu(user, own as HTMLElement);
    expect(within(ownMenu).getByTestId('edit-btn')).toBeInTheDocument();
    expect(within(ownMenu).getByTestId('withdraw-btn')).toBeInTheDocument();
    expect(within(ownMenu).queryByTestId('report-btn')).toBeNull();

    const otherMenu = await openRowMenu(user, other as HTMLElement);
    expect(within(otherMenu).getByTestId('report-btn')).toBeInTheDocument();
    expect(within(otherMenu).queryByTestId('edit-btn')).toBeNull();
    expect(within(otherMenu).queryByTestId('withdraw-btn')).toBeNull();
  });

  it('seats the hero CTA on its own plate, signed in AND signed out', async () => {
    // 0.3.0 put a `variant="light"` (86%-transparent) amber button straight onto
    // the artwork's brightest region. The plate is what gives it a backdrop.
    h.shared.list.mockResolvedValue(mixedBoard());
    const { unmount } = render(<App />);
    await screen.findByText('My own request');
    expect(screen.getByTestId('hero-action')).toContainElement(
      screen.getByTestId('open-composer-btn'),
    );
    unmount();

    h.ctx.viewer = null;
    render(<App />);
    await screen.findByText('My own request');
    expect(screen.getByTestId('hero-action')).toContainElement(screen.getByTestId('signin-btn'));
  });
});

// 🔴 READ THE LABEL ON EACH TEST BELOW. Neither of them is regression coverage
// for the 0.3.2 defect, and it would be dishonest to count them as such.
//
// The defect was that Chromium painted TWO ✕ controls inside the search field:
// its own ::-webkit-search-cancel-button and the app's clear button. jsdom does
// not render, has no UA pseudo-elements and no layout, so nothing in this file
// can observe it. Every 0.3.1 assertion passed straight through it.
//
// The instrument that CAN see it is `scripts/measure-search-clear.mjs`, which
// drives a real Chromium against the dev harness and counts painted glyph
// clusters: 2 before the fix, 1 after, with the field hovered.
//
// What these two DO buy: the first pins the declaration's presence, and the
// second pins the SEAM — that the selector written in the stylesheet still
// resolves to the rendered input. That seam is the half most likely to rot
// silently, because renaming the app root or changing the input's type would
// leave a perfectly valid CSS rule matching nothing at all.
describe('0.3.2 — the UA search-clear reset', () => {
  /**
   * Pull the reset rule back out of the stylesheet.
   *
   * Comments are stripped FIRST and deliberately: the rule is documented at
   * length in a comment directly above itself, so a text search over the raw
   * file would be satisfied by the prose even if the declaration were deleted.
   */
  function uaSearchResetRule(): { selectors: string[]; declarations: string[] } {
    const indexCssSource = readIndexCss();
    const stripped = indexCssSource.replace(/\/\*[\s\S]*?\*\//g, '');

    // Positive control on the stripping step itself. This sentence exists only
    // inside a comment in index.css; if it survives, the regex above silently
    // did nothing and every assertion below is being made against prose.
    expect(indexCssSource).toContain('belt-and-braces');
    expect(stripped).not.toContain('belt-and-braces');

    const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const rule = rules.find((m) => m[1].includes('::-webkit-search-cancel-button'));
    if (!rule) throw new Error('index.css declares no ::-webkit-search-cancel-button rule');
    return {
      selectors: rule[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
      declarations: rule[2]
        .split(';')
        .map((d) => d.replace(/\s+/g, '').toLowerCase())
        .filter(Boolean),
    };
  }

  it('SPELLED GUARD (not regression coverage): the stylesheet suppresses the UA control', () => {
    const { selectors, declarations } = uaSearchResetRule();

    expect(selectors).toContain(
      "[data-app='app-requests'] input[type='search']::-webkit-search-cancel-button",
    );
    expect(selectors).toContain(
      "[data-app='app-requests'] input[type='search']::-webkit-search-decoration",
    );
    // 🔴 This asserts the SOURCE, and the source is not what ships. `vite build`
    // minifies the `-webkit-` declaration away for this project's target, so
    // dist carries `appearance: none` alone — and that alone is what suppresses
    // the control in Chromium 144 (measured against the built bundle, not just
    // the dev server). The prefixed line survives here as cover for older
    // WebKit/Blink. Treat a green here as "the rule is written", never as "the
    // artifact behaves"; only the browser instrument can say the second thing.
    expect(declarations).toContain('-webkit-appearance:none');
    expect(declarations).toContain('appearance:none');
  });

  it('SEAM: the selector written in the stylesheet resolves to the rendered search input', async () => {
    // Structural, not visual — it cannot tell you what got painted. It CAN tell
    // you the rule is aimed at something, which a CSS-only guard cannot.
    const { selectors } = uaSearchResetRule();
    const elementPart = selectors[0].replace(/::-webkit-[a-z-]+$/, '');
    expect(elementPart).not.toBe(selectors[0]); // the rule really is a pseudo-element rule

    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'r1', title: 'A request', count: 3 })],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('A request');

    expect(document.querySelectorAll(elementPart)).toHaveLength(1);
    expect(document.querySelector(elementPart)).toBe(screen.getByTestId('search-input'));
  });
});

describe('search', () => {
  const board = () => ({
    items: [
      makeItem({ key: 'dm', title: 'Dark mode toggle', count: 9 }),
      makeItem({ key: 'pl', title: 'Prompt library with tags', count: 5, body: 'Save and share prompts' }),
      makeItem({ key: 'up', title: 'Batch upscaler', count: 2 }),
    ],
    nextCursor: undefined,
  });

  it('filters the list and preserves the active order', async () => {
    h.shared.list.mockResolvedValue(board());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Dark mode toggle');

    await user.type(screen.getByTestId('search-input'), 'prompt');

    await waitFor(() => expect(screen.getAllByTestId('request-row')).toHaveLength(1));
    expect(screen.getByText('Prompt library with tags')).toBeInTheDocument();
    expect(screen.queryByText('Dark mode toggle')).toBeNull();
  });

  it('matches the body as well as the title', async () => {
    h.shared.list.mockResolvedValue(board());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Dark mode toggle');

    await user.type(screen.getByTestId('search-input'), 'share');
    await waitFor(() => expect(screen.getAllByTestId('request-row')).toHaveLength(1));
    expect(screen.getByText('Prompt library with tags')).toBeInTheDocument();
  });

  it('announces the match count in a live region', async () => {
    h.shared.list.mockResolvedValue(board());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Dark mode toggle');

    await user.type(screen.getByTestId('search-input'), 'prompt');
    const summary = screen.getByTestId('search-summary');
    expect(summary).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(summary).toHaveTextContent('1 of 3 loaded requests'));
  });

  it('🔴 a no-match past the horizon says so and offers a way past it', async () => {
    // The worst failure this app can have is reading as "no such request
    // exists" when the row is simply beyond the scan.
    h.shared.list.mockImplementation((arg?: { cursor?: string }) => {
      const n = arg?.cursor ? Number(arg.cursor.replace('cur-', '')) : 0;
      return Promise.resolve({
        items: [makeItem({ key: `p${n}`, title: `Row page ${n}`, count: 1 })],
        nextCursor: `cur-${n + 1}`,
      });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Row page 0');
    await waitFor(() => expect(screen.queryByTestId('scanning')).toBeNull());

    await user.type(screen.getByTestId('search-input'), 'zzzzz');

    const empty = await screen.findByTestId('no-matches');
    expect(empty).toHaveTextContent('loaded so far');
    expect(empty).toHaveTextContent('There are more on the server.');
    expect(screen.getByTestId('search-load-more')).toBeInTheDocument();
  });

  it('does NOT claim there is more when the whole board was loaded', async () => {
    h.shared.list.mockResolvedValue(board());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Dark mode toggle');

    await user.type(screen.getByTestId('search-input'), 'zzzzz');
    const empty = await screen.findByTestId('no-matches');
    expect(empty).toHaveTextContent('requests on the board');
    expect(empty).not.toHaveTextContent('There are more on the server.');
    expect(screen.queryByTestId('search-load-more')).toBeNull();
  });

  it('offers a way back when nothing matches', async () => {
    h.shared.list.mockResolvedValue(board());
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Dark mode toggle');

    await user.type(screen.getByTestId('search-input'), 'zzzzz');
    expect(await screen.findByTestId('no-matches')).toBeInTheDocument();

    await user.click(screen.getByTestId('clear-search-btn'));
    await waitFor(() => expect(screen.getAllByTestId('request-row')).toHaveLength(3));
  });

  it('🔴 discloses its horizon — a filter that cannot see the whole board says so', async () => {
    h.shared.list.mockImplementation((arg?: { cursor?: string }) => {
      const n = arg?.cursor ? Number(arg.cursor.replace('cur-', '')) : 0;
      return Promise.resolve({
        items: [makeItem({ key: `p${n}`, title: `Row page ${n}`, count: 1 })],
        nextCursor: `cur-${n + 1}`,
      });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Row page 0');
    await waitFor(() => expect(screen.queryByTestId('scanning')).toBeNull());

    await user.type(screen.getByTestId('search-input'), 'page');
    await waitFor(() =>
      expect(screen.getByTestId('horizon-note')).toHaveTextContent(
        'Ranked and searched across the first 9 requests — the board is larger, so a match further down won\'t appear.',
      ),
    );
  });
});

describe('submit', () => {
  it('appends {title, body} and refreshes the list', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');
    h.shared.list.mockClear();

    await openComposer(user);
    await user.type(screen.getByTestId('title-input'), 'Add dark mode');
    await user.type(screen.getByTestId('body-input'), 'Please and thank you');
    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() =>
      expect(h.shared.append).toHaveBeenCalledWith({
        title: 'Add dark mode',
        body: 'Please and thank you',
      }),
    );
    await waitFor(() => expect(h.shared.list).toHaveBeenCalled());
    // The composer closes on success — the board is the thing to return to.
    await waitFor(() => expect(screen.queryByTestId('title-input')).toBeNull());
  });

  it("surfaces the server's specific trust-gate reason on a trust error (no crash)", async () => {
    h.shared.append.mockRejectedValueOnce(new Error('FORBIDDEN: account must be 7 days old'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await openComposer(user);
    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText('account must be 7 days old')).toBeInTheDocument();
    expect(screen.getByTestId('submit-btn')).toBeInTheDocument();
  });

  it('falls back to the canned gate copy when the host gives only a bare code', async () => {
    h.shared.append.mockRejectedValueOnce(new Error('FORBIDDEN'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await openComposer(user);
    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText(TRUST_GATE_MESSAGE)).toBeInTheDocument();
  });

  it('surfaces the server message verbatim on a content rejection', async () => {
    h.shared.append.mockRejectedValueOnce(new Error('Title exceeds 200 characters'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await openComposer(user);
    await user.type(screen.getByTestId('title-input'), 'Idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText('Title exceeds 200 characters')).toBeInTheDocument();
  });

  it('Enter in the Title field submits the form (implicit submission)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await openComposer(user);
    await user.type(screen.getByTestId('title-input'), 'Ship it with Enter{enter}');

    await waitFor(() =>
      expect(h.shared.append).toHaveBeenCalledWith({ title: 'Ship it with Enter' }),
    );
  });

  it('Enter inside the Details textarea does NOT submit (stays a newline)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No requests yet');

    await openComposer(user);
    await user.type(screen.getByTestId('title-input'), 'Has details');
    await user.type(screen.getByTestId('body-input'), 'line one{enter}line two');
    expect(h.shared.append).not.toHaveBeenCalled();
    expect(screen.getByTestId('body-input')).toHaveValue('line one\nline two');
  });

  it('nudges about similar already-posted requests without blocking the post', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'dm', title: 'Dark mode toggle', count: 4 }),
        makeItem({ key: 'vq', title: 'Video export queue', count: 1 }),
      ],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Dark mode toggle');

    await openComposer(user);
    expect(screen.queryByTestId('similar-nudge')).toBeNull();

    await user.type(screen.getByTestId('title-input'), 'Please add a dark mode');

    const nudge = await screen.findByTestId('similar-nudge');
    const found = within(nudge).getAllByTestId('similar-item');
    expect(found.map((i) => i.textContent)).toContain('Dark mode toggle');
    expect(found.map((i) => i.textContent)).not.toContain('Video export queue');

    expect(screen.getByTestId('submit-btn')).not.toBeDisabled();
    await user.click(screen.getByTestId('submit-btn'));
    await waitFor(() =>
      expect(h.shared.append).toHaveBeenCalledWith({ title: 'Please add a dark mode' }),
    );
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

    expect(h.shared.vote).toHaveBeenCalledWith('v1');
    expect(screen.getByTestId('vote-count')).toHaveTextContent('4');
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    d.resolve(5);
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('5'));
  });

  it('one vote per user: a double-click does not double count', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'd1', title: 'Double', count: 1 })],
      nextCursor: undefined,
    });
    const d = deferred<number>();
    h.shared.vote.mockReturnValue(d.promise);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Double');

    const btn = screen.getByTestId('vote-btn');
    await user.click(btn);
    await user.click(btn);

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

    expect(await screen.findByText('account too new to vote')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('vote-count')).toHaveTextContent('4'));
    expect(screen.getByTestId('vote-btn')).toHaveAttribute('aria-pressed', 'false');
  });

  it('a failed UNVOTE rolls back to the voted state, not to a guess', async () => {
    // The rollback deletes the session override, so the row falls back to the
    // SERVER's `viewerVoted` — which is why this restores "voted", not "not voted".
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'r1', title: 'Rollback', count: 6, viewerVoted: true })],
      nextCursor: undefined,
    });
    h.shared.unvote.mockRejectedValueOnce(new Error('shared_unavailable'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Rollback');

    const btn = screen.getByTestId('vote-btn');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await user.click(btn);

    await waitFor(() => expect(screen.getByTestId('vote-btn')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('vote-count')).toHaveTextContent('6');
  });
});

describe('edit own request', () => {
  it("edits the author's own row in place via update() — preserving key + votes", async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'mine', title: 'Typo in titel', authorUserId: 7777, count: 12 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Typo in titel');

    const row = screen.getByTestId('request-row');
    await openRowMenu(user, row);
    await user.click(screen.getByTestId('edit-btn'));

    const titleInput = screen.getByTestId('edit-title-input');
    await user.clear(titleInput);
    await user.type(titleInput, 'Typo in title (fixed)');
    await user.click(screen.getByTestId('edit-save-btn'));

    await waitFor(() =>
      expect(h.shared.update).toHaveBeenCalledWith('mine', { title: 'Typo in title (fixed)' }),
    );
    expect(h.shared.append).not.toHaveBeenCalled();
    expect(await screen.findByText('Typo in title (fixed)')).toBeInTheDocument();
    expect(screen.getByTestId('vote-count')).toHaveTextContent('12');
  });

  it("does not offer Edit on someone else's row", async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'theirs', title: 'Not mine', authorUserId: 4021, count: 3 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Not mine');

    await openRowMenu(user, screen.getByTestId('request-row'));
    expect(screen.queryByTestId('edit-btn')).toBeNull();
    expect(screen.queryByTestId('withdraw-btn')).toBeNull();
  });
});

describe('withdraw', () => {
  it("shows withdraw only on the viewer's own rows and removes after confirming", async () => {
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

    await openRowMenu(user, theirsRow);
    expect(within(theirsRow).queryByTestId('withdraw-btn')).toBeNull();

    await openRowMenu(user, mineRow);
    await user.click(within(mineRow).getByTestId('withdraw-btn'));

    expect(h.shared.withdraw).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('withdraw-confirm')).toBeInTheDocument();

    await user.click(within(dialog).getByTestId('withdraw-confirm-btn'));
    expect(h.shared.withdraw).toHaveBeenCalledWith('mine');
    await waitFor(() => expect(screen.queryByText('My idea')).toBeNull());
    expect(screen.getByText('Their idea')).toBeInTheDocument();
  });

  it('the confirm dialog names the vote count and Cancel aborts (no delete)', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'mine', title: 'My idea', authorUserId: 7777, count: 12 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('My idea');

    await openRowMenu(user, screen.getByTestId('request-row'));
    await user.click(screen.getByTestId('withdraw-btn'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/12 votes/)).toBeInTheDocument();

    await user.click(within(dialog).getByTestId('withdraw-cancel-btn'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.shared.withdraw).not.toHaveBeenCalled();
    expect(screen.getByText('My idea')).toBeInTheDocument();
  });

  it('the confirm dialog singularizes a single vote', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'mine', title: 'My idea', authorUserId: 7777, count: 1 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('My idea');
    await openRowMenu(user, screen.getByTestId('request-row'));
    await user.click(screen.getByTestId('withdraw-btn'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/1 vote\b/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/1 votes/)).toBeNull();
  });
});

describe('moderation', () => {
  it('any signed-in viewer can report someone else\'s row, and the copy does not promise a hide', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'bad', title: 'Spammy row', authorUserId: 4021, count: 1 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Spammy row');

    await openRowMenu(user, screen.getByTestId('request-row'));
    await user.click(screen.getByTestId('report-btn'));

    await waitFor(() => expect(h.shared.report).toHaveBeenCalledWith('bad'));
    // 🔴 Honesty: a report does NOT hide the row, and the confirmation says so.
    expect(await screen.findByText(/stays on the board until they review it/)).toBeInTheDocument();
    expect(screen.getByText('Spammy row')).toBeInTheDocument();
  });

  it('offers the owner a HIDE (never a delete) and it appends a ledger entry', async () => {
    h.ctx.viewer = { id: OWNER_USER_ID, username: 'owner' };
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'bad', title: 'Spammy row', authorUserId: 4021, count: 1 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Spammy row');

    await openRowMenu(user, screen.getByTestId('request-row'));
    const suppressItem = screen.getByTestId('suppress-btn');
    expect(suppressItem).toHaveTextContent('Hide from board');
    expect(suppressItem).not.toHaveTextContent(/delete/i);
    await user.click(suppressItem);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/not deleted/)).toBeInTheDocument();
    await user.click(within(dialog).getByTestId('suppress-confirm-btn'));

    await waitFor(() =>
      expect(h.shared.append).toHaveBeenCalledWith({
        title: 'Moderation record',
        data: { kind: 'app-requests/suppression', v: 1, target: 'bad' },
      }),
    );
  });

  it('a NON-owner sees no hide affordance', async () => {
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'bad', title: 'Spammy row', authorUserId: 4021, count: 1 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Spammy row');
    await openRowMenu(user, screen.getByTestId('request-row'));
    expect(screen.queryByTestId('suppress-btn')).toBeNull();
  });

  it('honours an owner ledger entry and never renders the ledger row itself', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'visible', title: 'Stays visible', count: 2 }),
        makeItem({ key: 'hidden', title: 'Should be hidden', count: 9 }),
        makeItem({
          key: 'ledger',
          title: 'Moderation record',
          authorUserId: OWNER_USER_ID,
          data: { kind: 'app-requests/suppression', v: 1, target: 'hidden' },
        }),
      ],
      nextCursor: undefined,
    });
    render(<App />);
    await screen.findByText('Stays visible');

    expect(screen.queryByText('Should be hidden')).toBeNull();
    expect(screen.queryByText('Moderation record')).toBeNull();
    expect(screen.getAllByTestId('request-row')).toHaveLength(1);
    expect(screen.getByTestId('request-count')).toHaveTextContent('1');
  });

  it('🔴 IGNORES a forged ledger entry from a non-owner', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'target', title: 'Cannot be forged away', count: 9 }),
        makeItem({
          key: 'forged',
          title: 'Moderation record',
          authorUserId: 4021, // NOT the owner
          data: { kind: 'app-requests/suppression', v: 1, target: 'target' },
        }),
      ],
      nextCursor: undefined,
    });
    render(<App />);
    // The targeted row survives — the author check is the whole security boundary.
    expect(await screen.findByText('Cannot be forged away')).toBeInTheDocument();
    // The forged record is still never rendered AS a request.
    expect(screen.queryByText('Moderation record')).toBeNull();
    expect(screen.getAllByTestId('request-row')).toHaveLength(1);
  });
});

describe('malformed shared row', () => {
  it('drops a malformed row instead of bricking the whole board', async () => {
    h.shared.list.mockResolvedValue({
      items: [
        makeItem({ key: 'good', title: 'Good row', count: 2 }),
        {
          key: 'bad',
          authorUserId: 1,
          value: {},
          count: 0,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as unknown as SharedListItem,
      ],
      nextCursor: undefined,
    });
    render(<App />);

    expect(await screen.findByText('Good row')).toBeInTheDocument();
    expect(screen.queryByTestId('root-boundary')).toBeNull();
    expect(screen.getAllByTestId('request-row')).toHaveLength(1);
    expect(screen.getByTestId('request-count')).toHaveTextContent('1');
  });
});

describe('anonymous viewer', () => {
  it('is read-only: no composer, no row menu, and voting prompts sign-in', async () => {
    h.ctx.viewer = null;
    h.shared.list.mockResolvedValue({
      items: [makeItem({ key: 'a1', title: 'Anon-visible', count: 3 })],
      nextCursor: undefined,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Anon-visible');

    // 🔴 Not one mutation affordance is offered — every one would hard-reject.
    expect(screen.queryByTestId('open-composer-btn')).toBeNull();
    expect(screen.queryByTestId('title-input')).toBeNull();
    expect(screen.queryByTestId('row-menu-btn')).toBeNull();
    expect(screen.getByTestId('signin-btn')).toBeInTheDocument();

    await user.click(screen.getByTestId('vote-btn'));
    expect(h.requestSignIn).toHaveBeenCalled();
    expect(h.shared.vote).not.toHaveBeenCalled();
  });
});
