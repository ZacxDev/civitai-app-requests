import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOT_SKELETON_ATTRIBUTE,
  checkBootSkeletonPaintsWithoutNetwork,
  customPropertiesIn,
  splitCssMediaBlocks,
  topLevelRulesIn,
  validateBootSkeletonDocument,
} from './bootSkeleton.js';
import { BOOT_THEME_ATTRIBUTE } from './bootTheme.js';
import { palette } from './brand.js';
import { HERO_BAND_INK } from './hero.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HAZARD THESE GUARDS EXIST FOR
 *
 * `bootSkeleton: true` makes the run host stand down its own loading veil, its
 * iframe fade-in and its reveal settle. Over an EMPTY `#root` that is a blank
 * iframe for the whole load — strictly worse than never setting the key. The
 * manifest half and the markup half are ONE change, and nothing else in this
 * repo notices when they separate: the app still builds, still typechecks,
 * still passes every other test.
 *
 * So the assertions below are about the RELATIONSHIP (`declared ⇒ painted`),
 * not about either file alone. A test that only checked "index.html contains a
 * skeleton" would stay green through a manifest-only revert; one that only
 * checked the manifest key would stay green through a markup-only revert. Both
 * of those are the shippable defect.
 *
 * WHY THIS WHOLE FILE IS IN THE `dom` PROJECT, not the fast `node` one: the
 * gate operates on a parsed `Document`, and building one in the node project
 * means importing `jsdom` directly — which ships NO TypeScript types, so
 * `npm run build` (`tsc --noEmit && vite build`) fails with TS7016. The choice
 * was a new `@types/jsdom` devDependency or running here, where `DOMParser` is
 * already a global. The pure text-processing halves of the instrument
 * (`splitCssMediaBlocks`, `customPropertiesIn`) keep their own controls in
 * `bootSkeleton.test.ts`, in the node project.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Same SDK-hook mock shape as App.test.tsx — the `/ui` pack is left real.
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

const DARK = palette('dark');
const LIGHT = palette('light');

/**
 * Read off disk via `process.cwd()`, not `import.meta.url`: under the `dom`
 * project `import.meta.url` is an `http:` URL that `fs` refuses. (Same trap
 * documented at the top of App.test.tsx.)
 */
function read(relative: string): string {
  const text = readFileSync(resolve(process.cwd(), relative), 'utf8');
  if (text.trim().length === 0) throw new Error(`${relative} read back empty`);
  return text;
}

