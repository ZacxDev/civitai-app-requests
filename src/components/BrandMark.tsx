// The App Requests mark: an upward triangle inside a rounded square.
//
// The triangle is the app's whole idea in one glyph — a request rising as people
// vote for it — and it is the same shape the hero artwork repeats as a tally.
// Drawn inline (no network asset) so it paints with the first frame and inherits
// colour from its container.
//
// It is DECORATIVE: `aria-hidden`, because the app name is always rendered as
// real text beside it. Announcing "App Requests logo" next to the words "App
// Requests" is noise.

import { brandMarkStyle } from '../theme.js';

export interface BrandMarkProps {
  /** Edge length of the rounded square, in px. */
  size?: number;
  'data-testid'?: string;
}

export function BrandMark({ size = 40, 'data-testid': testId = 'brand-mark' }: BrandMarkProps): React.JSX.Element {
  const glyph = Math.round(size * 0.5);
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      style={{ ...brandMarkStyle, width: size, height: size }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
        {/* Upward triangle, slightly rounded so it sits with the square's radius. */}
        <path
          d="M12 4.5 L20.5 19.5 L3.5 19.5 Z"
          fill="currentColor"
          strokeLinejoin="round"
          strokeWidth={2.5}
          stroke="currentColor"
        />
      </svg>
    </span>
  );
}
