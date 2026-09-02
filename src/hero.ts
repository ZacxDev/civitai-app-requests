// The hero artwork, in ONE place.
//
// 🔴 SWAPPING THE HERO IS A ONE-FILE CHANGE: replace `src/assets/hero.jpg`.
// `<Hero>` takes a URL and does not care what it is; only the import path on
// the line below names the file. Keep a 3:1 aspect ratio (the band reserves
// that) or it will letterbox.
//
// Provenance, and the reason this file is 2190x730 rather than the 1216x832
// that came out of the generator: `civitai generate` DOES NOT HONOUR
// `--aspect-ratio`. A 21:9 request produced 1216x832 (~1.46:1) four times over,
// and `--dry-run` echoed "21:9" straight back, which is an echo of the argument
// and not acceptance. So the band is composed, not generated to size: the
// render is scaled to the band height and composited flush RIGHT onto a 3:1
// canvas filled with its own corner colour, with the left 420px of its alpha
// ramped so it dissolves into the fill instead of leaving a vertical seam.
// The left half is deliberately empty — it is where the title and tagline sit.
//
// Prompt, workflow id and the exact compositing recipe are in `taste.json`
// under `hero`, so this is reproducible without re-deriving any of it.

import heroUrl from './assets/hero.jpg';

export const HERO_IMAGE_URL: string = heroUrl;

/**
 * Alt text. Empty on purpose: the hero is DECORATIVE — every fact it carries
 * (the app name, the tagline) is real text right beside it, so announcing it
 * again would just be noise in a screen reader. The `<img>` also gets
 * `role="presentation"`.
 */
export const HERO_ALT = '';

/** Intrinsic aspect ratio of the slot, as a CSS `aspect-ratio` value. */
export const HERO_ASPECT = '3 / 1';
