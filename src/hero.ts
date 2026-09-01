// The hero artwork, in ONE place.
//
// 🔴 SWAPPING THE HERO IS A ONE-FILE CHANGE: replace `src/assets/hero.svg`.
// If the replacement is a raster (png/jpg/webp), change the import path on the
// next line and nothing else — `<Hero>` takes a URL and does not care what it
// is. Keep a 3:1 aspect ratio (the band reserves that) or it will letterbox.
//
// Recorded in `taste.json` under `hero`. The current asset is a hand-drawn
// placeholder built from the brand hue and the app mark — NOT a `civitai
// generate` render, because that spends real Buzz; the operator is producing the
// final art separately.

import heroUrl from './assets/hero.svg';

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
