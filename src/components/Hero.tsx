// The hero band: brand mark + name + tagline over the hero artwork slot.
//
// The artwork is a SLOT — it takes a URL from `src/hero.ts` and nothing here
// knows or cares what the image is. Swapping the hero is a one-file change (see
// that module's header).
//
// Failure behaviour is deliberate: if the image 404s or is blocked, `onError`
// drops it and the band renders as a plain dark well with the same text at the
// same size. Nothing shifts, nothing breaks — an image is never load bearing for
// meaning here. The SCRIM still renders in that case, and so does the band ink:
// the text is fixed light, so a band that fell back to a themed surface would be
// white-on-cream in light theme.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 LEGIBILITY HERE IS STRUCTURAL, NOT COMPOSITIONAL.
//
// The 0.3.0 defect: the band renders at whatever ratio the viewport gives it
// (~6:1 measured, against a 3:1 asset), so `object-fit: cover` crops the art by
// a width-dependent amount and the bright region lands wherever it lands. The
// scrim was a single left→right ramp that was WEAKEST at the right edge — the
// one place both the artwork's focal point and the CTA live. Amber text on amber
// art.
//
// Three things fix it, and none of them is "re-render the art with the subject
// somewhere else" — a fixed composition only clears the button at the width it
// was checked at:
//
//   1. A uniform scrim FLOOR across the whole band (HERO_SCRIM_ALPHA), so the
//      worst case is bounded no matter how the art crops. The directional ramp
//      survives on top of it, for depth only.
//   2. An opaque PLATE behind the action slot (HERO_ACTION_PLATE_ALPHA). The CTA
//      is a `variant="light"` Button — 86% transparent background, amber text —
//      so it has no surface of its own and the floor alone cannot rescue it.
//   3. An explicit `object-position` (HERO_OBJECT_POSITION) so the crop is
//      chosen rather than defaulted; at 0.3.0 the centred default sliced the
//      arrowhead off the top.
//
// The numbers behind 1 and 2 are measured against the brightest pixel in the
// committed asset and asserted in `hero.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { CSSProperties } from 'react';

import {
  HERO_ACTION_PLATE_ALPHA,
  HERO_ALT,
  HERO_BAND_INK,
  HERO_IMAGE_URL,
  HERO_OBJECT_POSITION,
  HERO_SCRIM_ALPHA,
  HERO_SCRIM_INK,
  HERO_TAGLINE_COLOR,
  HERO_TITLE_COLOR,
} from '../hero.js';
import { useReducedMotion, transitionFor } from '../motion.js';
import { radius } from '../theme.js';
import { BrandMark } from './BrandMark.js';

export interface HeroProps {
  /** The app name. Rendered as the page's single <h1>. */
  title: string;
  /** One line. Not an explainer paragraph — if it needs a second sentence, the layout failed. */
  tagline: string;
  /** Optional right-aligned slot for the secondary create action. */
  action?: React.ReactNode;
  /**
   * How the action sits in the band.
   *
   * `'inline'` — beside the title, right-aligned. The 0.3.x arrangement, and
   * what a band wider than ~768px should keep.
   *
   * `'block'` — on its own line below the title, stretched to the band's width.
   * Below `sm` the title, the tagline and a "Request an app" button cannot share
   * a line without the title wrapping to three, and `flex-wrap` alone drops the
   * button to a line where it then floats at its natural ~140px against a
   * full-width plate. Stretching it is what makes the wrap look chosen.
   *
   * Defaults to `'inline'` — the unmeasured frame must render what 0.3.3 shipped.
   */
  actionLayout?: 'inline' | 'block';
  /** Override the artwork URL (tests, and a future per-locale hero). */
  imageUrl?: string;
}

/** `rgba()` from a `#rrggbb` ink and an alpha. Keeps the alphas as named numbers. */
function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function Hero({
  title,
  tagline,
  action,
  actionLayout = 'inline',
  imageUrl = HERO_IMAGE_URL,
}: HeroProps): React.JSX.Element {
  const [imageOk, setImageOk] = useState(true);
  const reduced = useReducedMotion();
  const block = actionLayout === 'block';

  return (
    <header data-testid="hero" data-layout={actionLayout} style={bandStyle}>
      {imageOk && (
        <img
          src={imageUrl}
          alt={HERO_ALT}
          role="presentation"
          data-testid="hero-image"
          onError={() => setImageOk(false)}
          style={{
            ...imageStyle,
            transition: transitionFor(['opacity'], 'panel', reduced),
          }}
        />
      )}
      {/*
        Unconditional — NOT inside the `imageOk` branch. It is what guarantees
        the fixed-light text a contrast floor, and that has to hold in the
        image-failed case too. `aria-hidden` because it is pure paint; the testid
        exists only so the component test can assert the floor is really painted.
      */}
      <div data-testid="hero-scrim" aria-hidden style={scrimStyle} />
      <div
        style={
          block
            ? { ...overlayStyle, flexDirection: 'column', alignItems: 'stretch' }
            : overlayStyle
        }
      >
        <div style={rowStyle}>
          <BrandMark size={44} />
          <div style={{ minWidth: 0 }}>
            <h1 style={titleStyle} data-testid="hero-title">
              {title}
            </h1>
            <p style={taglineStyle} data-testid="hero-tagline">
              {tagline}
            </p>
          </div>
        </div>
        {action && (
          <div
            style={
              block
                ? { ...actionPlateStyle, display: 'flex', flexShrink: 1, width: '100%' }
                : actionPlateStyle
            }
            data-testid="hero-action"
          >
            {action}
          </div>
        )}
      </div>
    </header>
  );
}

const bandStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: radius.lg,
  // Fixed dark in both themes — the band's text is fixed light. See HERO_BAND_INK.
  border: `1px solid ${rgba('#FFFFFF', 0.08)}`,
  background: HERO_BAND_INK,
  isolation: 'isolate',
};

const imageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  // Chosen, not defaulted. NO `aspectRatio` here: with explicit width+height it
  // was inert at 0.3.0 and only ever documented a ratio the band does not honour.
  objectPosition: HERO_OBJECT_POSITION,
  zIndex: 0,
};

// 🔴 The floor is `background-COLOR` and the depth is `background-IMAGE`, and
// that split is deliberate rather than stylistic.
//
// A flat veil is a flat colour — writing it as a one-stop gradient in a stacked
// `background` shorthand would express the same paint while making the
// guarantee indistinguishable from the decoration sitting next to it in the same
// declaration. `background-image` paints ON TOP of `background-color`, so the
// ramps can only ever ADD darkening: the floor is a floor by construction, not
// by everyone remembering to keep it last in a list.
//
// It also keeps the guarantee READABLE. jsdom's CSS parser drops a multi-layer
// `background` shorthand containing gradients entirely (measured — the property
// comes back as an empty string), so the floor expressed that way would have
// been unassertable in the component test, and the only pin on it would have
// been arithmetic in a file that never renders anything. The decorative ramps
// below are still invisible to jsdom; nothing depends on them.
const scrimStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  pointerEvents: 'none',
  backgroundColor: rgba(HERO_SCRIM_INK, HERO_SCRIM_ALPHA),
  backgroundImage: [
    `radial-gradient(120% 180% at 100% 50%, ${rgba(HERO_SCRIM_INK, 0.3)} 0%, ${rgba(HERO_SCRIM_INK, 0)} 70%)`,
    `linear-gradient(90deg, ${rgba(HERO_SCRIM_INK, 0.55)} 0%, ${rgba(HERO_SCRIM_INK, 0.2)} 60%, ${rgba(HERO_SCRIM_INK, 0)} 100%)`,
  ].join(', '),
};

// The band's text colours are fixed light because the artwork behind them is
// always dark — enforced now rather than assumed: HERO_BAND_INK keeps the
// fallback dark too, and HERO_SCRIM_ALPHA keeps the artwork case dark. That is a
// deliberate exception to "nothing hardcodes a colour a theme should flip"; this
// text sits on the IMAGE, not on a themed surface, so flipping it with the theme
// would make it unreadable in one of them.
const overlayStyle: CSSProperties = {
  position: 'relative',
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: 'clamp(16px, 3vw, 24px)',
  minHeight: 116,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  minWidth: 0,
};

// The CTA's own backdrop. See HERO_ACTION_PLATE_ALPHA: a `variant="light"`
// Button is 86% transparent, so without this the artwork IS its background.
const actionPlateStyle: CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  padding: 5,
  borderRadius: radius.md,
  background: rgba(HERO_SCRIM_INK, HERO_ACTION_PLATE_ALPHA),
  // Deliberately a NEUTRAL hairline, not a brand-coloured one. An amber ring
  // here reads as the BUTTON's own outline and makes the CTA look like a
  // primary/outline control, which contradicts the settled decision that posting
  // is the secondary action (see taste.json → composer-is-secondary). Measured:
  // 3.6:1 against the plate's own fill, and the shadow is what carries the edge
  // on the outside — the plate itself is only ~1.9:1 against the scrimmed band,
  // so the outer side is NOT claimed to reach WCAG 1.4.11's 3:1.
  border: `1px solid ${rgba('#FFF8EC', 0.4)}`,
  boxShadow: `0 6px 18px ${rgba('#000000', 0.45)}`,
};

// 🔴 THE TYPE SCALE IS `clamp()`, NOT A MEDIA QUERY, AND THAT IS DELIBERATE.
//
// Every surface in this app is styled with a React inline `style`, and an inline
// style beats any stylesheet rule that is not `!important`. So a
// `@media (max-width: 479px) { … font-size: 17px }` in src/index.css would parse
// fine, ship, and do NOTHING — an inert declaration that reads as coverage while
// providing none. `clamp()` sits IN the inline style, so it cannot be shadowed,
// it needs no JS and no re-render, and inside a block's iframe `vw` already
// measures the slot rather than the browser window.
//
// Upper bounds are the 0.3.3 values exactly, so nothing changes at or above the
// width where they were chosen; the lower bounds are where the title stops
// wrapping to three lines in a 360px slot.
const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(17px, 4.5vw, 21px)',
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.015em',
  color: HERO_TITLE_COLOR,
};

const taglineStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 'clamp(12px, 2.8vw, 13px)',
  lineHeight: 1.4,
  color: HERO_TAGLINE_COLOR,
};
