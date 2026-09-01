import { describe, expect, it } from 'vitest';

import {
  BRAND_HUE,
  contrastRatio,
  palette,
  paletteCssVars,
  parseHex,
  relativeLuminance,
  type Palette,
  type ThemeName,
} from './brand.js';

// 🔴 VALIDATE THE INSTRUMENT FIRST. Every assertion below is a number produced
// by `contrastRatio`. If that function is wrong, a whole palette can be
// certified accessible while being unreadable — so it is checked against the
// two ratios WCAG itself fixes by definition before it is trusted for anything.
describe('contrastRatio (the instrument)', () => {
  it('is 21:1 for black on white — the defined maximum', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a colour against itself — the defined minimum', () => {
    expect(contrastRatio('#F09800', '#F09800')).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(contrastRatio('#fedcba', '#123456'), 10);
  });

  it('agrees with the published luminance of pure white and pure black', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
  });

  // NEGATIVE CONTROL — the checker must be able to say NO. Without this, a
  // function that returned 21 unconditionally would pass every test above.
  it('reports a FAILING ratio for a genuinely low-contrast pair', () => {
    // #F09800 on white is the real reason `brandEdge` exists.
    expect(contrastRatio('#F09800', '#FFFFFF')).toBeLessThan(3);
  });

  it('rejects a malformed colour rather than scoring it 0 (which would fake a pass)', () => {
    expect(() => parseHex('not-a-colour')).toThrow();
    expect(() => parseHex('#12345')).toThrow();
  });

  it('accepts the 3-digit short form', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
  });
});

describe('brand identity', () => {
  it('is the brand hue, exactly', () => {
    expect(BRAND_HUE).toBe('#F09800');
  });

  it('uses that same hue as the fill in BOTH themes — the mark does not shift', () => {
    expect(palette('light').brand).toBe(BRAND_HUE);
    expect(palette('dark').brand).toBe(BRAND_HUE);
  });

  it('resolves an unknown or missing theme to dark (the host default), never undefined', () => {
    expect(palette(undefined)).toEqual(palette('dark'));
    expect(palette(null)).toEqual(palette('dark'));
    expect(palette('sepia')).toEqual(palette('dark'));
  });
});

// 🔴 THE SKIN DEBT. `brandDepth: skin` means the host no longer flips any of
// these for us. Each pair is asserted in BOTH themes; a regression in either one
// is a real, shippable defect that nobody would see until they opened the other
// theme.
const THEMES: ThemeName[] = ['light', 'dark'];

/** WCAG AA for normal body text. */
const AA_TEXT = 4.5;
/** WCAG AA for a UI component's boundary / a large-text pairing. */
const AA_NON_TEXT = 3;

describe.each(THEMES)('palette contrast — %s theme', (theme) => {
  const p: Palette = palette(theme);

  const textPairs: [keyof Palette, keyof Palette][] = [
    ['text', 'body'],
    ['text', 'surface'],
    ['text', 'surface2'],
    ['textDim', 'body'],
    ['textDim', 'surface'],
    ['textDim', 'surface2'],
    ['brandText', 'body'],
    ['brandText', 'surface'],
    ['brandText', 'brandSoft'],
    ['danger', 'surface'],
    ['danger', 'body'],
    ['success', 'surface'],
    ['brandOn', 'brand'],
  ];

  it.each(textPairs)('%s on %s clears AA for body text', (fg, bg) => {
    expect(contrastRatio(p[fg], p[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('the brand OUTLINE gives a filled control a perceivable boundary', () => {
    // This is what `brandEdge` is for: in light theme the fill itself does not
    // clear 3:1 against the page, so the outline has to.
    expect(contrastRatio(p.brandEdge, p.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(p.brandEdge, p.body)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('the focus ring is visible against the surface it lands on', () => {
    expect(contrastRatio(p.focus, p.surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(p.focus, p.body)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('card borders are perceivable without being loud', () => {
    const c = contrastRatio(p.border, p.surface);
    expect(c).toBeGreaterThan(1.3);
    expect(c).toBeLessThan(4);
  });

  it('separates the page from a card — cards are never invisible', () => {
    // Either the fills differ, or the border does the work. In light theme the
    // fills are close by design, so the border is load-bearing there.
    const fillDelta = Math.abs(relativeLuminance(p.surface) - relativeLuminance(p.body));
    const borderContrast = contrastRatio(p.border, p.body);
    expect(fillDelta > 0.005 || borderContrast > 1.3).toBe(true);
  });

  it('every token is a parseable hex colour', () => {
    for (const [name, value] of Object.entries(p)) {
      expect(() => parseHex(value), `${theme}.${name} = ${value}`).not.toThrow();
    }
  });
});

describe('the two themes are genuinely different', () => {
  it('inverts the text/background relationship rather than reusing one ramp', () => {
    const light = palette('light');
    const dark = palette('dark');
    // Light: dark text on a light page. Dark: the reverse.
    expect(relativeLuminance(light.text)).toBeLessThan(relativeLuminance(light.body));
    expect(relativeLuminance(dark.text)).toBeGreaterThan(relativeLuminance(dark.body));
  });

  it('does not accidentally ship the same value for a theme-responsive token', () => {
    const light = palette('light');
    const dark = palette('dark');
    for (const key of ['body', 'surface', 'surface2', 'border', 'text', 'textDim'] as const) {
      expect(light[key], `${key} must differ between themes`).not.toBe(dark[key]);
    }
  });
});

describe('paletteCssVars', () => {
  it('exposes the app tokens the stylesheet consumes', () => {
    const vars = paletteCssVars('light');
    expect(vars['--ar-surface']).toBe(palette('light').surface);
    expect(vars['--ar-text']).toBe(palette('light').text);
    expect(vars['--ar-brand']).toBe(BRAND_HUE);
  });

  it('🔴 re-points the design-system pack at the app palette', () => {
    // Without this the pack's Buttons/Cards/Alerts would keep the PLATFORM's
    // blue-on-grey and the app would be two colour systems stacked.
    const vars = paletteCssVars('dark');
    const p = palette('dark');
    expect(vars['--civitai-color-primary']).toBe(p.brand);
    expect(vars['--civitai-color-surface']).toBe(p.surface);
    expect(vars['--civitai-color-text']).toBe(p.text);
    expect(vars['--civitai-color-primary-fg']).toBe(p.brandOn);
  });

  it('produces a different map per theme', () => {
    expect(paletteCssVars('light')).not.toEqual(paletteCssVars('dark'));
  });
});
