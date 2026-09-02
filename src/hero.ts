// The hero artwork and the constants that make it LEGIBLE, in ONE place.
//
// 🔴 SWAPPING THE HERO IS A ONE-FILE CHANGE: replace `src/assets/hero.jpg`.
// `<Hero>` takes a URL and does not care what it is; only the import path on
// the line below names the file.
//
// Provenance, and the reason the committed file is 2190x730 rather than the
// 1216x832 that came out of the generator: `civitai generate` DOES NOT HONOUR
// `--aspect-ratio`. A 21:9 request produced 1216x832 (~1.46:1) four times over,
// and `--dry-run` echoed "21:9" straight back, which is an echo of the argument
// and not acceptance. So the source file is composed, not generated to size: the
// render is scaled to 730px and composited flush RIGHT onto a 3:1 canvas filled
// with its own corner colour, with the left 420px of its alpha ramped so it
// dissolves into the fill instead of leaving a vertical seam.
//
// Prompt, workflow id and the exact compositing recipe are in `taste.json`
// under `hero`, so this is reproducible without re-deriving any of it.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE BAND DOES NOT RENDER AT THE ASSET'S ASPECT RATIO, AND NEVER DID.
//
// This file used to export `HERO_ASPECT = '3 / 1'` with a comment claiming "the
// band reserves that". Both halves were false, and the pair produced the 0.3.0
// defect this module now guards against:
//
//   * The band reserves no ratio at all. Its height is `minHeight` on the
//     overlay (its content), and its width is whatever the host iframe is. So
//     the RENDERED ratio is a function of viewport width — measured at 0.3.0,
//     ~810x132 CSS px on a 1709px-wide capture, i.e. about 6:1, twice the
//     asset's 3:1.
//   * The `aspect-ratio` this file exported was applied to an absolutely
//     positioned `<img>` that already had explicit `width:100%; height:100%`.
//     Explicit sizing wins, so the declaration was INERT — it documented an
//     intent the layout never honoured, which is worse than documenting nothing.
//
// The consequence is that `object-fit: cover` crops the asset VERTICALLY, by an
// amount that changes with viewport width, and at 6:1 only ~49% of the artwork's
// height survives. Composition therefore cannot be relied on to keep bright art
// away from anything overlaid on it: at some width, it will be underneath.
//
// So legibility here is structural, not compositional — see HERO_SCRIM_ALPHA and
// HERO_ACTION_PLATE_ALPHA below, which is what `<Hero>` actually builds its
// scrim from and what `hero.test.ts` asserts a real contrast ratio against.
// ─────────────────────────────────────────────────────────────────────────────

import heroUrl from './assets/hero.jpg';

export const HERO_IMAGE_URL: string = heroUrl;

/**
 * Alt text. Empty on purpose: the hero is DECORATIVE — every fact it carries
 * (the app name, the tagline) is real text right beside it, so announcing it
 * again would just be noise in a screen reader. The `<img>` also gets
 * `role="presentation"`.
 */
export const HERO_ALT = '';

/**
 * The intrinsic ratio of the committed ASSET (2190x730). A fact about the file,
 * recorded so a replacement can be composed to the same shape — deliberately
 * NOT a CSS value and deliberately not applied to anything. See the header: the
 * band's rendered ratio is set by viewport width, so an `aspect-ratio` here
 * would be the same inert lie it was at 0.3.0.
 */
export const HERO_SOURCE_ASPECT_RATIO = 3;

/**
 * `object-position` for the cover-crop.
 *
 * Horizontal `100%`: at NARROW widths the band is taller than 3:1 relative to
 * its width, so the crop flips to horizontal — anchoring right keeps the arrow
 * (the whole subject) on screen instead of showing the deliberately empty left
 * half of the canvas.
 *
 * Vertical `10%`: at WIDE widths the crop is vertical and centring it sliced the
 * arrowhead off the top at 0.3.0. Anchoring near the top keeps the head inside
 * the window across the whole range — with the visible fraction as low as 40% of
 * the asset's height the window is [4%, 44%] and the tip sits at ~13.5%.
 */
export const HERO_OBJECT_POSITION = '100% 10%';

/**
 * The band's own background, behind the artwork.
 *
 * 🔴 Fixed dark in BOTH themes, on purpose, and it is load-bearing rather than
 * decorative: the hero's text is fixed light (it sits on the art, so flipping it
 * with the theme would make it unreadable in one of them). At 0.3.0 this was
 * `token.surface2`, which is `#FDF3E3` in light theme — so the documented
 * "the artwork behind them is always dark" premise broke the moment the image
 * failed to load and the band fell back to a near-white surface under fixed
 * light text. `hero.test.ts` asserts the image-failed case, not just the happy one.
 */
export const HERO_BAND_INK = '#1C160E';

/** The scrim ink. Warm near-black so the veil reads as part of the art, not a grey wash. */
export const HERO_SCRIM_INK = '#120E08';

/**
 * The scrim's UNIFORM floor alpha — applied across the WHOLE band, not as a
 * directional ramp.
 *
 * 🔴 This number is the 0.3.0 fix. That version scrimmed with a single
 * left-to-right gradient, `rgba(18,14,8,0.88)` → `rgba(18,14,8,0.42)`: darkest
 * where the title sits and LIGHTEST at the right edge, which is exactly where
 * both the artwork's focal point and the "Request an app" button are. Amber text
 * on amber art, at the one place in the frame with the least protection.
 *
 * A ramp cannot be tuned out of that failure, because how the art crops — and so
 * where its bright region lands — changes with viewport width. A floor can: at
 * 0.55 over the brightest pixel in the committed asset (#F7A86F, measured, not
 * guessed) the title clears 6.39:1 and the tagline 4.71:1, both above WCAG AA,
 * and it holds wherever that pixel ends up. The directional gradient is still
 * there ON TOP of this floor for depth, but nothing depends on it.
 */
export const HERO_SCRIM_ALPHA = 0.55;

/**
 * Alpha of the plate drawn behind the hero's action slot.
 *
 * 🔴 Needed as well as the floor because the CTA is a `variant="light"` Button,
 * whose background is `color-mix(in srgb, primary 14%, transparent)` — i.e. 86%
 * TRANSPARENT — with amber text. Its own surface is therefore not a surface at
 * all; whatever is behind the band shows through it. A scrim floor tuned for
 * light-on-dark text does not rescue amber-on-amber inside a control.
 *
 * The plate gives the control an actual backdrop: at 0.90 over the brightest
 * pixel, the button's amber label clears 5.55:1 against its own (mixed)
 * background. Asserted in `hero.test.ts`.
 */
export const HERO_ACTION_PLATE_ALPHA = 0.9;

/**
 * The brightest pixel in the committed hero asset, by WCAG relative luminance.
 *
 * Measured, not eyeballed — every pixel of `src/assets/hero.jpg` was enumerated
 * and ranked (L = 0.4893). This is the worst case any overlaid element can land
 * on, so it is what the contrast assertions in `hero.test.ts` composite against.
 *
 * 🔴 Re-measure this when the artwork is swapped. A brighter asset moves the
 * worst case and the alphas above are only correct relative to it; the test will
 * not tell you the constant went stale, because the test reads THIS constant.
 */
export const HERO_ART_BRIGHTEST = '#F7A86F';

/** Fixed light text colours for the band. See HERO_BAND_INK for why they are fixed. */
export const HERO_TITLE_COLOR = '#FFF8EC';
export const HERO_TAGLINE_COLOR = '#E3D6C2';
