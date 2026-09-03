import { describe, expect, it } from 'vitest';

import { customPropertiesIn, splitCssMediaBlocks, topLevelRulesIn } from './bootSkeleton.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VALIDATING THE INSTRUMENT.
 *
 * The boot skeleton's theme rule is a claim about STRUCTURE — "the dark values
 * live in the unconditioned rules; light lives only inside
 * `@media (prefers-color-scheme: light)`" — and `bootSkeleton.test.tsx` asserts
 * it by splitting the stylesheet with the two functions below and reading what
 * ended up where.
 *
 * 🔴 Which makes those two functions the instrument, not the subject. If
 * `splitCssMediaBlocks()` silently returned `{ base: '', media: [] }`, every
 * structural assertion over there would report a reassuring, meaningless
 * result. So they get their own negative and positive controls here, on
 * synthetic CSS whose answer is known by construction, in the fast `node`
 * project.
 *
 * The failure they are built against is specific: an `@media` block with nested
 * rules inside it — which is the exact shape of the real sheet — makes a
 * non-greedy `/@media[^{]*\{[^}]*\}/` stop at the FIRST inner `}`, so the tail
 * of the media block leaks back into what you then call the "base" rules. That
 * mis-split reads as "the light values are in the base rules" and would fail
 * loudly; the mirror image — a base rule swallowed INTO a media block — reads
 * as a pass. Both directions are asserted below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe('splitCssMediaBlocks', () => {
  it('keeps unconditioned rules in base and hoists nothing into media', () => {
    const { base, media } = splitCssMediaBlocks('html { background: #000; }\n.a { color: red; }');
    expect(media).toEqual([]);
    expect(base).toContain('background: #000');
    expect(base).toContain('color: red');
  });

  it('brace-matches a NESTED media block instead of stopping at the first }', () => {
    // The real sheet's shape: `:root { … }` and `html { … }` both nested inside
    // one `@media`. A naive `[^}]*` scan ends after `:root { … }` and drops
    // `html { … }` back into base.
    const css = `
      html { background: #14110c; }
      :root { --x: #14110c; }
      @media (prefers-color-scheme: light) {
        :root { --x: #fffbf4; }
        html { background: #fffbf4; }
      }
      .after { color: blue; }
    `;
    const { base, media } = splitCssMediaBlocks(css);

    expect(media).toHaveLength(1);
    expect(media[0]?.query).toBe('(prefers-color-scheme: light)');
    // Both nested rules stayed inside the block…
    expect(media[0]?.body).toContain('--x: #fffbf4');
    expect(media[0]?.body).toContain('background: #fffbf4');
    // …and none of the light values leaked out.
    expect(base).not.toContain('#fffbf4');
    // Negative control on the other side: base still holds what it should,
    // including the rule AFTER the media block. A splitter that swallowed the
    // tail would satisfy the `not.toContain` above for the wrong reason.
    expect(base).toContain('--x: #14110c');
    expect(base).toContain('color: blue');
  });

  it('separates several media blocks and keeps their queries', () => {
    const { media } = splitCssMediaBlocks(
      '@media (prefers-color-scheme: light) { a { b: 1 } }' +
        '@media (prefers-reduced-motion: reduce) { a { animation: none } }',
    );
    expect(media.map((m) => m.query)).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-reduced-motion: reduce)',
    ]);
  });

  it('strips comments so a brace inside one cannot unbalance the scan', () => {
    const { base, media } = splitCssMediaBlocks('/* } */ html { color: red; } /* @media { */');
    expect(media).toEqual([]);
    expect(base).toContain('color: red');
  });
});

/**
 * `topLevelRulesIn` is the second half of the instrument: `bootSkeleton.test.tsx`
 * uses it to separate the UNCONDITIONED base rules (which must be dark-only)
 * from the `[data-civitai-boot-theme='…']` rules (which carry both palettes on
 * purpose). If it returned `[]`, the dark-default assertion over there would
 * compare an empty map against four expected values and fail loudly — but the
 * mirror image, an at-rule's nested declarations leaking into a "rule", passes
 * silently and poisons the partition. Both directions are pinned here, on
 * synthetic CSS whose answer is known by construction.
 */
describe('topLevelRulesIn', () => {
  it('splits plain rules and keeps selector and body apart', () => {
    expect(topLevelRulesIn('html { background: #000; }\n:root { --x: 1; }')).toEqual([
      { selector: 'html', body: ' background: #000; ' },
      { selector: ':root', body: ' --x: 1; ' },
    ]);
  });

  it('collapses whitespace inside a selector so attribute rules compare equal', () => {
    const rules = topLevelRulesIn(":root[data-civitai-boot-theme='dark']\n  { --x: 1; }");
    expect(rules.map((r) => r.selector)).toEqual([":root[data-civitai-boot-theme='dark']"]);
  });

  it('🔴 SKIPS at-rules instead of emitting their nested bodies', () => {
    // The real sheet's shape: `@keyframes` with two nested blocks sits in the
    // base region. Emitting it as a "rule" would drop `opacity: 1` into the
    // caller's per-selector reasoning; a naive `[^}]*` scan would additionally
    // mistake `50% { … }` for a top-level rule and resume mid-block.
    const rules = topLevelRulesIn(
      'a { color: red; }' +
        '@keyframes p { 0%, 100% { opacity: 1; } 50% { opacity: 0.62; } }' +
        'b { color: blue; }',
    );
    expect(rules.map((r) => r.selector)).toEqual(['a', 'b']);
    // Negative control on the other side: the rule AFTER the at-rule survived
    // with its real body, so the scan resumed at the right place.
    expect(rules[1]?.body).toContain('color: blue');
    expect(rules.map((r) => r.body).join('')).not.toContain('opacity');
  });

  it('strips comments so a brace inside one cannot unbalance the scan', () => {
    const rules = topLevelRulesIn('/* } */ a { color: red; } /* { */');
    expect(rules.map((r) => r.selector)).toEqual(['a']);
  });

  it('stops on an unbalanced tail rather than guessing a body', () => {
    const rules = topLevelRulesIn('a { color: red; } b { color: blue;');
    expect(rules.map((r) => r.selector)).toEqual(['a']);
  });

  it('returns [] for CSS with no rules — the honest zero', () => {
    expect(topLevelRulesIn('/* nothing here */')).toEqual([]);
  });
});

describe('customPropertiesIn', () => {
  it('reads every declaration, lower-cased', () => {
    expect(customPropertiesIn(':root { --a: #FFFBF4; --b:  #14110C ; }')).toEqual({
      '--a': '#fffbf4',
      '--b': '#14110c',
    });
  });

  it('does NOT mistake a var() reference for a declaration', () => {
    // `background: var(--ar-boot-surface);` names a custom property but declares
    // nothing. Counting it would make the "the base rules declare exactly these
    // four" assertion in bootSkeleton.test.tsx unfalsifiable.
    expect(customPropertiesIn('.x { background: var(--ar-boot-surface); }')).toEqual({});
  });

  it('returns {} for CSS with no custom properties — the honest zero', () => {
    expect(customPropertiesIn('html { background: #14110c; }')).toEqual({});
  });
});
