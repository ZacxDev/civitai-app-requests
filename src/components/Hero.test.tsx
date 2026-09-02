// The hero band's rendered contract.
//
// `hero.test.ts` proves the NUMBERS clear WCAG AA. This file proves the
// component actually renders from those numbers — the seam between the two,
// which is where a "verified in isolation" pass would have shipped a green
// arithmetic suite over an unchanged component.
//
// 🔴 Every assertion here is RED on 0.3.0, and each names the defect it pins.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  HERO_ACTION_PLATE_ALPHA,
  HERO_OBJECT_POSITION,
  HERO_SCRIM_ALPHA,
  HERO_TAGLINE_COLOR,
  HERO_TITLE_COLOR,
} from '../hero.js';
import { Hero } from './Hero.js';

function renderHero() {
  return render(
    <Hero
      title="App Requests"
      tagline="Ask. Vote. Watch it get built."
      action={
        <button type="button" data-testid="cta">
          Request an app
        </button>
      }
    />,
  );
}

describe('the scrim', () => {
  it('renders a dedicated scrim layer behind the overlaid content', () => {
    renderHero();
    const scrim = screen.getByTestId('hero-scrim');
    // Inside the band, and decorative.
    expect(screen.getByTestId('hero')).toContainElement(scrim);
    expect(scrim).toHaveAttribute('aria-hidden');
    // It must not swallow clicks aimed at the CTA sitting above it.
    expect(scrim.style.pointerEvents).toBe('none');
  });

  it('paints a uniform FLOOR, not only a directional ramp', () => {
    // 🔴 THE DEFECT. 0.3.0 scrimmed with ONE left-to-right gradient whose right
    // end was rgba(...,0.42) — weakest exactly where the artwork's focal point
    // and the CTA both are.
    //
    // The floor is a flat `background-color` spanning the whole band, so it has
    // no weakest edge by construction, and `background-image` (the decorative
    // ramps) can only paint ON TOP of it. Pinned to the exported constant so the
    // painted CSS and the contrast arithmetic in `hero.test.ts` cannot drift.
    renderHero();
    const scrim = screen.getByTestId('hero-scrim');
    expect(scrim.style.position).toBe('absolute');
    expect(scrim.style.inset).not.toBe('');
    // Flat: a colour, not a gradient, and carrying exactly the floor alpha.
    expect(scrim.style.backgroundColor).not.toContain('gradient');
    const alpha = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/.exec(scrim.style.backgroundColor);
    expect(alpha, scrim.style.backgroundColor).toBeTruthy();
    expect(Number(alpha?.[1])).toBe(HERO_SCRIM_ALPHA);
  });

  it('keeps the directional ramp as decoration ON TOP of the floor', () => {
    // Not load bearing — asserted only so a later restyle that moves the ramp
    // back into the same declaration as the floor (which is how the floor stops
    // being a floor) is visible in the diff rather than silent.
    renderHero();
    const scrim = screen.getByTestId('hero-scrim');
    expect(scrim.style.backgroundImage).toContain('gradient');
    expect(scrim.style.backgroundColor).not.toBe('');
  });

  it('survives the artwork failing to load', () => {
    // The band's text is FIXED light. If the scrim were tied to the image, the
    // error path would drop the only thing keeping that text legible.
    renderHero();
    fireEvent.error(screen.getByTestId('hero-image'));
    expect(screen.queryByTestId('hero-image')).toBeNull();
    expect(screen.getByTestId('hero-scrim')).toBeInTheDocument();
    expect(screen.getByTestId('hero-title')).toBeVisible();
  });

  it('sits above the artwork and below the content', () => {
    renderHero();
    const img = Number(screen.getByTestId('hero-image').style.zIndex);
    const scrim = Number(screen.getByTestId('hero-scrim').style.zIndex);
    expect(scrim).toBeGreaterThan(img);
    // The content wrapper is the scrim's next sibling and must out-stack it.
    const overlay = screen.getByTestId('hero-scrim').nextElementSibling as HTMLElement;
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(scrim);
  });
});

describe('the action slot', () => {
  it('gives the CTA its own backing plate', () => {
    // 🔴 THE DEFECT, the half a band-wide scrim cannot fix. The CTA is a
    // `variant="light"` Button — `color-mix(primary 14%, transparent)`, i.e. 86%
    // transparent, with an amber label. Without a plate the ARTWORK is its
    // background, which is how amber text ended up on amber art.
    renderHero();
    const plate = screen.getByTestId('hero-action');
    expect(plate).toContainElement(screen.getByTestId('cta'));
    expect(plate.style.background).toContain(`${HERO_ACTION_PLATE_ALPHA}`);
    // A perceivable edge, since the plate is only ~1.9:1 against the band.
    expect(plate.style.border).not.toBe('');
    expect(plate.style.boxShadow).not.toBe('');
  });

  it('is not rendered when there is no action', () => {
    render(<Hero title="App Requests" tagline="Ask. Vote. Watch it get built." />);
    expect(screen.queryByTestId('hero-action')).toBeNull();
  });
});

describe('the crop', () => {
  it('sets object-position explicitly', () => {
    // 🔴 THE DEFECT. 0.3.0 left it at the default (`50% 50%`), so the vertical
    // cover-crop was centred and sliced the arrowhead off the top of the frame.
    renderHero();
    const img = screen.getByTestId('hero-image');
    expect(img.style.objectFit).toBe('cover');
    expect(img.style.objectPosition).toBe(HERO_OBJECT_POSITION);
    expect(img.style.objectPosition).not.toBe('');
  });

  it('declares no aspect-ratio on the image', () => {
    // 🔴 THE DEFECT. 0.3.0 set `aspect-ratio: 3 / 1` on an <img> that already
    // had explicit width AND height, so it was inert — and it documented a ratio
    // the band does not honour (the band renders at ~6:1 at desktop width). An
    // inert declaration that reads as a layout guarantee is worse than none: it
    // is what made "the art collides with the CTA" look like an art problem.
    renderHero();
    expect(screen.getByTestId('hero-image').style.aspectRatio).toBe('');
  });
});

describe('the fixed-light text', () => {
  it('renders the exported title and tagline colours', () => {
    // These are a documented exception to the app's theme-token rule (the text
    // sits on the artwork). Pinning them here is what lets hero.test.ts do the
    // contrast arithmetic against the colours actually painted.
    renderHero();
    expect(rgbOf(screen.getByTestId('hero-title').style.color)).toBe(hexToRgb(HERO_TITLE_COLOR));
    expect(rgbOf(screen.getByTestId('hero-tagline').style.color)).toBe(hexToRgb(HERO_TAGLINE_COLOR));
  });

  it('keeps the band dark in its own right, not on a themed surface', () => {
    // The image-failed path falls back to this. At 0.3.0 it was
    // `var(--ar-surface-2)`, which is #FDF3E3 in LIGHT theme — near-white, under
    // fixed-light text.
    renderHero();
    const band = screen.getByTestId('hero');
    expect(band.style.background).not.toContain('var(');
    expect(band.style.background).not.toBe('');
  });
});

// jsdom normalises inline colours to `rgb(r, g, b)`; compare like for like.
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
function rgbOf(value: string): string {
  return value.trim();
}
