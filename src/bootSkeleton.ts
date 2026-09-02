// The `manifest.bootSkeleton` contract, implemented as functions so it can be
// asserted rather than eyeballed.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHY THIS FILE EXISTS
//
// `bootSkeleton: true` in block.manifest.json is a PROMISE to the run host. On
// that key the host stands down three things: the opaque branded veil, the
// `opacity: 0 → 1` fade on the iframe, and the `translateY(8px)` reveal settle.
// It publishes `aria-busy` on the iframe instead.
//
// So the key over an EMPTY `#root` is not a no-op — it is a BLANK IFRAME for the
// whole load, strictly worse than never opting in. The manifest key and the
// markup in index.html are one change with two halves, and nothing in a normal
// build notices when the halves separate: the manifest stays valid, the app
// still works, `npm run build` still passes, and the only symptom is a viewer
// staring at nothing.
//
// `validateBootSkeletonDocument()` below is the platform's blocking gate
// (`bootSkeleton-not-empty`), implemented verbatim, and `bootSkeleton.test.ts`
// runs it against this repo's own index.html on every `npm test`. That is the
// only thing keeping the two halves together.
// ─────────────────────────────────────────────────────────────────────────────

/** Selector for every element the platform recognises as a mount container. */
export const MOUNT_CONTAINER_SELECTOR = '#root, #app, [data-app-root]';

/** The marker attribute on the outermost boot element. An attribute, not a class. */
export const BOOT_SKELETON_ATTRIBUTE = 'data-boot-skeleton';

/**
 * Tags that do not count as painted content.
 *
 * Text nodes INSIDE these are excluded too. The contract's rule 3 says "at
 * least one non-whitespace text node" without qualifying where it may live, but
 * a container holding nothing but `<script>init()</script>` is exactly the
 * blank-iframe state the gate exists to catch — counting the script's source as
 * content would make the gate pass on its own worst case. This reading is
 * strictly stricter, so it can never let a real hazard through; it differs from
 * a literal reading only on input this repo does not produce.
 */
const NON_CONTENT_TAGS = new Set(['script', 'template', 'style', 'link', 'noscript']);

export interface BootSkeletonFinding {
  /** Which clause of the gate produced this. */
  rule: 'container-empty' | 'marker-outside-container';
  message: string;
}

/** True if `node` is an element whose tag paints nothing. */
function isNonContentElement(node: Node): boolean {
  return (
    node.nodeType === 1 /* ELEMENT_NODE */ &&
    NON_CONTENT_TAGS.has((node as Element).tagName.toLowerCase())
  );
}

/**
 * Rule 3: does `container`'s subtree hold at least one painted element or one
 * non-whitespace text node?
 *
 * Hand-rolled walk rather than a TreeWalker so the pruning above is expressible
 * — a TreeWalker filter that rejects a `<script>` still visits its children.
 */
function hasPaintedContent(container: Element): boolean {
  const queue: Node[] = Array.from(container.childNodes);

  while (queue.length > 0) {
    const node = queue.shift() as Node;

    if (isNonContentElement(node)) continue;

    if (node.nodeType === 1 /* ELEMENT_NODE */) return true;

    if (node.nodeType === 3 /* TEXT_NODE */ && (node.nodeValue ?? '').trim().length > 0) {
      return true;
    }

    queue.push(...Array.from(node.childNodes));
  }

  return false;
}

/** How a container is named in the gate's message. `#root`, `#app`, or the selector it matched. */
function containerLabel(container: Element): string {
  return container.id ? `#${container.id}` : `[data-app-root]`;
}

/**
 * GATE `bootSkeleton-not-empty` (BLOCKING).
 *
 * Apply when the submitted manifest has `bootSkeleton === true`. The platform
 * runs this against the BUILT entry document, because a bundler can rewrite the
 * entry. `bootSkeleton.test.ts` runs it against the SOURCE `index.html`, which
 * is a weaker claim and deliberately so: `dist/` does not exist when `npm test`
 * runs (CI order is `npm test` then `npm run build`), and a test that quietly
 * skips itself when its input is absent is worse than one whose scope is
 * stated. Vite copies the entry document through — rewriting only the module
 * `<script src>` — so the two agree today; if that ever stops being true, the
 * platform gate is what catches it.
 *
 * Returns every finding; an empty array is a PASS.
 */
