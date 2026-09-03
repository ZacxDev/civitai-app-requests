import { readFileSync } from 'node:fs';

import {
  BLOCK_INIT_FRAGMENT_MARKER_KEY,
  BLOCK_INIT_FRAGMENT_VERSION,
  encodeBlockInitFragment,
  parseBlockInitFragment,
} from '@civitai/app-sdk/blocks';
import { describe, expect, it } from 'vitest';

import { BOOT_THEME_ATTRIBUTE } from './bootTheme.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INIT-FRAGMENT FAST PATH, GRADED ON THE SHIPPED SCRIPT.
 *
 * `index.html` carries a hand-rolled, inline, pre-paint reader for
 * `#civitai-block=v1&theme=…`. It CANNOT import `parseBlockInitFragment` from
 * `@civitai/app-sdk`: the SDK arrives with the bundle, which is exactly what has
 * not loaded yet at the moment this runs. The duplication is deliberate — and
 * therefore a real drift risk, which is what this file exists to remove.
 *
 * 🔴 IT GRADES THE SHIPPED SCRIPT, NOT A COPY. The script text is EXTRACTED from
 * `index.html` and EXECUTED. A test that re-declared the regexes here would pass
 * forever while the file it is about drifted away underneath it — the single
 * most common way a "drift guard" ends up guarding nothing.
 *
 * 🔴 KNOWN LIMITATION, stated rather than hidden: nothing here can observe the
 * ORDERING hazard this fast path lives inside. The SDK's `iframeTransport` reads
 * the fragment during init and then STRIPS it from the URL
 * (`stripBlockInitFragment` + `history.replaceState`), so a component-time
 * `parseBlockInitFragment(location.hash)` in React would race that strip and
 * LOSE. A jsdom (or here, a stub-object) test cannot see it, because the
 * transport never runs and never strips — wrong code looks right. That is why
 * `src/bootTheme.ts` reads the ATTRIBUTE this script writes rather than the
 * hash, and why that choice is defended in prose there instead of by a test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/**
 * The inline boot script, straight out of `index.html`.
 *
 * `<script type="module" src="…">` (the bundle entry) is excluded by the
 * attribute-free `<script>` match — the boot script must have neither a `src`
 * nor a module type, since both would defer it past first paint.
 */
function extractBootScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  const source = match?.[1] ?? '';
  // A silently-empty extraction would make every assertion below vacuous: the
  // runner would execute nothing, set nothing, and every "falls back to dark"
  // case would pass for the wrong reason.
  if (!source.includes(BOOT_THEME_ATTRIBUTE)) {
    throw new Error(`index.html has no inline <script> setting ${BOOT_THEME_ATTRIBUTE}`);
  }
  return source;
}

const BOOT_SCRIPT = extractBootScript();

/**
 * The script's EXECUTABLE text, comments removed.
 *
 * The prose in there names `@civitai/app-sdk` and the word "import" several
 * times — explaining why it must not do either — so a `not.toContain` over the
 * raw text would fail on a correct file and, worse, could only be "fixed" by
 * deleting the explanation.
 */
const BOOT_CODE = BOOT_SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type MatchMediaBehaviour = 'prefers-light' | 'prefers-dark' | 'no-preference' | 'absent' | 'throws';

/**
 * Run the shipped script against a controlled environment and return what it
 * wrote onto `<html>`, or `null` if it wrote nothing.
 *
 * Stub objects rather than jsdom on purpose: this must live in the fast `node`
 * project (jsdom's `window.matchMedia` cannot be made to THROW or to be
 * genuinely ABSENT without fighting the environment), and the script only ever
 * touches three globals.
 */
function runBootScript(hash: string, media: MatchMediaBehaviour): string | null {
  const attributes: Record<string, string> = {};

  const matchMedia =
    media === 'absent'
      ? undefined
      : (query: string) => {
          if (media === 'throws') throw new Error('matchMedia exploded');
          if (media === 'no-preference') return { matches: false };
          const wantsLight = /prefers-color-scheme:\s*light/.test(query);
          return { matches: media === 'prefers-light' ? wantsLight : !wantsLight };
        };

  const windowStub = { matchMedia };
  const documentStub = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
    },
  };
  const locationStub = { hash };

  // Executing the shipped script IS the test — see the file header.
  new Function('window', 'document', 'location', BOOT_SCRIPT)(
    windowStub,
    documentStub,
    locationStub,
  );

  return attributes[BOOT_THEME_ATTRIBUTE] ?? null;
}