const indexHtml = read('index.html');
const manifest = JSON.parse(read('block.manifest.json')) as Record<string, unknown>;

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** The text of every `<style>` in the document head, concatenated. */
function bootStyleText(doc: Document): string {
  return Array.from(doc.querySelectorAll('head style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
}

/** Lower-cased hex, so `#14110C` and `#14110c` compare equal. */
function hex(value: string): string {
  return value.trim().toLowerCase();
}

describe('the manifest half', () => {
  it('declares bootSkeleton: true', () => {
    // A literal `true`, not merely truthy: the host reads the key as a boolean
    // and the string "false" is truthy.
    expect(manifest.bootSkeleton).toBe(true);
  });
});

describe('the markup half', () => {
  const doc = parse(indexHtml);

  it('paints a [data-boot-skeleton] element INSIDE #root', () => {
    const root = doc.querySelector('#root');
    expect(root).not.toBeNull();

    const marker = doc.querySelector(`[${BOOT_SKELETON_ATTRIBUTE}]`);
    expect(marker).not.toBeNull();
    // Strict descendant. A sibling of #root is never replaced by React's render
    // and would stay on screen on top of the app.
    expect(root?.contains(marker as Node)).toBe(true);
    expect(marker).not.toBe(root);
  });

  it('carries aria-hidden — the host already publishes aria-busy on the iframe', () => {
    expect(doc.querySelector(`[${BOOT_SKELETON_ATTRIBUTE}]`)?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('styles the skeleton from an INLINE <style>, not an external sheet', () => {
    // The contract's advisory check. An external stylesheet is a second
    // round-trip that can land after the window this whole feature is about.
    expect(bootStyleText(doc)).toContain(BOOT_SKELETON_ATTRIBUTE);
    expect(checkBootSkeletonPaintsWithoutNetwork(doc)).toEqual([]);
  });

  it('the advisory check can actually WARN — negative control', () => {
    // Otherwise the empty array above is indistinguishable from a check wired
    // to nothing.
    expect(
      checkBootSkeletonPaintsWithoutNetwork(
        parse('<!doctype html><html><head><link rel="stylesheet" href="/a.css"></head>' +
          '<body><div id="root"><div data-boot-skeleton><i></i></div></div></body></html>'),
      ),
    ).toHaveLength(1);
  });
});

describe('the two halves cannot separate', () => {
  // 🔴 This is the whole point of the file.
  it('this repo: bootSkeleton is declared AND the gate passes on index.html', () => {
    expect(manifest.bootSkeleton).toBe(true);
    expect(validateBootSkeletonDocument(parse(indexHtml))).toEqual([]);
  });

  it('FAILS when bootSkeleton is declared over an empty #root', () => {
    const findings = validateBootSkeletonDocument(
      parse('<!doctype html><html><body><div id="root"></div></body></html>'),
    );
    expect(findings.map((f) => f.rule)).toEqual(['container-empty']);
    expect(findings[0]?.message).toContain('#root is empty');
    expect(findings[0]?.message).toContain('blank iframe');
  });

  it('FAILS when #root holds only whitespace and non-painting tags', () => {
    const findings = validateBootSkeletonDocument(
      parse(
        '<!doctype html><html><body><div id="root">\n  ' +
          '<script>boot()</script><template><b>x</b></template>\n' +
          '</div></body></html>',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['container-empty']);
  });

  it('FAILS when [data-boot-skeleton] sits OUTSIDE the mount container', () => {
    const findings = validateBootSkeletonDocument(
      parse(
        '<!doctype html><html><body>' +
          '<div data-boot-skeleton aria-hidden="true"><div></div></div>' +
          '<div id="root">boot</div>' +
          '</body></html>',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['marker-outside-container']);
    expect(findings[0]?.message).toContain('outside the mount container');
  });

  it('PASSES on a container holding real content with no marker at all', () => {
    // Contract §5: a static app whose container already holds content satisfies
    // the gate without any skeleton. The gate keys on EMPTINESS; the marker is
    // the affordance, not the requirement.
    expect(
      validateBootSkeletonDocument(
        parse('<!doctype html><html><body><main id="app"><h1>Hi</h1></main></body></html>'),
      ),
    ).toEqual([]);
  });

  it('PASSES when no mount container is identifiable — the gate does not guess', () => {
    expect(
      validateBootSkeletonDocument(parse('<!doctype html><html><body><div></div></body></html>')),
    ).toEqual([]);
  });

  it('reports EVERY empty container, not just the first', () => {
    const findings = validateBootSkeletonDocument(
      parse(
        '<!doctype html><html><body><div id="root"></div><div data-app-root></div></body></html>',
      ),
    );
    expect(findings.map((f) => f.rule)).toEqual(['container-empty', 'container-empty']);
    expect(findings[0]?.message).toContain('#root');
    expect(findings[1]?.message).toContain('[data-app-root]');
  });
});

describe('dark is the default, structurally', () => {
  const doc = parse(indexHtml);
  const css = bootStyleText(doc);
  const regions = splitCssMediaBlocks(css);

  /**
   * The base region now has TWO kinds of rule and they mean different things:
   *
   *   - UNSCOPED rules — what a viewer gets with no information at all. These
   *     must be dark-only; that is the rule the whole file rests on.
   *   - rules scoped to `[data-civitai-boot-theme='…']` — the HOST's answer,
   *     which legitimately carries BOTH palettes because it has to be able to
   *     outrank the OS guess in either direction.
   *
   * Lumping them together would either weaken the dark-default claim to nothing
   * or fail on a correct file, so they are separated and each one is asserted
   * for what it actually promises.
   */
  const baseRules = topLevelRulesIn(regions.base);
  const unscoped = baseRules.filter((r) => !r.selector.includes(BOOT_THEME_ATTRIBUTE));
  const scopedDark = baseRules.filter((r) =>
    r.selector.includes(`${BOOT_THEME_ATTRIBUTE}='dark'`),
  );
  const scopedLight = baseRules.filter((r) =>
    r.selector.includes(`${BOOT_THEME_ATTRIBUTE}='light'`),
  );
  const unscopedText = unscoped.map((r) => r.body).join('\n');

  // 🔴 jsdom does not evaluate media queries, so `getComputedStyle()` here would
  // report the same values whichever way round the rules are written — a
  // vacuous green. The claim that has teeth is about WHERE each value lives in
  // the stylesheet text, so that is what is asserted.

  it('sets <meta name="color-scheme"> with dark FIRST', () => {
    const content = doc
      .querySelector('meta[name="color-scheme"]')
      ?.getAttribute('content')
      ?.trim()
      .split(/\s+/);
    expect(content?.[0]).toBe('dark');
    expect(content).toContain('light');
  });

  it('has NO @media (prefers-color-scheme: dark) block', () => {
    // Such a block would supply the dark values only to a viewer who has ASKED
    // for dark, inverting the default for `no-preference` and for any UA
    // without the query — the exact bug this rule exists to prevent.
    //
    // 🔴 POSITIVE CONTROL first. An assertion that a set is EMPTY is
    // indistinguishable from an assertion wired to nothing: with no inline
    // <style> at all — which is exactly the pre-change state of this file —
    // `regions.media` is `[]` and this passes for the wrong reason. So prove
    // the splitter is looking at a real stylesheet that DOES contain a
    // prefers-color-scheme query before reading the filter's zero.
    expect(css.trim().length).toBeGreaterThan(0);
    expect(regions.media.filter((m) => /prefers-color-scheme/.test(m.query))).not.toHaveLength(0);

    const darkBlocks = regions.media.filter((m) => /prefers-color-scheme\s*:\s*dark/.test(m.query));
    expect(darkBlocks).toEqual([]);
  });

  it('found both kinds of base rule — positive control for the partition', () => {
    // Every assertion below reads one side of `unscoped` / `scoped*`. A splitter
    // that returned nothing would make ALL of them vacuous, and the dark-default
    // one would pass on a file that declares no palette at all.
    expect(unscoped.length).toBeGreaterThan(0);
    expect(scopedDark).toHaveLength(1);
    expect(scopedLight).toHaveLength(1);
    // …and the partition is exhaustive: no rule was silently dropped.
    expect(unscoped.length + scopedDark.length + scopedLight.length).toBe(baseRules.length);
  });

  it('carries the DARK palette in the UNCONDITIONED base rules', () => {
    // "Unconditioned" = no media query AND no boot-theme attribute: what a
    // viewer gets when nothing is known about them. It is dark, and only dark.
    expect(customPropertiesIn(unscopedText)).toEqual({
      '--ar-boot-body': hex(DARK.body),
      '--ar-boot-surface': hex(DARK.surface),
      '--ar-boot-surface-2': hex(DARK.surface2),
      '--ar-boot-border': hex(DARK.border),
    });
  });

  it('lets the HOST override the OS guess in BOTH directions', () => {
    // 🔴 One direction is not enough and the missing one is silent. Without the
    // `='light'` rule a light host + a dark-mode OS keeps the dark base and then
    // flips light at BLOCK_INIT; without the `='dark'` rule a dark host + a
    // light-mode OS keeps the media block's light and then flips dark. Both are
    // the flash this file exists to remove, and neither shows up in a test that
    // only checks the direction someone happened to write first.
    expect(customPropertiesIn(scopedDark[0]?.body ?? '')).toEqual({
      '--ar-boot-body': hex(DARK.body),
      '--ar-boot-surface': hex(DARK.surface),
      '--ar-boot-surface-2': hex(DARK.surface2),
      '--ar-boot-border': hex(DARK.border),
    });
    expect(customPropertiesIn(scopedLight[0]?.body ?? '')).toEqual({
      '--ar-boot-body': hex(LIGHT.body),
      '--ar-boot-surface': hex(LIGHT.surface),
      '--ar-boot-surface-2': hex(LIGHT.surface2),
      '--ar-boot-border': hex(LIGHT.border),
    });
  });

  it('scopes those overrides to :root so they outrank the media block', () => {
    // (0,2,0) beats the media block's `:root` (0,1,0) and the base `html`
    // (0,0,1) — in both directions, and independent of source order. A bare
    // `[data-civitai-boot-theme='light']` descendant selector would not.
    for (const rule of [...scopedDark, ...scopedLight]) {
      expect(rule.selector).toMatch(/^:root\[data-civitai-boot-theme='(dark|light)'\]$/);
    }
  });

  it('paints the UA canvas dark from a base rule, independent of color-scheme support', () => {
    // `html { background: … }` is the strong guarantee: it does not depend on
    // `color-scheme` being honoured at all.
    expect(regions.base.replace(/\s+/g, ' ')).toMatch(
      new RegExp(`html\\s*\\{[^}]*background:\\s*${hex(DARK.body)}\\s*;`, 'i'),
    );
  });

  it('applies LIGHT only inside @media (prefers-color-scheme: light)', () => {
    const lightBlocks = regions.media.filter((m) =>
      /prefers-color-scheme\s*:\s*light/.test(m.query),
    );
    expect(lightBlocks).toHaveLength(1);

    expect(customPropertiesIn(lightBlocks[0]?.body ?? '')).toEqual({
      '--ar-boot-body': hex(LIGHT.body),
      '--ar-boot-surface': hex(LIGHT.surface),
      '--ar-boot-surface-2': hex(LIGHT.surface2),
      '--ar-boot-border': hex(LIGHT.border),
    });
  });

  it('leaks no LIGHT-only colour into the UNCONDITIONED rules', () => {
    const lightOnly = [LIGHT.surface2, LIGHT.border].map(hex);
    const mediaBody = regions.media
      .map((m) => m.body)
      .join('\n')
      .toLowerCase();
    for (const value of lightOnly) {
      // Positive control on the search itself: find the string where it DOES
      // live before asserting it is absent from the unconditioned rules.
      expect(mediaBody).toContain(value);
      expect(unscopedText.toLowerCase()).not.toContain(value);
    }
  });
});

describe('the skeleton cannot drift from the app palette', () => {
  const css = bootStyleText(parse(indexHtml));
  const regions = splitCssMediaBlocks(css);

  it('every --ar-boot-* value is a literal from brand.ts', () => {
    // Belt to the structural test's braces: that one pins WHERE the values
    // live, this one pins that they are the APP's values and not a hand-picked
    // grey that would flash at the handoff.
    //
    // 🔴 Collected PER RULE, not per region. `customPropertiesIn` keys by
    // property NAME, so any two rules declaring the same four names collapse to
    // four entries and the union is silently a quarter of the size it looks.
    // Per-REGION was already too coarse and the base region now proves it: it
    // holds three rules declaring the same four names (unscoped dark, scoped
    // dark, scoped light), and reading the region as one string returns only the
    // last of the three — which made this assertion compare four light values
    // against the expected eight.
    const declared = new Set<string>(
      [regions.base, ...regions.media.map((m) => m.body)]
        .flatMap((chunk) => topLevelRulesIn(chunk))
        .flatMap((rule) => Object.values(customPropertiesIn(rule.body))),
    );

    const known = [
      DARK.body,
      DARK.surface,
      DARK.surface2,
      DARK.border,
      LIGHT.body,
      LIGHT.surface,
      LIGHT.surface2,
      LIGHT.border,
    ].map(hex);

    for (const value of declared) expect(known).toContain(value);
    // …and every one of the eight is actually present, or the loop above is a
    // claim about an empty set.
    expect([...declared].sort()).toEqual([...new Set(known)].sort());
  });

  it('paints the hero band in hero.ts’s fixed ink, in BOTH themes', () => {
    // HERO_BAND_INK is fixed dark in both themes because the band's text is
    // fixed light. A themed skeleton hero would flash against it in light.
    expect(regions.base.toLowerCase()).toContain(hex(HERO_BAND_INK));
    for (const block of regions.media) {
      expect(block.body.toLowerCase()).not.toContain(hex(HERO_BAND_INK));
    }
  });
});

describe('the skeleton matches the first commit’s geometry', () => {
  // Not decoration: the whole feature is that the handoff from skeleton to
  // first render is not a visible jump. These are the literals from
  // src/theme.ts (`contentStyle`) and src/App.tsx (`<Stack gap={18}>`).
  const css = bootStyleText(parse(indexHtml)).replace(/\/\*[\s\S]*?\*\//g, '');
  const wellRule = /\[data-boot-well\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('found the well rule at all', () => {
    // Positive control: every assertion below is a `toMatch` over `wellRule`,
    // and all of them pass vacuously on an empty string.
    expect(wellRule.trim().length).toBeGreaterThan(0);
  });

  it('matches contentStyle: max-width 760, clamp padding, auto margins', () => {
    expect(wellRule).toMatch(/max-width:\s*760px/);
    expect(wellRule).toMatch(/padding:\s*clamp\(14px,\s*3vw,\s*24px\)/);
    expect(wellRule).toMatch(/margin:\s*0 auto/);
  });

  it('matches <Stack gap={18}>', () => {
    expect(wellRule).toMatch(/gap:\s*18px/);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DOES THE SKELETON ACTUALLY GO AWAY?
 *
 * The contract says React's `createRoot(container).render(...)` clears the
 * container's existing children before its first commit, so the skeleton
 * removes itself with no cleanup code — and it says that behaviour does NOT
 * generalise (Svelte 5's `mount()` appends; assume append until measured).
 *
 * "Cited from a contract" is not evidence about THIS repo's React version,
 * THIS repo's main.tsx shape, or THIS repo's markup. So it is measured here,
 * against a real `#root` prefilled with the REAL markup out of index.html.
 *
 * 🔴 The removal assertion alone would pass if the render threw and something
 * else emptied the container, so each test carries a POSITIVE CONTROL in the
 * same test: the app's own content must be on screen afterwards.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('createRoot clears the boot skeleton on first commit', () => {
  let container: HTMLElement;
  let root: ReturnType<typeof createRoot> | null = null;

  /** The real `#root` inner markup, straight out of index.html. */
  function realSkeletonMarkup(): string {
    const markup = parse(indexHtml).querySelector('#root')?.innerHTML ?? '';
    // A silently-empty fixture would make every assertion below vacuous — the
    // skeleton would be "removed" because it was never there.
    if (!markup.includes(BOOT_SKELETON_ATTRIBUTE)) {
      throw new Error(`index.html #root does not contain [${BOOT_SKELETON_ATTRIBUTE}]`);
    }
    return markup;
  }

  async function mountApp(): Promise<void> {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
  }

  beforeEach(() => {
    h.shared.list.mockResolvedValue({ items: [], nextCursor: null });
    h.shared.getCounts.mockResolvedValue({});

    container = document.createElement('div');
    container.id = 'root';
    container.innerHTML = realSkeletonMarkup();
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
  });

  it('removes [data-boot-skeleton] and renders the app in its place', async () => {
    // Precondition: the skeleton really is in the container before the render.
    expect(container.querySelector(`[${BOOT_SKELETON_ATTRIBUTE}]`)).not.toBeNull();

    await mountApp();

    // The claim.
    expect(container.querySelector(`[${BOOT_SKELETON_ATTRIBUTE}]`)).toBeNull();

    // 🔴 POSITIVE CONTROL, same test: the container is not merely empty — the
    // app's own tree is what replaced the skeleton.
    expect(container.querySelector('[data-testid="app-root"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="hero-title"]')?.textContent).toBe('App Requests');
  });

  it('leaves nothing of the skeleton behind — no orphaned boot elements', async () => {
    await mountApp();

    for (const attr of ['data-boot-well', 'data-boot-hero', 'data-boot-toolbar', 'data-boot-row']) {
      expect(document.querySelector(`[${attr}]`)).toBeNull();
    }
    // Positive control again: the app rendered, so the sweep above is a
    // statement about a real post-mount DOM rather than about a failed render.
    expect(container.querySelector('[data-testid="app-root"]')).not.toBeNull();
  });
});