export function validateBootSkeletonDocument(doc: Document): BootSkeletonFinding[] {
  const findings: BootSkeletonFinding[] = [];
  const containers = Array.from(doc.querySelectorAll(MOUNT_CONTAINER_SELECTOR));

  // Rule 2: no identifiable mount container -> PASS. There is no empty-container
  // hazard to detect and the gate deliberately does not guess.
  if (containers.length === 0) return findings;

  // Rule 3: every container must paint something.
  for (const container of containers) {
    if (!hasPaintedContent(container)) {
      findings.push({
        rule: 'container-empty',
        message:
          `manifest declares bootSkeleton: true but ${containerLabel(container)} is empty in ` +
          `the built index.html — the run host stands down its loading veil for this app, so ` +
          `the viewer would see a blank iframe for the whole load. Either paint a boot state ` +
          `inside the container, or remove bootSkeleton from the manifest.`,
      });
    }
  }

  // Rule 4: a marker outside every container is never replaced by the app's
  // render, so it stays on screen ON TOP of the app. `contains()` is true for
  // the node itself, hence the explicit self-exclusion: the container IS not a
  // descendant of itself.
  for (const marker of Array.from(doc.querySelectorAll(`[${BOOT_SKELETON_ATTRIBUTE}]`))) {
    const inside = containers.some((c) => c !== marker && c.contains(marker));
    if (!inside) {
      findings.push({
        rule: 'marker-outside-container',
        message:
          `the [${BOOT_SKELETON_ATTRIBUTE}] element is outside the mount container, so the ` +
          `app's own render will not replace it and it will stay on screen after mount.`,
      });
    }
  }

  return findings;
}

/**
 * CHECK `bootSkeleton-paints-without-network` (ADVISORY).
 *
 * Only meaningful once the blocking gate passes. Warns when the boot content is
 * styled solely by an external stylesheet — a second round-trip that can leave
 * it unstyled, or unpainted, in exactly the window the declaration is about.
 */
export function checkBootSkeletonPaintsWithoutNetwork(doc: Document): string[] {
  const hasInlineStyleElement = Array.from(doc.querySelectorAll('style')).some((el) =>
    (el.textContent ?? '').includes(BOOT_SKELETON_ATTRIBUTE),
  );
  if (hasInlineStyleElement) return [];

  const hasInlineStyleAttribute = Array.from(doc.querySelectorAll(MOUNT_CONTAINER_SELECTOR)).some(
    (container) => container.querySelector('[style]') !== null,
  );
  if (hasInlineStyleAttribute) return [];

  return [
    `no <style> element mentions [${BOOT_SKELETON_ATTRIBUTE}] and no element inside a mount ` +
      `container carries a style attribute — the boot content is styled only by an external ` +
      `stylesheet, which is a second round-trip inside the window bootSkeleton is about.`,
  ];
}

// ---- CSS structure, for the dark-default assertion ----

export interface CssMediaBlock {
  /** The condition text, e.g. `(prefers-color-scheme: light)`. */
  query: string;
  /** The block's body, with the wrapping braces removed. */
  body: string;
}

export interface CssRegions {
  /** Everything NOT inside an `@media` block — the unconditioned rules. */
  base: string;
  media: CssMediaBlock[];
}

/**
 * Split a stylesheet into its unconditioned rules and its top-level `@media`
 * blocks.
 *
 * The whole theme rule is STRUCTURAL — "dark is what a viewer with no
 * preference gets" — and jsdom does not evaluate media queries, so an assertion
 * about *computed* style would be vacuously true no matter which way round the
 * rules are written. Splitting the text and asserting where each value LIVES is
 * the claim that actually has teeth.
 *
 * Brace-matching, not a regex: a nested block inside `@media` (which is exactly
 * the shape here) makes a non-greedy `\{[^}]*\}` stop at the first inner `}`.
 * Comments are stripped first so a brace inside one cannot unbalance the scan.
 */
export function splitCssMediaBlocks(css: string): CssRegions {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const media: CssMediaBlock[] = [];
  let base = '';
  let i = 0;

  while (i < source.length) {
    const at = source.indexOf('@media', i);
    if (at === -1) {
      base += source.slice(i);
      break;
    }

    base += source.slice(i, at);

    const open = source.indexOf('{', at);
    if (open === -1) {
      // Malformed — no block to scan. Keep the remainder as base rather than
      // silently dropping it; a swallowed tail is how a guard stops seeing
      // things.
      base += source.slice(at);
      break;
    }

    let depth = 0;
    let end = -1;
    for (let j = open; j < source.length; j++) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      base += source.slice(at);
      break;
    }

    media.push({
      query: source.slice(at + '@media'.length, open).trim(),
      body: source.slice(open + 1, end),
    });
    i = end + 1;
  }

  return { base, media };
}

/**
 * Every `--custom-property: value` declaration in a chunk of CSS, keyed by
 * property name. Values are lower-cased and whitespace-collapsed so a
 * comparison against a palette literal cannot fail on `#14110C` vs `#14110c`.
 */
export function customPropertiesIn(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out[m[1] as string] = (m[2] as string).trim().replace(/\s+/g, ' ').toLowerCase();
  }
  return out;
}