/** `#`-prefixed fragment exactly as the host would mint it. */
function hostFragment(theme: 'dark' | 'light'): string {
  return `#${encodeBlockInitFragment({
    theme,
    renderMode: 'iframe',
    blockInstanceId: 'bi_9f3c1a',
  })}`;
}

describe('the boot script is actually pre-paint', () => {
  it('is inline in <head>, with no src and no module type', () => {
    const head = /<head>([\s\S]*?)<\/head>/.exec(indexHtml)?.[1] ?? '';
    expect(head).toContain(BOOT_THEME_ATTRIBUTE);
    // Positive control on the slice: the head really was found and is not empty.
    expect(head).toContain('<title>');
    // The only <script src> in the document is the bundle entry, and it is in
    // <body>. A src/defer/async on the boot script would move it past the paint
    // it exists to influence.
    expect(head).not.toMatch(/<script[^>]+\bsrc=/);
    expect(head).not.toMatch(/<script[^>]+\b(defer|async)\b/);
  });

  it('imports nothing — the SDK is in the bundle that has not loaded yet', () => {
    // Positive control on the comment-stripper: it must not have eaten the code
    // along with the prose, or the two assertions below are about an empty
    // string.
    expect(BOOT_CODE).toContain('setAttribute');
    expect(BOOT_CODE).not.toMatch(/\bimport\b/);
    expect(BOOT_CODE).not.toContain('@civitai/');
  });
});

describe('🔴 the inline reader agrees with the SDK encoder — the drift pin', () => {
  // Fixture values chosen so the fragment's answer can only come from the
  // fragment: the OS preference is set to the OPPOSITE theme in each case, so a
  // reader that silently ignored the hash would return the other value.
  it.each([
    ['dark', 'prefers-light'],
    ['light', 'prefers-dark'],
  ] as const)('reads theme=%s out of the host fragment (OS says %s)', (theme, media) => {
    const hash = hostFragment(theme);
    // The SDK's own decoder, on the SDK's own encoder output — the reference
    // answer this copy has to reproduce.
    expect(parseBlockInitFragment(hash).theme).toBe(theme);
    expect(runBootScript(hash, media)).toBe(theme);
  });

  it('the encoder still emits the marker and version this reader matches', () => {
    // If the wire format moved, the assertions above would still pass (both
    // sides would move together only if the inline copy moved too — it cannot,
    // it is a literal). Pin the two constants the inline regexes hardcode.
    expect(BLOCK_INIT_FRAGMENT_MARKER_KEY).toBe('civitai-block');
    expect(BLOCK_INIT_FRAGMENT_VERSION).toBe('v1');
    expect(hostFragment('dark')).toContain('civitai-block=v1');
    expect(BOOT_CODE).toContain('civitai-block=');
  });
});

describe('🔴 FIRST-key precedence, both keys — the SDK reads the first, so must this', () => {
  it('refuses a v2 marker even when a v1 marker follows it', () => {
    // `URLSearchParams.get` returns the FIRST `civitai-block`, sees v2, refuses.
    // An unanchored `/civitai-block=v1/.test(h)` finds the SECOND and accepts —
    // the dangerous direction, and a defect that really shipped in the
    // generate-from-model reference.
    const hash = '#civitai-block=v2&civitai-block=v1&theme=light';
    expect(parseBlockInitFragment(hash)).toEqual({});
    // OS says dark, so a correct reader falls back to dark. A reader that took
    // the fast path would return 'light' — the two answers are distinguishable.
    expect(runBootScript(hash, 'prefers-dark')).toBe('dark');
  });

  it('refuses a bad FIRST theme even when a good theme follows it', () => {
    // Same rule one key over. Fixing only the marker leaves this one broken, and
    // the symptom is identical: a theme the host never asked for.
    const hash = '#civitai-block=v1&theme=blue&theme=dark';
    expect(parseBlockInitFragment(hash).theme).toBeUndefined();
    // OS says light, so a correct reader falls back to light; a reader that
    // found the later `theme=dark` would return dark.
    expect(runBootScript(hash, 'prefers-light')).toBe('light');
  });

  it('takes the fast path when the FIRST key of each pair is the valid one', () => {
    // 🔴 Positive control for the two refusals above: without this, "refuses"
    // is indistinguishable from "never takes the fast path at all".
    const hash = '#civitai-block=v1&civitai-block=v2&theme=dark&theme=blue';
    expect(parseBlockInitFragment(hash).theme).toBe('dark');
    expect(runBootScript(hash, 'prefers-light')).toBe('dark');
  });
});

