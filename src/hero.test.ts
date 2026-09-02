// The hero band's LEGIBILITY CONTRACT, as arithmetic.
//
// 🔴 Why this file exists, and why it is not a screenshot test.
//
// The 0.3.0 defect was found by looking at the running app: the "Request an app"
// button sat on the brightest part of the artwork, amber label over amber art.
// Nothing in the suite could see it, because the suite could only assert that
// elements exist — and every element did exist, correctly, in the wrong colours.
//
// A screenshot test would not have caught it either, and would not catch its
// return: the band's rendered aspect ratio is a function of viewport width (see
// `hero.ts`), so the artwork crops differently at every width and a picture
// taken at one width says nothing about another. What IS width-independent is
// the composite: whatever the crop does, an overlaid element lands on some pixel
// of the asset, and the worst it can land on is the brightest one. Bound that and
// the class is closed at every width at once.
//
// So: flatten the real translucent stack the component builds (scrim over art;
// the CTA's 14%-primary background over its plate) and put a real WCAG number on
// it. The constants under test are the same ones `<Hero>` renders from — if this
// file passes and the component is still illegible, one of them stopped being
// used, which `Hero.test.tsx` is what pins.

import { describe, expect, it } from 'vitest';

import { compositeOver, contrastRatio, relativeLuminance } from './brand.js';
import {
  HERO_ACTION_PLATE_ALPHA,
  HERO_ART_BRIGHTEST,
  HERO_BAND_INK,
  HERO_OBJECT_POSITION,
  HERO_SCRIM_ALPHA,
  HERO_SCRIM_INK,
  HERO_SOURCE_ASPECT_RATIO,
  HERO_TAGLINE_COLOR,
  HERO_TITLE_COLOR,
} from './hero.js';

/** WCAG 2.1 AA for normal-size text. The tagline is 13px, so it is normal text, not large. */
const AA = 4.5;

/** The brand hue, which is both the CTA's label colour and 14% of its background. */
const BRAND = '#F09800';
/** `variant="light"` Button: `color-mix(in srgb, var(--civitai-color-primary) 14%, transparent)`. */
const LIGHT_BUTTON_TINT = 0.14;

/** The 0.3.0 scrim was a ramp: 0.88 at the left edge, 0.42 at the RIGHT — where the CTA is. */
const V030_RIGHT_EDGE_ALPHA = 0.42;

/** What the band actually looks like under an overlaid element, at a given scrim alpha. */
function scrimmed(alpha: number, art: string = HERO_ART_BRIGHTEST): string {
  return compositeOver(HERO_SCRIM_INK, art, alpha);
}

/** What a `variant="light"` Button's own background resolves to over a given backdrop. */
function lightButtonBackground(backdrop: string): string {
  return compositeOver(BRAND, backdrop, LIGHT_BUTTON_TINT);
}

describe('the instrument itself', () => {
  // 🔴 Positive + negative control on compositeOver BEFORE any verdict is read
  // from it. A flattener that quietly returned its background would make every
  // assertion below pass by reporting the ink's own contrast.
  it('composites at the defined endpoints', () => {
    expect(compositeOver('#ffffff', '#000000', 1)).toBe('#ffffff');
    expect(compositeOver('#ffffff', '#000000', 0)).toBe('#000000');
    expect(compositeOver('#ffffff', '#000000', 0.5)).toBe('#808080');
  });

  it('clamps rather than extrapolating out-of-range alpha', () => {
    expect(compositeOver('#ffffff', '#000000', 2)).toBe('#ffffff');
    expect(compositeOver('#ffffff', '#000000', -1)).toBe('#000000');
    expect(() => compositeOver('#ffffff', '#000000', Number.NaN)).toThrow(/not a number/);
  });

  it('moves the number in the direction more scrim implies', () => {
    // Feed it a value the constant cannot equal: the ordering must be strict, so
    // a flattener hardcoded to any single colour fails here.
    const light = contrastRatio(HERO_TITLE_COLOR, scrimmed(0.2));
    const heavy = contrastRatio(HERO_TITLE_COLOR, scrimmed(0.9));
    expect(heavy).toBeGreaterThan(light + 3);
  });

  it('agrees with the measured brightest pixel of the committed asset', () => {
    // Enumerated over every pixel of src/assets/hero.jpg, ranked by WCAG
    // relative luminance. Pinned so a swapped asset with a brighter pixel shows
    // up as a stale constant rather than as a silently weaker guarantee.
    expect(relativeLuminance(HERO_ART_BRIGHTEST)).toBeCloseTo(0.4893, 3);
  });
});

