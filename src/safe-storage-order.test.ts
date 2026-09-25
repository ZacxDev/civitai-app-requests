import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 THE SAFE-STORAGE SHIM ONLY WORKS IF IT IS THE ENTRY MODULE'S *FIRST*
 * IMPORT.
 *
 * This block renders inside `<iframe sandbox="allow-scripts">` with no
 * `allow-same-origin` — the host adds that flag only for trusted tiers, and in
 * v1 every approved block is `unverified`. At that **opaque origin** there is no
 * origin to key web storage against, so reading `window.localStorage` does not
 * return an empty store: it throws `SecurityError`. Any dependency that touches
 * storage while its module body evaluates therefore takes the app down before
 * first paint, and libraries routinely mislabel the failure as something else.
 *
 * `@civitai/app-sdk/safe-storage` installs an in-memory `Storage` over a
 * present-but-unusable one, as an import side effect. ES module imports are
 * hoisted and evaluated depth-first in source order, which is why ORDER is the
 * whole mechanism: no *statement* in `main.tsx` can run before a sibling
 * import's module body, only an earlier import can. Demote the import one line
 * and the shim still installs — just possibly after the dependency that needed
 * it has already thrown.
 *
 * Nothing else in this repo defends that ordering. There is no linter and no
 * import-sorting formatter (the only CI steps are `pnpm test` and `pnpm build`),
 * so a reorder is a silent, one-line regression whose only symptom appears in a
 * real sandboxed iframe on civitai.com.
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
 */

const SHIM = '@civitai/app-sdk/safe-storage';

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
    expect(
      specifiers[0],
      `src/main.tsx must import '${SHIM}' BEFORE anything else — it has to run ` +
        `before any dependency that touches localStorage while evaluating. ` +
        `Found imports in this order: ${specifiers.join(', ')}`,
    ).toBe(SHIM);
  });

  it('imports the shim exactly once', () => {
    const specifiers = importSpecifiers(repoFile('./main.tsx'));
    expect(specifiers.filter((specifier) => specifier === SHIM)).toHaveLength(1);
  });

  it('keeps @civitai/app-sdk a runtime dependency, not a devDependency', () => {
    // The entry module imports it, so it ships in the bundle. Demoting it to
    // devDependencies would still build here and break the platform's builder.
    const pkg = JSON.parse(repoFile('../package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toContain('@civitai/app-sdk');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('@civitai/app-sdk');
  });
});