describe('an unknown version degrades to no fast path', () => {
  it.each(['v2', 'v0', 'V1', '1', ''])('ignores marker %s', (version) => {
    const hash = `#civitai-block=${version}&theme=light`;
    expect(parseBlockInitFragment(hash).theme).toBeUndefined();
    expect(runBootScript(hash, 'prefers-dark')).toBe('dark');
  });
});

describe('total: malformed, absent and truncated input never throws', () => {
  const inputs: [name: string, hash: string][] = [
    ['empty string', ''],
    ['bare hash', '#'],
    ['marker with no value', '#civitai-block'],
    ['theme with no value', '#civitai-block=v1&theme='],
    ['truncated mid-key', '#civitai-block=v1&the'],
    ["the block app's own hash route", '#/requests/42'],
    ['a stray percent', '#%'],
    ['a lone ampersand', '#&&&'],
    ['a key that only LOOKS like ours', '#not-civitai-block=v1&theme=light'],
    ['percent-encoded theme (the documented narrowing)', '#civitai-block=v1&theme=%64ark'],
  ];

  it.each(inputs)('%s falls back to the OS answer', (_name, hash) => {
    expect(() => runBootScript(hash, 'prefers-light')).not.toThrow();
    expect(runBootScript(hash, 'prefers-light')).toBe('light');
    expect(runBootScript(hash, 'prefers-dark')).toBe('dark');
  });
});

describe('🔴 every fallback is DARK — the documented divergence from the reference', () => {
  // `palette()` (src/brand.ts) resolves an unknown/absent theme to DARK, and
  // index.html's unconditioned rules are dark with light only inside
  // `@media (prefers-color-scheme: light)`. The generate-from-model reference
  // falls back to 'light'; copying it verbatim would make this script contradict
  // the stylesheet it exists to drive.

  it('no OS preference at all resolves DARK, not light', () => {
    // The `no-preference` case is the one a `(prefers-color-scheme: dark)`
    // query answers wrongly for this app: it would be `false`, and a reader that
    // treated `false` as "light" would paint light on a viewer the CSS paints
    // dark.
    expect(runBootScript('', 'no-preference')).toBe('dark');
  });

  it('no matchMedia at all resolves DARK', () => {
    expect(runBootScript('', 'absent')).toBe('dark');
  });

  it('a matchMedia that THROWS resolves DARK — the catch branch', () => {
    expect(runBootScript('', 'throws')).toBe('dark');
  });

  it('an OS light preference still resolves LIGHT — positive control', () => {
    // 🔴 Without this, every "resolves DARK" above is indistinguishable from a
    // script hardcoded to 'dark'. The OS path must be able to produce the other
    // value.
    expect(runBootScript('', 'prefers-light')).toBe('light');
  });

  it('the host fragment still wins over a throwing matchMedia', () => {
    // The fast path resolves before the OS query is reached, so a broken
    // matchMedia must not cost the host's answer.
    expect(runBootScript(hostFragment('light'), 'throws')).toBe('light');
  });
});

describe('the script always records an answer', () => {
  it.each([
    ['', 'prefers-light'],
    ['', 'absent'],
    ['#garbage', 'throws'],
    [hostFragment('dark'), 'no-preference'],
  ] as const)('sets the attribute for hash %j / media %s', (hash, media) => {
    // 🔴 `bootThemeGuess()` reads this attribute back. A path that resolved a
    // theme but never wrote it would send React to its own OS fallback, which
    // can disagree with what was painted — the flash, reintroduced through the
    // back door.
    expect(runBootScript(hash, media)).not.toBeNull();
  });
});