describe('the 0.3.0 defect, measured', () => {
  // 🔴 This is the negative control that gives every assertion below its
  // meaning: the SAME instrument, fed the SAME worst-case pixel, scores the
  // shipped 0.3.0 geometry as a failure. Without it "0.3.1 passes" is a claim
  // about a bar nobody has watched anything fall under.
  it('scored the CTA at 1.9:1 — a hard fail — where the button actually sits', () => {
    const band = scrimmed(V030_RIGHT_EDGE_ALPHA);
    // 0.3.0 had no plate: the button's translucent background resolved straight
    // onto the scrimmed artwork.
    const buttonBg = lightButtonBackground(band);
    const ratio = contrastRatio(BRAND, buttonBg);
    expect(ratio).toBeLessThan(2);
    expect(ratio).toBeLessThan(AA);
  });

  it('and left the tagline under AA at the same edge', () => {
    expect(contrastRatio(HERO_TAGLINE_COLOR, scrimmed(V030_RIGHT_EDGE_ALPHA))).toBeLessThan(AA);
  });

  it('and, with the image gone, put fixed-light text on a near-white light-theme band', () => {
    // 0.3.0's band background was `token.surface2` — #FDF3E3 in light theme.
    const lightSurface2 = '#FDF3E3';
    expect(contrastRatio(HERO_TITLE_COLOR, compositeOver(HERO_SCRIM_INK, lightSurface2, V030_RIGHT_EDGE_ALPHA)))
      .toBeLessThan(AA);
  });
});

describe('0.3.1: the scrim floor bounds the worst case', () => {
  it('holds the title and tagline above AA over the brightest pixel in the artwork', () => {
    const band = scrimmed(HERO_SCRIM_ALPHA);
    expect(contrastRatio(HERO_TITLE_COLOR, band)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(HERO_TAGLINE_COLOR, band)).toBeGreaterThanOrEqual(AA);
  });

  it('is a FLOOR, not a ramp — the guarantee cannot depend on which edge you are at', () => {
    // The component paints a directional ramp for depth ON TOP of the floor, so
    // every point of the band is at least this dark. The 0.3.0 failure was
    // precisely that the weakest point of a ramp is somewhere specific, and the
    // crop decides what is underneath it.
    expect(HERO_SCRIM_ALPHA).toBeGreaterThan(V030_RIGHT_EDGE_ALPHA);
  });

  it('holds when the artwork fails to load, in the LIGHT theme too', () => {
    // The band ink is fixed dark in both themes precisely so this case cannot
    // regress; the text above it is fixed light and cannot flip.
    const band = compositeOver(HERO_SCRIM_INK, HERO_BAND_INK, HERO_SCRIM_ALPHA);
    expect(contrastRatio(HERO_TITLE_COLOR, band)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(HERO_TAGLINE_COLOR, band)).toBeGreaterThanOrEqual(AA);
    // And the ink is genuinely dark, not merely "a constant".
    expect(relativeLuminance(HERO_BAND_INK)).toBeLessThan(0.05);
  });
});

describe('0.3.1: the action plate rescues the CTA specifically', () => {
  it('lifts the button label above AA against its own translucent background', () => {
    const plate = compositeOver(HERO_SCRIM_INK, HERO_ART_BRIGHTEST, HERO_ACTION_PLATE_ALPHA);
    const buttonBg = lightButtonBackground(plate);
    expect(contrastRatio(BRAND, buttonBg)).toBeGreaterThanOrEqual(AA);
  });

  it('needs to be heavier than the band floor — the floor alone does NOT rescue it', () => {
    // Stated as a measurement rather than as a preference: at the band's floor
    // the CTA is still under AA, which is why the plate exists at all.
    const atFloor = lightButtonBackground(scrimmed(HERO_SCRIM_ALPHA));
    expect(contrastRatio(BRAND, atFloor)).toBeLessThan(AA);
    expect(HERO_ACTION_PLATE_ALPHA).toBeGreaterThan(HERO_SCRIM_ALPHA);
  });

  it('still clears AA when the artwork is missing entirely', () => {
    const plate = compositeOver(HERO_SCRIM_INK, HERO_BAND_INK, HERO_ACTION_PLATE_ALPHA);
    expect(contrastRatio(BRAND, lightButtonBackground(plate))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the aspect claim is honest', () => {
  it('records the ASSET ratio as a number, not as a CSS aspect-ratio to apply', () => {
    // 0.3.0 exported `HERO_ASPECT = '3 / 1'` and applied it to an <img> that
    // already had width:100%;height:100% — inert, and it documented a ratio the
    // band never honoured. A number cannot be pasted into a style by accident.
    expect(HERO_SOURCE_ASPECT_RATIO).toBe(3);
    expect(typeof HERO_SOURCE_ASPECT_RATIO).toBe('number');
  });

  it('chooses the crop explicitly instead of defaulting it', () => {
    expect(HERO_OBJECT_POSITION).toMatch(/^\S+\s+\S+$/);
    // Right-anchored: at narrow widths the crop flips horizontal and the subject
    // is on the right of the canvas.
    expect(HERO_OBJECT_POSITION.split(/\s+/)[0]).toBe('100%');
    // Near the top: centring is what sliced the arrowhead off at 0.3.0.
    const vertical = Number.parseFloat(HERO_OBJECT_POSITION.split(/\s+/)[1]);
    expect(vertical).toBeLessThan(50);
  });
});
