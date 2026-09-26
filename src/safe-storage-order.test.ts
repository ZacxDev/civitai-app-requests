import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 THE SAFE-STORAGE SHIM ONLY WORKS IF IT IS THE ENTRY MODULE'S *FIRST*
 * IMPORT.
 *
 * WHY — opaque origin, `SecurityError` on a mere read, why source order is the
 * entire mechanism, and why no linter here defends it — is documented ONCE, at
 * the hazard site: the comment block above the import in `src/main.tsx`. That
 * is the copy a person reordering imports actually has in front of them, so it
 * is the copy that is kept. Read it before changing anything here; it is not
 * restated in this file.
 *
 * 🔴 WHAT THIS GUARD DOES NOT DO. It is a **source-order** assertion, nothing
 * more. It does not prove the shim works, and it cannot: jsdom has no opaque
 * origin, so no test in this repo can reproduce the `SecurityError` this import
 * exists to absorb. The shim's own behaviour is the SDK's to test. What this
 * pins is the one property that is local to this repo and easy to break by
 * accident — that the entry module still installs it, first.
 *
 * Read off disk rather than imported, the way `toolchain-lockstep.test.ts` and
 * `version-lockstep.test.ts` do: importing `main.tsx` would mount the app, and
 * the property under test is the *textual* order of its imports, which an
 * evaluated module no longer carries. Every extractor below THROWS when the
 * shape it expects is missing, rather than returning undefined — a guard that
 * starts passing vacuously once someone deletes the thing it inspects is worse
 * than no guard.
 *
 * An earlier revision also asserted the shim was imported *exactly once*.
 * Deleted as inert: a duplicated side-effect import evaluates the module body
 * ONCE — the ES module registry keys on the resolved specifier — so the state
 * it forbade could not produce the hazard, and the first-import assertion below
 * still holds over a duplicated source. Measured: two `import './side.mjs';`
 * lines → 1 module body evaluation (node 24).
 */

/**
 * A BARE package specifier for the `safe-storage` subpath: `@scope/name` or
 * `name`, then exactly `/safe-storage`.
 *
 * 🔴 Neither the package NOR the whole specifier is hardcoded, and that is the
 * point. The shim is imported from `@civitai/app-sdk` only because
 * `@civitai/sdk` — the package #21 ported this app onto — does not publish a
 * `./safe-storage` subpath yet (taste.json → deferred →
 * `safe-storage-from-the-successor-sdk`). A test that spelled the old package
 * would go red BY DESIGN on the day of that migration, which is a tripwire for
 * intended work, not a guard.
 *
 * It is a pattern and not a substring test so the obvious walk — point the
 * import at a local no-op file that spells the right words while installing
 * nothing — does not satisfy it. Checked, not assumed: `./safe-storage`,
 * `../safe-storage`, `./safe-storage.js` and `/abs/safe-storage` are all
 * rejected; `@civitai/app-sdk/safe-storage`, `@civitai/sdk/safe-storage` and
 * `pkg/safe-storage` accepted.
 *
 * 🔴 It does NOT reject every such shape on its own. A bare-looking prefix that
 * is not a real package — `src/safe-storage` — matches this pattern. What
 * closes that is the runtime-dependency assertion below, which then demands
 * `src` be in `package.json` dependencies. Neither half is sufficient alone.
 */
const SHIM_SPECIFIER = /^(?:@[^@./][^/]*\/[^/]+|[^@./][^/]*)\/safe-storage$/;

/**
 * The one `<package>/safe-storage` import in `specifiers`.
 *
 * THROWS when there is none, so nothing downstream can start passing vacuously
 * once someone deletes the import outright, and throws on more than one so the
 * "which package" question always has a single answer.
 */
function shimImport(specifiers: string[]): string {
  const matches = specifiers.filter((specifier) => SHIM_SPECIFIER.test(specifier));
  if (matches.length !== 1) {
    throw new Error(
      `src/main.tsx: expected exactly one '<package>/safe-storage' import, found ` +
        `${matches.length} — imports are: ${specifiers.join(', ')}`,
    );
  }
  return matches[0];
}

/** `@scope/name/safe-storage` → `@scope/name`; `name/safe-storage` → `name`. */
function packageOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function repoFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/** Source with `//` and block comments removed, so prose cannot look like code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every import specifier in `source`, in the order they are written.
 *
 * The clause before `from` is matched with `[^'"]` rather than `[\s\S]` on
 * purpose, and it is load-bearing: a `?`-optional group is GREEDY (it prefers
 * to match), so a dot-star clause happily runs past a bare
 * `import 'side-effect';` line and binds to the *next* statement's `from`,
 * silently dropping every side-effect import — which is precisely the kind this
 * file exists to check. Forbidding quotes inside the clause makes it impossible
 * to cross another import's specifier. Caught by watching this test fail.
 */
function importSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers = [...code.matchAll(/^import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map(
    (match) => match[1],
  );
  if (specifiers.length === 0) {
    throw new Error('src/main.tsx: no import statements found — has the entry module moved?');
  }
  return specifiers;
}

/** The `src=` of `index.html`'s `<script type="module">`. */
function htmlModuleEntry(): string {
  const html = repoFile('../index.html');
  const match = html.match(/<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/);
  if (!match) {
    throw new Error('index.html: no <script type="module" src="..."> found');
  }
  return match[1];
}

describe('safe-storage is installed first', () => {
  it('index.html still boots src/main.tsx, so main.tsx is the entry module', () => {
    // Without this, every assertion below could keep passing about a file the
    // page no longer loads.
    expect(htmlModuleEntry()).toBe('/src/main.tsx');
  });

  it('makes the shim the FIRST import of the entry module', () => {
    const specifiers = importSpecifiers(repoFile('./main.tsx'));
    const shim = shimImport(specifiers);
    expect(
      specifiers[0],
      `src/main.tsx must import '${shim}' BEFORE anything else — it has to run ` +
        `before any dependency that touches localStorage while evaluating. ` +
        `Found imports in this order: ${specifiers.join(', ')}`,
    ).toBe(shim);
  });

  it('keeps the package the shim comes from a runtime dependency', () => {
    // 🔴 The premise here is narrower than it looks, so it is stated at the
    // scope it was actually established. What holds is npm's own semantics: the
    // PRODUCTION entry module imports this package, so it belongs in
    // `dependencies`, not `devDependencies`. Whether the Civitai platform
    // builder prunes devDependencies — and would therefore ship a bundle with
    // a missing module — is NOT observable from this repo and is NOT claimed.
    // An earlier revision of this comment asserted that mechanism as
    // established; it never was.
    const specifiers = importSpecifiers(repoFile('./main.tsx'));
    const owner = packageOf(shimImport(specifiers));
    const pkg = JSON.parse(repoFile('../package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(
      Object.keys(pkg.dependencies ?? {}),
      `src/main.tsx imports the safe-storage shim from '${owner}' in the ` +
        `production entry module, so '${owner}' must be a runtime dependency`,
    ).toContain(owner);
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain(owner);
  });
});
