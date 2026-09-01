import { describe, expect, it } from 'vitest';

import {
  animationFor,
  DURATION,
  entryMotionProps,
  motionDuration,
  motionProps,
  REDUCED_MOTION_QUERY,
  transitionFor,
} from './motion.js';

describe('the motion budget', () => {
  it('🔴 caps every duration at 200ms — nothing here is worth waiting for', () => {
    for (const [scale, ms] of Object.entries(DURATION)) {
      expect(ms, `${scale} = ${ms}ms`).toBeLessThanOrEqual(200);
      expect(ms).toBeGreaterThan(0);
    }
  });

  it('pins the literal durations so a "small tweak" is a visible diff', () => {
    expect(DURATION.control).toBe(120);
    expect(DURATION.panel).toBe(180);
    expect(DURATION.list).toBe(200);
  });
});

describe('motionDuration', () => {
  it('returns the scale duration at full motion', () => {
    expect(motionDuration('control', false)).toBe(120);
    expect(motionDuration('panel', false)).toBe(180);
    expect(motionDuration('list', false)).toBe(200);
  });

  it('🔴 returns 0 for EVERY scale under reduced motion', () => {
    expect(motionDuration('control', true)).toBe(0);
    expect(motionDuration('panel', true)).toBe(0);
    expect(motionDuration('list', true)).toBe(0);
  });
});

describe('transitionFor', () => {
  it('builds an interruptible transition for each property', () => {
    expect(transitionFor(['opacity', 'transform'], 'panel', false)).toBe(
      'opacity 180ms cubic-bezier(0.2, 0, 0, 1), transform 180ms cubic-bezier(0.2, 0, 0, 1)',
    );
  });

  it('🔴 is the literal string "none" under reduced motion — not a 0ms transition', () => {
    // `… 0ms` still schedules a transition and still fires transitionend. `none`
    // means nothing is scheduled at all, which is what "reduced" should mean.
    expect(transitionFor(['opacity'], 'panel', true)).toBe('none');
    expect(transitionFor(['opacity', 'transform', 'color'], 'list', true)).toBe('none');
  });
});

describe('animationFor', () => {
  it('names the keyframes and fills both ends', () => {
    expect(animationFor('ar-menu-in', 'panel', false)).toBe(
      'ar-menu-in 180ms cubic-bezier(0.2, 0, 0, 1) both',
    );
  });

  it('🔴 is "none" under reduced motion, so the element simply appears', () => {
    expect(animationFor('ar-menu-in', 'panel', true)).toBe('none');
  });
});

describe('the DOM motion contract', () => {
  it('publishes both the attribute AND the real style at full motion', () => {
    // The attribute alone would be a SPELLED guard — a component could render
    // data-motion="reduced" while still animating. Both halves are asserted.
    expect(motionProps(['opacity'], 'control', false)).toEqual({
      'data-motion': 'full',
      transition: 'opacity 120ms cubic-bezier(0.2, 0, 0, 1)',
    });
  });

  it('publishes both halves under reduced motion too', () => {
    expect(motionProps(['opacity'], 'control', true)).toEqual({
      'data-motion': 'reduced',
      transition: 'none',
    });
  });

  it('does the same for entry animations', () => {
    expect(entryMotionProps('ar-row-in', 'list', false)).toEqual({
      'data-motion': 'full',
      animation: 'ar-row-in 200ms cubic-bezier(0.2, 0, 0, 1) both',
    });
    expect(entryMotionProps('ar-row-in', 'list', true)).toEqual({
      'data-motion': 'reduced',
      animation: 'none',
    });
  });
});

describe('the media query', () => {
  it('is the standard one, spelled correctly', () => {
    // A typo here would make the whole feature silently inert.
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });
});
