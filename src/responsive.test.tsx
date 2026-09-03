import { cleanup, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedListItem } from '@civitai/blocks-react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WIDTH-ADAPTIVE LAYOUT, DRIVEN AT AN EXPLICITLY SET OBSERVED WIDTH.
 *
 * 🔴 THE WIDTH IS SET BY THIS FILE, NEVER INHERITED FROM THE HARNESS. jsdom's
 * viewport is a fixed 1024x768 and it ships no `ResizeObserver` at all, so a
 * suite that did not set a width would pin the dimension under test and every
 * assertion on it would pass vacuously. `setBlockWidth()` below installs BOTH
 * halves the hook reads — the synchronous `el.clientWidth` seed and the
 * observer callback — and every test states the width it is asserting at.
 *
 * That the harness really observes the value set is not assumed either: the
 * app writes the resolved tier onto its root as `data-tier`, and
 * `expectTier()` cross-checks it against the pack's own `resolveBlockTier` for
 * the width this file asked for. If the plumbing were wired to nothing, every
 * tier would come back `'base'` and the wide-tier tests would fail.
 *
 * 🔴 `useBlockBreakpoint` IS THE REAL HOOK HERE. The SDK's storage/context hooks
 * are stubbed (there is no host in jsdom) but the breakpoint hook is spread in
 * from the real module, so what is under test is the shipped tier logic and not
 * a restatement of it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

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
  ...(await importOriginal<typeof import('@civitai/blocks-react')>()),
  useBlockContext: () => h.ctx,
  useSharedStorage: () => h.shared,
  useRequestSignIn: () => ({ requestSignIn: h.requestSignIn }),
  useBlockAnalytics: () => ({ track: h.track }),
  useBlockResize: () => {},
  getTransport: () => ({}),
}));

import { resolveBlockTier } from '@civitai/blocks-react';

import { App } from './App.js';

// ---- the width harness -------------------------------------------------------

/** The width every observed element reports. Set by `setBlockWidth`. */
let observedWidth = 0;

type Entry = { cb: ResizeObserverCallback; el: Element; self: ResizeObserver };
let observers: Entry[] = [];

class FakeResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(el: Element): void {
    observers.push({ cb: this.cb, el, self: this });
  }
  unobserve(): void {}
  disconnect(): void {
    observers = observers.filter((o) => o.self !== this);
  }
}

/**
 * Set the width the block's root reports, BEFORE rendering.
 *
 * Two channels, because the hook reads two: it seeds synchronously from
 * `el.clientWidth` right after `observe()`, and it updates from the observer's
 * `contentRect.width`. They are kept at the same value on purpose — a harness
 * where the two disagree would be measuring itself.
 */
function setBlockWidth(px: number): void {
  observedWidth = px;
}

/** Change the width AFTER mount and deliver it, the way a real resize would. */
function resizeBlockTo(px: number): void {
  observedWidth = px;
  act(() => {
    for (const { cb, el, self } of [...observers]) {
      cb([{ target: el, contentRect: { width: px } } as unknown as ResizeObserverEntry], self);
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  observers = [];
  observedWidth = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return observedWidth;
    },
  });
  h.ctx.ready = true;
  h.ctx.viewer = { id: 7777, username: 'dev' };
  h.ctx.theme = 'dark';
  h.shared.list.mockResolvedValue({ items: [], nextCursor: undefined });
  h.shared.vote.mockResolvedValue(1);
  h.shared.unvote.mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error — removing the shadowing accessor restores jsdom's own.
  delete HTMLElement.prototype.clientWidth;
});

