import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 THE STORE READS ONE VERSION AND THE BUILD READS THE OTHER.
 *
 * `block.manifest.json` is what the platform reads: it decides the submitted
 * version, and `civitai app submit` refuses anything not above the highest
 * approved one. `package.json` is what the build and the toolchain read. A
 * release that bumps only one of them is a real, shippable defect, and nothing
 * else in this repo notices it.
 *
 * That is not hypothetical. On 2026-08-27 a batch that added the manifest's
 * `repository` key bumped the manifest and left `package.json` behind in SEVEN
 * apps at once. Two of them — civitai-app-model-benchmarking and
 * civitai-app-playable-collections — already had this assertion and went red
 * immediately (`expected '0.3.2' to be '0.3.1'`). The other five, this repo
 * among them, took the same bad change silently and one of them MERGED and
 * shipped that way. This file is the port of the guard that worked.
 *
 * Deliberately NOT a literal (`toBe('1.2.3')`). A literal pins nothing worth
 * knowing — "the version is the version" teaches a reader nothing — and it rots
 * on every single bump, turning the default branch red on a release that broke
 * nothing. A permanently-red gate is worse than no gate: it trains everyone to
 * merge through it, and the next real defect arrives looking exactly like this
 * one. The relationship between the two files cannot rot on a bump, and it
 * still fires when someone bumps only one.
 *
 * Read off disk rather than imported, on purpose: `tsconfig.json` here scopes
 * `include` to `src` and does not set `resolveJsonModule`, so `import pkg from
 * '../package.json'` would not typecheck. `import.meta.url` makes the paths
 * independent of the working directory the runner happens to use.
 */
function versionOf(relativePath: string): string {
  const raw = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string') {
    // Not a soft pass: a missing `version` is exactly the state this guard
    // exists to notice, so it must fail loudly rather than compare undefined
    // against undefined and go green.
    throw new Error(`${relativePath} has no string "version" field`);
  }
  return parsed.version;
}

describe('release versions', () => {
  it('keeps block.manifest.json and package.json versions in lockstep', () => {
    const manifestVersion = versionOf('../block.manifest.json');
    expect(manifestVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionOf('../package.json')).toBe(manifestVersion);
  });
});

/**
 * 🔴 THE OTHER HALF, AND THE ONE THAT ACTUALLY COST A SHIP.
 *
 * The lockstep guard above catches "one file bumped, the other not". It cannot
 * see the failure that stranded PR #15: BOTH files agreed, and the manifest's
 * CONTENT changed underneath a version that had already been approved.
 *
 * `civitai app submit` refuses a version that is not strictly above the highest
 * APPROVED one. So `4dbdff4` — which added `bootSkeleton: true` and left
 * `0.3.2` in place — produced a manifest that CAN NEVER BE SUBMITTED. Every
 * signal said fine: the manifest was valid, the app built, all 312 tests passed,
 * CI was green, the PR merged. Production kept serving PR #14's 0.3.2 tree with
 * `bootSkeleton: null`, and the only symptom was that a merged feature was not
 * live. `git log` shows the same shape at `dde1a6c`, which rewrote 0.2.0's
 * manifest — so this is a recurrence, not a one-off.
 *
 * The guard is a committed ledger of `version -> sha256(manifest minus version)`
 * in `release-manifest-ledger.json`. It is one-directional on purpose: a release
 * that changes only app code leaves the manifest content identical and that is
 * legitimate (0.1.3/0.1.4, 0.2.2/0.2.3 and 0.3.0/0.3.1 all share a hash), so
 * "two versions share a hash" is NOT an error. "The content moved and the
 * version did not" is.
 *
 * RED/GREEN, measured rather than asserted: at `4dbdff4b10` this file fails with
 * `0.3.2 does not match`; at HEAD (0.3.3) it passes.
 */

/**
 * sha256 of the manifest with `version` removed and the remaining keys sorted.
 *
 * Sorted, so a key reordering or a whitespace reflow is not a false positive —
 * the claim is about what the store READS, not about the bytes on disk. The
 * `version` key is removed because it is the thing being correlated: leaving it
 * in would make every entry trivially unique and the guard vacuous.
 */
function manifestContentHash(raw: string): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  delete parsed.version;
  const canonical = JSON.stringify(parsed, Object.keys(parsed).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

function readJson(relativePath: string): { raw: string; parsed: unknown } {
  const raw = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  return { raw, parsed: JSON.parse(raw) };
}

/** Numeric semver compare — `'0.3.10'` must sort ABOVE `'0.3.9'`, which a string compare gets wrong. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe('the manifest content cannot change without a version bump', () => {
  const manifest = readJson('../block.manifest.json');
  const version = (manifest.parsed as { version: string }).version;
  const contentHash = manifestContentHash(manifest.raw);

  const ledgerFile = readJson('../release-manifest-ledger.json');
  const releases = (ledgerFile.parsed as { releases?: Record<string, string> }).releases;

  it('the ledger loaded and is not empty — positive control', () => {
    // Every assertion below indexes `releases`. An absent or empty ledger would
    // make the recorded-hash lookup `undefined`, and a test written as
    // `expect(releases?.[version]).toBe(...)` would then fail for a reason that
    // reads like the defect but is not. Fail here instead, with the real cause.
    expect(releases, 'release-manifest-ledger.json has no "releases" object').toBeTypeOf('object');
    expect(Object.keys(releases ?? {}).length).toBeGreaterThan(1);
    // …and every value is a sha256, not a placeholder someone pasted.
    for (const [v, h] of Object.entries(releases ?? {})) {
      expect(v, `ledger key ${v}`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(h, `ledger value for ${v}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('🔴 records THIS version, with THIS content', () => {
    const recorded = releases?.[version];
    expect(
      recorded,
      `block.manifest.json says version ${version}, which is not in release-manifest-ledger.json.\n` +
        `If this is a new release, add:  "${version}": "${contentHash}"`,
    ).toBeDefined();
    expect(
      recorded,
      `the manifest's CONTENT changed but its version is still ${version}.\n` +
        `A version at or below the highest approved one is REFUSED by \`civitai app submit\`, so this ` +
        `change can never ship — it is exactly what happened to PR #15.\n` +
        `Bump the version in block.manifest.json AND package.json, then add:  "<new>": "${contentHash}"`,
    ).toBe(contentHash);
  });

  it('🔴 does not release backwards', () => {
    // A version below one already in the ledger is refused by the platform for
    // the same reason, and reads on disk as a perfectly ordinary edit.
    const highest = Object.keys(releases ?? {}).sort(compareVersions).at(-1);
    expect(highest).toBe(version);
  });

  it('the hash actually discriminates — negative control', () => {
    // 🔴 Otherwise "recorded === computed" is indistinguishable from a hash
    // function that returns a constant, and the whole guard is decorative.
    const mutated = JSON.parse(manifest.raw) as Record<string, unknown>;
    mutated.bootSkeleton = !mutated.bootSkeleton;
    expect(manifestContentHash(JSON.stringify(mutated))).not.toBe(contentHash);

    // …and it is INSENSITIVE to the two things it must not fire on: the version
    // itself, and key order / whitespace.
    const rebumped = JSON.parse(manifest.raw) as Record<string, unknown>;
    rebumped.version = '9.9.9';
    expect(manifestContentHash(JSON.stringify(rebumped))).toBe(contentHash);

    const reordered = JSON.parse(manifest.raw) as Record<string, unknown>;
    const shuffled = Object.fromEntries(Object.entries(reordered).reverse());
    expect(manifestContentHash(JSON.stringify(shuffled, null, 4))).toBe(contentHash);
  });
});
