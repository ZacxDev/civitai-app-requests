// The block's own width tier — a CONTAINER query, not a viewport media query.
//
// Ported from the blocks-react bridge package's `useBlockBreakpoint` when the app moved
// to `@civitai/sdk`, which is transport-only and carries no layout helpers. The
// behaviour is deliberately identical, because `src/layout.ts` and the board's
// responsive tests are written against this exact contract.
//
// 🔴 WHY A CONTAINER QUERY. A block renders inside a sandboxed iframe whose
// width is whatever slot the host gave it, and SLOT WIDTH IS NOT MONOTONIC IN
// VIEWPORT WIDTH: a sidebar slot is ~360px at a 360px viewport and only ~430px
// at a 1440px one. A `matchMedia('(min-width: 768px)')` inside the frame would
// answer a question nobody asked. Observing the element instead makes this a
// real container query.
//
// 🔴 WHY THE TIER, NOT THE WIDTH, IS THE STATE. A ResizeObserver fires on every
// pixel. Storing the resolved TIER means dragging a window edge 200px within one
// tier re-renders the board ZERO times. Exposing the raw width would either
// force a render per pixel or be a lie.

import { BREAKPOINT_KEYS, breakpoints, type BreakpointKey } from '@civitai/theme';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

/**
 * Width tier of the block's own box.
 *
 * `'base'` is "narrower than the smallest named breakpoint". Tier semantics
 * follow Tailwind's — a tier applies AT its breakpoint and above.
 */
export type BlockSizeTier = 'base' | BreakpointKey;

/** Ascending tier order. `base` first; the rest follow `BREAKPOINT_KEYS`. */
const TIER_ORDER: readonly BlockSizeTier[] = ['base', ...BREAKPOINT_KEYS];

/**
 * Resolve a width in CSS pixels to a tier.
 *
 * A non-finite or non-positive width (an unmeasured element, SSR, a
 * `display: none` ancestor) resolves to `'base'` — the most conservative tier.
 */
export function resolveBlockTier(width: number): BlockSizeTier {
  if (!Number.isFinite(width) || width <= 0) return 'base';
  let tier: BlockSizeTier = 'base';
  for (const key of BREAKPOINT_KEYS) {
    if (width >= breakpoints[key]) tier = key;
  }
  return tier;
}

export interface BlockBreakpoint {
  /** The current tier. `'base'` while unmeasured — see `measured`. */
  tier: BlockSizeTier;
  /**
   * `false` until a `ResizeObserver` measurement has landed.
   *
   * 🔴 THIS EXISTS BECAUSE `tier` ALONE IS LOSSY. An unmeasured width (0)
   * resolves to `'base'`, which is indistinguishable from a genuinely narrow
   * block. A caller doing a structural DOM swap on the narrow branch wants to
   * defer it one frame rather than render it and immediately undo it.
   */
  measured: boolean;
  /** `true` when the block is at least as wide as `key`'s breakpoint. */
  atLeast: (key: BreakpointKey) => boolean;
  /** `true` when the block is narrower than `key`'s breakpoint. */
  below: (key: BreakpointKey) => boolean;
}

/**
 * Report the block's own width tier.
 *
 * @param ref - Optional element to measure instead of the sandbox document
 *   element. The wrapper object may be recreated freely — the observer keys on
 *   the ELEMENT — and an element that mounts later is picked up.
 */
export function useBlockBreakpoint(ref?: RefObject<HTMLElement | null>): BlockBreakpoint {
  // `null` means UNMEASURED — distinct from a measured `'base'`. See `measured`.
  const [tier, setTier] = useState<BlockSizeTier | null>(null);

  // 🔴 THE EFFECT MUST NOT DEPEND ON THE REF WRAPPER'S IDENTITY. This hook
  // re-renders its caller, so a `[ref]` dependency would turn a caller who
  // writes `useBlockBreakpoint({ current: el })` inline into a
  // tear-down/re-observe on every render. The wrapper is held in a mutable ref
  // (never a dependency) and the effect keys on the observed ELEMENT.
  const refHolder = useRef(ref);
  refHolder.current = ref;
  const target = ref === undefined ? undefined : ref.current;

  // Last tier pushed into state. 🔴 THE DEDUPE HAPPENS HERE, NOT VIA A
  // `setTier(prev => prev === next ? prev : next)` BAIL-OUT: React's same-value
  // bail-out still re-renders the component one more time before it takes
  // effect, so the first no-op resize after a real change would still cost a render.
  const lastTier = useRef<BlockSizeTier | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const caller = refHolder.current;
    const el = caller
      ? caller.current
      : typeof document === 'undefined'
        ? null
        : document.documentElement;
    if (!el) return;

    const apply = (width: number) => {
      const next = resolveBlockTier(width);
      // The whole re-render guard: only a TIER CHANGE reaches the board.
      if (lastTier.current === next) return;
      lastTier.current = next;
      setTier(next);
    };

    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    observer.observe(el);
    // Seed synchronously from layout: `observe()` schedules its first callback,
    // and without this the block paints one frame at `measured: false` even
    // though the width is already knowable.
    apply(el.clientWidth);

    return () => observer.disconnect();
  }, [target]);

  return useMemo(() => {
    const resolved: BlockSizeTier = tier ?? 'base';
    const index = TIER_ORDER.indexOf(resolved);
    const atLeast = (key: BreakpointKey) => index >= TIER_ORDER.indexOf(key);
    return {
      tier: resolved,
      measured: tier !== null,
      atLeast,
      below: (key: BreakpointKey) => !atLeast(key),
    };
  }, [tier]);
}

export type { BreakpointKey };