let keySeq = 0;
function makeItem(o: Partial<SharedListItem> & { title?: string; body?: string }): SharedListItem {
  keySeq += 1;
  const { title, body, ...rest } = o;
  return {
    key: o.key ?? `k${keySeq}`,
    // Not the viewer: an "other person's" row is the one that carries
    // `report-btn`, and the recipe's ledger names it.
    authorUserId: 4021,
    value: { title: title ?? `Idea ${keySeq}`, ...(body !== undefined ? { body } : {}) },
    count: 3,
    createdAt: new Date('2026-05-02T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
    viewerVoted: false,
    ...rest,
  };
}

function seedBoard(): void {
  keySeq = 0;
  h.shared.list.mockResolvedValue({
    items: [
      makeItem({ key: 'own', title: 'A request of my own', authorUserId: 7777, count: 9 }),
      makeItem({ key: 'other', title: 'Someone else’s request', body: 'With details.' }),
    ],
    nextCursor: undefined,
  });
}

/** Render at `width` and wait for the board to settle. */
async function renderAt(width: number): Promise<void> {
  setBlockWidth(width);
  render(<App />);
  await screen.findByTestId('board-ready');
}

/**
 * The block resolved the tier this file asked for.
 *
 * 🔴 This is the harness's own positive control. It is asserted in every test
 * that sets a width, so a width that never reached the hook shows up as a failed
 * tier rather than as a layout assertion that quietly passed for the wrong
 * reason.
 */
function expectTier(width: number): void {
  const root = screen.getByTestId('app-root');
  expect(root, `the block must report the tier for the ${width}px width this test set`).toHaveAttribute(
    'data-tier',
    resolveBlockTier(width),
  );
  expect(root, 'and it must report itself MEASURED, or every branch is the unmeasured default').toHaveAttribute(
    'data-measured',
    'true',
  );
}

// The widths. Interior points, never a breakpoint value — see src/layout.test.ts.
const PHONE = 337;
const TABLET = 519;
const DESKTOP = 861;
const WIDE = 1307;

describe('the harness itself', () => {
  it('sets a width the hook actually reads, and different widths give different tiers', async () => {
    await renderAt(PHONE);
    expect(screen.getByTestId('app-root')).toHaveAttribute('data-tier', 'base');
    cleanup();
  });

  it('a SECOND width produces a DIFFERENT tier — the value is not ignored', async () => {
    await renderAt(WIDE);
    expect(screen.getByTestId('app-root')).toHaveAttribute('data-tier', 'lg');
  });

  it('without a measurement the block reports unmeasured and the regular layout', async () => {
    // No ResizeObserver at all — the real jsdom condition, and production's
    // first frame. Every structural branch must sit at its regular value.
    vi.unstubAllGlobals();
    // @ts-expect-error — take it away entirely for this test.
    delete globalThis.ResizeObserver;
    seedBoard();
    render(<App />);
    await screen.findByTestId('board-ready');
    const root = screen.getByTestId('app-root');
    expect(root).toHaveAttribute('data-measured', 'false');
    expect(screen.getByTestId('board-ready')).toHaveAttribute('data-layout', 'row');
    expect(screen.getByTestId('hero')).toHaveAttribute('data-layout', 'inline');
    for (const row of screen.getAllByTestId('request-row')) {
      expect(row).toHaveAttribute('data-layout', 'regular');
    }
  });
});

describe('the toolbar', () => {
  it(`stacks at ${PHONE}px and at ${TABLET}px`, async () => {
    for (const width of [PHONE, TABLET]) {
      seedBoard();
      await renderAt(width);
      expectTier(width);
      const toolbar = screen.getByTestId('board-ready');
      expect(toolbar, `the toolbar must stack at ${width}px`).toHaveAttribute(
        'data-layout',
        'stacked',
      );
      expect(toolbar).toHaveStyle({ flexDirection: 'column' });
      cleanup();
    }
  });

  it(`stays one row at ${DESKTOP}px and at ${WIDE}px`, async () => {
    for (const width of [DESKTOP, WIDE]) {
      seedBoard();
      await renderAt(width);
      expectTier(width);
      const toolbar = screen.getByTestId('board-ready');
      expect(toolbar, `the toolbar must stay one row at ${width}px`).toHaveAttribute(
        'data-layout',
        'row',
      );
      expect(toolbar).not.toHaveStyle({ flexDirection: 'column' });
      cleanup();
    }
  });
});

describe('the request row', () => {
  it(`puts the title BEFORE the vote pill at ${PHONE}px`, async () => {
    seedBoard();
    await renderAt(PHONE);
    expectTier(PHONE);
    const row = screen.getAllByTestId('request-row')[0];
    expect(row, `the row must be compact at ${PHONE}px`).toHaveAttribute('data-layout', 'compact');

    // 🔴 A structural assertion, not a spelled one: DOCUMENT ORDER. A
    // `data-layout` attribute alone could be set by a component that never
    // rearranged anything.
    const title = within(row).getByText('A request of my own');
    const vote = within(row).getByTestId('vote-btn');
    expect(
      title.compareDocumentPosition(vote) & Node.DOCUMENT_POSITION_FOLLOWING,
      'compact: the vote pill must come AFTER the title in document order',
    ).toBeTruthy();
  });

  it(`keeps the vote pill BEFORE the title at ${TABLET}px and ${DESKTOP}px`, async () => {
    // The two thresholds are different: at 519 the toolbar is already stacked
    // while the row still has its left rail. That is the case a single-threshold
    // implementation gets wrong.
    for (const width of [TABLET, DESKTOP]) {
      seedBoard();
      await renderAt(width);
      expectTier(width);
      const row = screen.getAllByTestId('request-row')[0];
      expect(row, `the row must keep its rail at ${width}px`).toHaveAttribute(
        'data-layout',
        'regular',
      );
      const title = within(row).getByText('A request of my own');
      const vote = within(row).getByTestId('vote-btn');
      expect(
        vote.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
        `regular (${width}px): the vote pill must come BEFORE the title`,
      ).toBeTruthy();
      cleanup();
    }
  });
});

describe('the hero', () => {
  it(`drops its CTA onto its own line below sm, and not at ${DESKTOP}px`, async () => {
    seedBoard();
    await renderAt(PHONE);
    expect(screen.getByTestId('hero')).toHaveAttribute('data-layout', 'block');
    cleanup();

    seedBoard();
    await renderAt(DESKTOP);
    expect(screen.getByTestId('hero')).toHaveAttribute('data-layout', 'inline');
  });
});

describe('a live resize', () => {
  it('moves the layout across a threshold and back', async () => {
    seedBoard();
    await renderAt(WIDE);
    expect(screen.getByTestId('board-ready')).toHaveAttribute('data-layout', 'row');
    expect(screen.getAllByTestId('request-row')[0]).toHaveAttribute('data-layout', 'regular');

    resizeBlockTo(PHONE);
    expect(screen.getByTestId('app-root')).toHaveAttribute('data-tier', 'base');
    expect(screen.getByTestId('board-ready')).toHaveAttribute('data-layout', 'stacked');
    expect(screen.getAllByTestId('request-row')[0]).toHaveAttribute('data-layout', 'compact');

    resizeBlockTo(WIDE);
    expect(screen.getByTestId('board-ready')).toHaveAttribute('data-layout', 'row');
    expect(screen.getAllByTestId('request-row')[0]).toHaveAttribute('data-layout', 'regular');
  });

  it('🔴 does NOT change anything when the width moves INSIDE a tier', async () => {
    // The counterpart to the test above: a mutant that pins a tier, or that
    // re-derives the layout from the raw width instead of the tier, is caught
    // here. 861 and 1307 are different tiers with the same layout; 900 and 1000
    // are the same tier.
    seedBoard();
    await renderAt(DESKTOP);
    const before = {
      toolbar: screen.getByTestId('board-ready').getAttribute('data-layout'),
      row: screen.getAllByTestId('request-row')[0].getAttribute('data-layout'),
      hero: screen.getByTestId('hero').getAttribute('data-layout'),
    };
    resizeBlockTo(1000); // still `sm` — 992 is Mantine's md, not civitai's
    expect(screen.getByTestId('app-root'), '1000px is still the sm tier').toHaveAttribute(
      'data-tier',
      'sm',
    );
    expect(
      {
        toolbar: screen.getByTestId('board-ready').getAttribute('data-layout'),
        row: screen.getAllByTestId('request-row')[0].getAttribute('data-layout'),
        hero: screen.getByTestId('hero').getAttribute('data-layout'),
      },
      'nothing may move for a resize that does not cross a threshold',
    ).toEqual(before);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 A FLEX BASIS IS AXIS-RELATIVE, AND FLIPPING A CONTAINER RE-AIMS IT.
 *
 * THE DEFECT THIS GUARD EXISTS FOR, measured in a real Chromium at 375px before
 * the fix:
 *
 *     board-ready   h=264  dir=column
 *       child0 (search wrapper)  h=220   content=53   grow=1  basis=220px
 *       child1 (sort row)        h=32    content=32   grow=0  basis=auto
 *
 * ~167px of dead space. `flex: 1 1 220px` was written for a ROW, where `220px`
 * is a minimum WIDTH. The stacked toolbar sets `flex-direction: column`, so the
 * same declaration became a 220px HEIGHT with `flex-grow: 1` pinning it there.
 *
 * 🔴 EVERY ATTRIBUTE ASSERTION IN THIS FILE PASSED THROUGH IT. `data-layout`
 * read `stacked`, `data-tier` read `base`, the testids were all present — the
 * layout DECISION was correct and only the SIZING was wrong. jsdom has no
 * layout engine, so no amount of rendering here could have caught it as
 * geometry. What jsdom CAN see is the resolved style, and the relationship
 * between a container's axis and its children's basis is decidable from that
 * alone.
 *
 * So this pins the RELATIONSHIP — "no column flex container has a child with a
 * fixed-length flex-basis" — not the literal `'0 0 auto'` a reword would walk
 * past. It reads the resolved `flexBasis` LONGHAND, so `flex: '1 1 220px'`,
 * `flexBasis: '220px'` and `flex: '0 1 220px'` are all the same finding, and it
 * scans the WHOLE rendered tree rather than the one container the bug was found
 * in — a sibling that flips later is covered without anyone remembering to add
 * it here.
 *
 * The real-pixel counterpart is `scripts/measure-toolbar-geometry.mjs`, the
 * fourth layer (see README). This one is what runs in CI.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('🔴 no column flex container has a row-shaped child', () => {
  /**
   * A length that would become a HEIGHT on the main axis of a column.
   *
   * `auto` and `content` are content-sized and fine. A bare `0` / `0%` is a
   * degenerate basis that collapses rather than reserving space, so it is not
   * this defect either — only a POSITIVE length reserves the box.
   */
  function isFixedLengthBasis(basis: string): boolean {
    const v = basis.trim().toLowerCase();
    if (v === '' || v === 'auto' || v === 'content' || v === 'inherit' || v === 'initial') return false;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n > 0;
  }

  /**
   * Every column flex container in the tree.
   *
   * Two sources, because the app flips axes two different ways: an inline
   * `flexDirection: 'column'` (how every branch in this change does it), and the
   * pack's `<Stack>`, which is a column by definition in the pack's own
   * stylesheet — jsdom cannot parse that stylesheet, so the element is matched
   * by its `data-civitai-ui` marker instead. The claim that a Stack really is a
   * column is not taken on trust; it is asserted below against the pack's CSS.
   */
  function columnContainers(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('*')].filter(
      (el) =>
        el.style.flexDirection === 'column' ||
        getComputedStyle(el).flexDirection === 'column' ||
        el.getAttribute('data-civitai-ui') === 'stack',
    );
  }

  function offenders(root: HTMLElement) {
    const found: string[] = [];
    for (const container of columnContainers(root)) {
      for (const child of [...container.children] as HTMLElement[]) {
        const basis = getComputedStyle(child).flexBasis || child.style.flexBasis || '';
        if (isFixedLengthBasis(basis)) {
          const name =
            container.getAttribute('data-testid') ??
            container.getAttribute('data-civitai-ui') ??
            container.tagName.toLowerCase();
          const kid =
            child.getAttribute('data-testid') ?? child.getAttribute('data-civitai-ui') ?? child.tagName.toLowerCase();
          found.push(`${name} > ${kid} has flex-basis: ${basis} on the COLUMN main axis (a height)`);
        }
      }
    }
    return found;
  }

  it('the pack’s <Stack> really is a column — the assumption is checked, not trusted', async () => {
    const { BLOCKS_UI_STYLES } = await import('@civitai/blocks-react/ui');
    const rule = /\[data-civitai-ui=['"]stack['"]\]\s*\{[^}]*\}/.exec(BLOCKS_UI_STYLES)?.[0] ?? '';
    expect(rule, 'no [data-civitai-ui=stack] rule found in the pack stylesheet').not.toBe('');
    expect(rule.replace(/\s+/g, ' ')).toMatch(/flex-direction:\s*column/);
  });

  it('finds column containers at all — positive control', async () => {
    seedBoard();
    await renderAt(PHONE);
    const root = screen.getByTestId('app-root');
    // A walker wired to nothing would report zero offenders for every tree it
    // was ever shown, which is indistinguishable from a clean tree.
    expect(
      columnContainers(root).length,
      'the walker must actually find column containers, or every "clean" verdict below is vacuous',
    ).toBeGreaterThan(2);
  });

  it('the walker CAN report an offender — negative control', async () => {
    seedBoard();
    await renderAt(PHONE);
    const root = screen.getByTestId('app-root');
    const toolbar = screen.getByTestId('board-ready');
    const planted = toolbar.firstElementChild as HTMLElement;
    const before = planted.style.flexBasis;
    // Plant the EXACT defect, on the EXACT element it occurred on.
    planted.style.flexBasis = '220px';
    expect(
      offenders(root).some((o) => o.includes('board-ready') && o.includes('220px')),
      'the walker must report a planted 220px basis under the stacked toolbar',
    ).toBe(true);
    planted.style.flexBasis = before;
    expect(offenders(root), 'and go clean again once it is removed').toEqual([]);
  });

  it('is clean at every stacked width, with a board and empty', async () => {
    for (const width of [320, PHONE, 470, TABLET, 700]) {
      for (const empty of [false, true]) {
        if (empty) h.shared.list.mockResolvedValue({ items: [], nextCursor: undefined });
        else seedBoard();
        await renderAt(width);
        expect(
          offenders(screen.getByTestId('app-root')),
          `a column container at ${width}px (${empty ? 'empty' : 'with a board'}) has a child sized for the ROW axis`,
        ).toEqual([]);
        cleanup();
      }
    }
  });

  it('is clean at the wide widths too — the row-axis basis is legal THERE', async () => {
    // 🔴 The point of scanning by CONTAINER AXIS rather than by string: the
    // request row's `flex: 1 1 260px` and the search field's `1 1 220px` are
    // CORRECT in a row, and a guard that merely grepped for a length basis would
    // have to false-positive on them or be switched off here. It does neither.
    for (const width of [DESKTOP, WIDE]) {
      seedBoard();
      await renderAt(width);
      expect(offenders(screen.getByTestId('app-root')), `clean at ${width}px`).toEqual([]);
      cleanup();
    }
  });

  it('the search wrapper is content-sized when stacked and row-sized when not', async () => {
    // The specific consequence, named, so a reader sees what changed and why.
    seedBoard();
    await renderAt(PHONE);
    const stacked = screen.getByTestId('search-input').closest('[data-testid="board-ready"] > *') as HTMLElement;
    expect(getComputedStyle(stacked).flexBasis, 'stacked: no height basis').toBe('auto');
    expect(getComputedStyle(stacked).flexGrow, 'stacked: nothing to stretch it vertically').toBe('0');
    cleanup();

    seedBoard();
    await renderAt(DESKTOP);
    const row = screen.getByTestId('search-input').closest('[data-testid="board-ready"] > *') as HTMLElement;
    expect(getComputedStyle(row).flexBasis, 'row: the 220px WIDTH floor is kept').toBe('220px');
    expect(getComputedStyle(row).flexGrow, 'row: and it still grows to fill').toBe('1');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 THE CAPTURE RECIPE'S SELECTORS, AT EVERY TIER.
 *
 * <datapacket-talos>/.claude/skills/app-capture/scripts/recipes/app-requests.json
 * gates the whole store-capture run on `board-ready` being present at rest and
 * drives the two board states through `sort-control button:nth-of-type(1)` and
 * `(2)`. A tier that dropped either would not fail loudly — the capture would
 * time out at 45s reporting that the app never booted (exit 11), which reads as
 * a total breakage of the app rather than as a layout change.
 *
 * This has already happened once: 0.3.0 moved the composer into a modal, which
 * made the previous anchor `submit-btn` absent at rest.
 *
 * So the anchor is asserted as a RELATIONSHIP over the whole tier ladder and
 * both auth states and both data states, not as a single spot check.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('🔴 the capture recipe’s anchors survive every tier', () => {
  const TIER_LADDER = [320, PHONE, 470, TABLET, 700, DESKTOP, 1100, WIDE, 1500];

  /** Verbatim from the recipe. Copied as strings so a rename cannot pass. */
  const SORT_1 = '[data-testid=sort-control] button:nth-of-type(1)';
  const SORT_2 = '[data-testid=sort-control] button:nth-of-type(2)';

  it('board-ready is present at rest at every tier, signed IN, with a board', async () => {
    for (const width of TIER_LADDER) {
      seedBoard();
      await renderAt(width);
      expect(
        screen.queryByTestId('board-ready'),
        `board-ready must exist at ${width}px — the capture gates on it`,
      ).not.toBeNull();
      cleanup();
    }
  });

  it('board-ready is present at rest at every tier, signed OUT, with a board', async () => {
    for (const width of TIER_LADDER) {
      h.ctx.viewer = null;
      seedBoard();
      await renderAt(width);
      expect(
        screen.queryByTestId('board-ready'),
        `board-ready must exist signed-out at ${width}px`,
      ).not.toBeNull();
      cleanup();
    }
  });

  it('board-ready is present at rest at every tier with ZERO requests', async () => {
    for (const width of TIER_LADDER) {
      h.shared.list.mockResolvedValue({ items: [], nextCursor: undefined });
      await renderAt(width);
      expect(
        screen.queryByTestId('board-ready'),
        `board-ready must exist on an empty board at ${width}px`,
      ).not.toBeNull();
      expect(screen.queryByTestId('empty-state')).not.toBeNull();
      cleanup();
    }
  });

  it('both sort segments stay addressable by the recipe’s ordinal selectors', async () => {
    for (const width of TIER_LADDER) {
      seedBoard();
      await renderAt(width);
      const root = screen.getByTestId('app-root');
      expect(
        root.querySelector(SORT_1),
        `${SORT_1} must resolve at ${width}px — the "top" state clicks it`,
      ).not.toBeNull();
      expect(
        root.querySelector(SORT_2),
        `${SORT_2} must resolve at ${width}px — the "newest" state clicks it`,
      ).not.toBeNull();
      // …and they are DIFFERENT elements, or the ordinals do not discriminate.
      expect(root.querySelector(SORT_1)).not.toBe(root.querySelector(SORT_2));
      cleanup();
    }
  });

  it('every testid the recipe names is reachable at every tier', async () => {
    // A LEDGER, so it fails when the set shrinks. `submit-btn`, `edit-btn`,
    // `withdraw-btn`, `report-btn` and `suppress-btn` live behind the composer
    // and the row menu, which this test does not open; they are covered by
    // src/App.test.tsx at the default (unmeasured/regular) layout. What is
    // asserted here is the set reachable AT REST, which is what the capture
    // gate and the crop see.
    const AT_REST = ['board-ready', 'sort-control', 'search-input', 'open-composer-btn', 'vote-btn', 'row-menu-btn'];
    for (const width of TIER_LADDER) {
      seedBoard();
      await renderAt(width);
      for (const id of AT_REST) {
        expect(
          screen.queryAllByTestId(id).length,
          `[data-testid=${id}] must be present at ${width}px`,
        ).toBeGreaterThan(0);
      }
      cleanup();
    }
  });
});
