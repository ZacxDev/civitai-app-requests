// Motion policy for the App Requests board.
//
// 🔴 `prefers-reduced-motion` is honoured BEHAVIOURALLY, not by shipping a media
// query and hoping. Every animated surface reads its duration from
// {@link useMotion}, which returns `0` when the viewer asked for reduced motion —
// so the assertion a test can make is "the rendered element's transition
// duration is 0ms", not "a media query string exists somewhere".
//
// The durations are deliberately small. Anything a viewer has to WAIT for is a
// worse app; these are all at or under the 200 ms the taste rubric caps.

import { useEffect, useState } from 'react';

/** Motion durations in milliseconds, at full motion. All ≤ 200 ms by policy. */
export const DURATION = {
  /** Hover / press feedback on a control. */
  control: 120,
  /** A row or panel appearing, a menu opening. */
  panel: 180,
  /** A list re-ordering or an item leaving. */
  list: 200,
} as const;

export type MotionScale = keyof typeof DURATION;

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Read the viewer's reduced-motion preference, live.
 *
 * Defensive about the environment on purpose: `matchMedia` is absent in some
 * embedding contexts and its `addEventListener` form is absent in older ones.
 * A throw here would take the whole block down for a preference query, so every
 * step degrades to "full motion" rather than failing.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotionNow());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      return;
    }
    const onChange = () => setReduced(Boolean(mql.matches));
    onChange();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Legacy Safari / older jsdom.
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
    return;
  }, []);

  return reduced;
}

/** One-shot read of the preference (also the `useReducedMotion` initial state). */
export function prefersReducedMotionNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return Boolean(window.matchMedia(REDUCED_MOTION_QUERY).matches);
  } catch {
    return false;
  }
}

/**
 * The duration to actually use, in ms. Pure so it can be unit-tested with
 * literal expectations independent of React.
 */
export function motionDuration(scale: MotionScale, reduced: boolean): number {
  return reduced ? 0 : DURATION[scale];
}

/**
 * A ready-made CSS transition string for a set of properties.
 * Returns `'none'` under reduced motion — not `'… 0ms'` — so nothing is
 * scheduled at all and an interrupted transition has nothing to interrupt.
 */
export function transitionFor(
  properties: readonly string[],
  scale: MotionScale,
  reduced: boolean,
): string {
  const ms = motionDuration(scale, reduced);
  if (ms === 0) return 'none';
  return properties.map((p) => `${p} ${ms}ms cubic-bezier(0.2, 0, 0, 1)`).join(', ');
}

/**
 * The motion contract a component publishes to the DOM: `data-motion` is
 * `reduced` or `full`, and `style.transition` is the real, interruptible
 * transition (or `none`). Tests assert BOTH — the attribute alone would be a
 * spelled guard, walkable by rendering it while animating anyway.
 */
export function motionProps(
  properties: readonly string[],
  scale: MotionScale,
  reduced: boolean,
): { 'data-motion': 'reduced' | 'full'; transition: string } {
  return {
    'data-motion': reduced ? 'reduced' : 'full',
    transition: transitionFor(properties, scale, reduced),
  };
}

/**
 * A CSS `animation` shorthand for an ENTRY animation (a transition cannot animate
 * an element that is only just being mounted). Returns `'none'` under reduced
 * motion, so the element simply appears — which is the correct reduced-motion
 * behaviour for a disclosure, not a slower version of the same movement.
 *
 * Keyframe names are defined in `src/index.css`.
 */
export function animationFor(
  keyframes: string,
  scale: MotionScale,
  reduced: boolean,
): string {
  const ms = motionDuration(scale, reduced);
  if (ms === 0) return 'none';
  return `${keyframes} ${ms}ms cubic-bezier(0.2, 0, 0, 1) both`;
}

/** The DOM contract for an entry-animated element. Mirrors {@link motionProps}. */
export function entryMotionProps(
  keyframes: string,
  scale: MotionScale,
  reduced: boolean,
): { 'data-motion': 'reduced' | 'full'; animation: string } {
  return {
    'data-motion': reduced ? 'reduced' : 'full',
    animation: animationFor(keyframes, scale, reduced),
  };
}
