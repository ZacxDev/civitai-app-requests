// The hero band: brand mark + name + tagline over the hero artwork slot.
//
// The artwork is a SLOT — it takes a URL from `src/hero.ts` and nothing here
// knows or cares what the image is. Swapping the hero is a one-file change (see
// that module's header).
//
// Failure behaviour is deliberate: if the image 404s or is blocked, `onError`
// drops it and the band renders as a plain brand-tinted well with the same text
// at the same size. Nothing shifts, nothing breaks — an image is never load
// bearing for meaning here.

import { useState } from 'react';
import type { CSSProperties } from 'react';

import { HERO_ALT, HERO_ASPECT, HERO_IMAGE_URL } from '../hero.js';
import { useReducedMotion, transitionFor } from '../motion.js';
import { radius, token } from '../theme.js';
import { BrandMark } from './BrandMark.js';

export interface HeroProps {
  /** The app name. Rendered as the page's single <h1>. */
  title: string;
  /** One line. Not an explainer paragraph — if it needs a second sentence, the layout failed. */
  tagline: string;
  /** Optional right-aligned slot for the secondary create action. */
  action?: React.ReactNode;
  /** Override the artwork URL (tests, and a future per-locale hero). */
  imageUrl?: string;
}

export function Hero({ title, tagline, action, imageUrl = HERO_IMAGE_URL }: HeroProps): React.JSX.Element {
  const [imageOk, setImageOk] = useState(true);
  const reduced = useReducedMotion();

  return (
    <header data-testid="hero" style={bandStyle}>
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
      <div style={overlayStyle}>
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
        {action && <div style={{ flexShrink: 0 }}>{action}</div>}
      </div>
    </header>
  );
}

const bandStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  borderRadius: radius.lg,
  border: `1px solid ${token.border}`,
  background: token.surface2,
  isolation: 'isolate',
};

const imageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  aspectRatio: HERO_ASPECT,
  zIndex: -1,
};

// The scrim is what makes the text legible over ANY artwork someone drops in,
// in either theme — the band's own text colours are fixed light because the
// artwork behind them is always dark. That is a deliberate exception to
// "nothing hardcodes a colour a theme should flip": this text sits on the IMAGE,
// not on a themed surface, so flipping it with the theme would make it
// unreadable in one of them.
const overlayStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: 'clamp(16px, 3vw, 24px)',
  minHeight: 116,
  background:
    'linear-gradient(90deg, rgba(18,14,8,0.88) 0%, rgba(18,14,8,0.72) 55%, rgba(18,14,8,0.42) 100%)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 21,
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.015em',
  color: '#FFF8EC',
};

const taglineStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  lineHeight: 1.4,
  color: '#E3D6C2',
};
