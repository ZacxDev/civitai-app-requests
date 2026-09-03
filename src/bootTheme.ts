/**
 * Which theme React must paint with BEFORE `BLOCK_INIT` lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 WHY `useBlockContext().theme` IS UNUSABLE HERE
 *
 * The SDK's pre-init snapshot hardcodes `theme: 'light'`
 * (`@civitai/blocks-react` → `dist/internal/transport.js`, `EMPTY_SNAPSHOT`),
 * and `useBlockContext` returns `snap.theme` unchanged. So before `ready` that
 * value is a SENTINEL for EVERY viewer — literally indistinguishable from a host
 * that really is light.
 *
 * That is not academic. `index.html` paints its boot skeleton DARK (this app's
 * documented default). If React's first commit honoured the sentinel it would
 * paint LIGHT, and BLOCK_INIT would then repaint DARK: dark → light → dark. And
 * `bootSkeleton: true` is precisely what removes the host's opaque veil that
 * used to hide that sequence, so adopting the skeleton without this fix makes
 * the flash newly VISIBLE rather than leaving it where it was.
 *
 * 🔴 ONLY THE PRE-`ready` STATE USES THIS. Once `ready` is true the host's real
 * theme wins, whatever the attribute or the OS says. `App.tsx` reads
 * `ready ? theme : bootThemeGuess()` and nothing else calls this.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Where `index.html`'s inline boot script records the theme it painted with.
 *
 * Exported so the tests that grade the shipped script and the tests that grade
 * this module name the SAME string — a guard spelled twice is a guard that can
 * disagree with itself.
 */
export const BOOT_THEME_ATTRIBUTE = 'data-civitai-boot-theme';

export type BootTheme = 'dark' | 'light';

/**
 * The theme the boot skeleton is ALREADY on screen in.
 *
 * Deliberately a read-back of what was painted, not an independent
 * re-derivation: an independent one can differ (different fallback order, a
 * fragment that has since been stripped, a UA that answers `matchMedia`
 * differently on the second call), and "differs" here means a visible flash.
 *
 * 🔴 DO NOT "simplify" this to `parseBlockInitFragment(location.hash)`. The
 * SDK's own `iframeTransport` reads the fragment during its init and then STRIPS
 * it from the URL (`stripBlockInitFragment` + `history.replaceState`,
 * `@civitai/blocks-react` → `dist/internal/iframeTransport.js`). That init runs
 * before this component renders, so by the time we get here the hash is already
 * empty and the read falls through — producing exactly the repaint this function
 * exists to prevent. A jsdom test CANNOT see this: mocking
 * `@civitai/blocks-react` means the transport never runs and never strips, so
 * the wrong code looks right. The attribute is written before the bundle exists
 * and is never stripped, which is why it is the thing to read.
 */
export function bootThemeGuess(): BootTheme {
  try {
    // 1. WHAT THE BOOT SCRIPT ALREADY PAINTED WITH — host fragment first, OS
    //    second, dark last, all resolved in <head> before this bundle existed.
    const painted = document.documentElement.getAttribute(BOOT_THEME_ATTRIBUTE);
    if (painted === 'dark' || painted === 'light') return painted;

    // 2. The script did not run, or ran and could not set the attribute. Re-ask
    //    the OS the SAME WAY ROUND the script and the stylesheet do: light is
    //    the positive case, so `no-preference` — and any UA without the query —
    //    lands on dark, which is what the unattributed CSS paints.
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    // 3. No `matchMedia` at all (older embedded webviews), or a `document` that
    //    refused the read. Dark is this app's answer to "no information":
    //    `palette()` in brand.ts resolves an unknown theme to dark, and
    //    index.html's unconditioned rules paint dark.
    return 'dark';
  }
}
