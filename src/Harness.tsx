import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { __configurePlatform } from './platform/client.js';
import { createFakeBoard, DEV_VIEWER, type FakeSeed } from './platform/testing.js';

// 🔴 The mock chrome deliberately does NOT use the app's palette. Those tokens
// (`--ar-*`) are written INLINE on the block root, which is a descendant of this
// chrome, so they do not resolve out here — and more importantly the chrome must
// read as unmistakably NOT the app. Fixed dev-only colours, never shipped to a
// viewer (this file is only mounted under VITE_DEV_HARNESS).
const CHROME_TEXT = '#c9d1d9';
const CHROME_DIM = '#8b949e';
const CHROME_ACCENT = '#3fb950';
const CHROME_BORDER = '#30363d';
const CHROME_BG = '#161b22';
const CHROME_BG_RAISED = '#21262d';

// A seeded, cross-user board so the local harness looks like a live one. The
// viewer's own seed (author 7777) exercises the edit/withdraw affordances;
// `voters` casts each voter's `vote` mark, which is what the tallies count.
const SEED: FakeSeed[] = [
  {
    value: { title: 'A prompt-library app with tags & sharing', body: 'Save prompts, tag them, share collections with the community.' },
    authorId: 4021,
    voters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  {
    value: { title: 'Batch upscaler that queues overnight' },
    authorId: 5099,
    voters: [1, 2, 3, 4, 5, 6, 7],
  },
  {
    value: { title: 'A LoRA training cost estimator', body: 'Estimate Buzz before you commit a training run.' },
    authorId: DEV_VIEWER.id,
    voters: [1, 2, 3],
  },
  {
    value: { title: 'Dark-mode-aware model cards on profiles' },
    authorId: 3140,
    voters: [1],
  },
];

/**
 * Local dev fake for the App Requests PAGE app.
 *
 * The real platform mounts the block in a full-bleed iframe, hands it a block
 * token, and serves its data from the App Blocks document store. Locally there
 * is neither, so this plays both: a scripted host that completes the handshake,
 * and the SDK's in-memory document store (`createFakeStorage`, built from this
 * app's real manifest), seeded with a small board so the app is immediately
 * usable.
 *
 * Everything between the board and that store is the REAL shipping code — the
 * hooks, `src/platform/requests.ts` and the SDK's storage client. A loud banner
 * + a scenario panel make it obvious the data is synthetic (nothing is written
 * to Civitai).
 */
export function Harness({ children }: { children: ReactNode }) {
  // The viewer is pinned to DEV_VIEWER so the seeded "own" entry shows the
  // edit/withdraw affordances. `anon` exercises the read-only path.
  const [anon, setAnon] = useState(false);
  const [failNext, setFailNext] = useState(0);
  const [key, setKey] = useState(0);
  /** The scenario whose fake is installed, or `null` while it is being seeded. */
  const [installed, setInstalled] = useState<number | null>(null);

  // Dev-only URL toggle: `?seed=empty` mounts an empty board so the redesigned
  // "no requests yet" empty state is easy to preview/screenshot. Harness-only —
  // it never affects the shipped block.
  const emptySeed =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('seed') === 'empty';

  // Rebuilt whenever a scenario toggle changes `key`. Seeding is async (it goes
  // through the store as each author and voter), so the board is mounted only
  // once THIS scenario's fake is installed — a scenario can never be read
  // against the previous scenario's data.
  useEffect(() => {
    let cancelled = false;
    setInstalled(null);
    void createFakeBoard({
      viewer: anon ? null : DEV_VIEWER,
      seed: emptySeed ? [] : SEED,
      failNext: failNext || undefined,
      theme: 'dark',
    }).then((fake) => {
      if (cancelled) return;
      __configurePlatform(fake.overrides);
      setInstalled(key);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` IS the scenario identity
  }, [key]);

  return (
    // The mock chrome is pinned to the dark terminal look (its own data-theme) so
    // it reads as unmistakably NOT the app, regardless of the app's theme below.
    <div data-theme="dark" style={rootStyle}>
      <div data-harness-banner="mock" style={bannerStyle}>
        MOCK HOST · document store is in-memory · nothing is written to Civitai
      </div>
      <ScenarioPanel
        anon={anon}
        onToggleAnon={() => {
          setAnon((a) => !a);
          setKey((k) => k + 1);
        }}
        onFailNext={() => {
          setFailNext(1);
          setKey((k) => k + 1);
        }}
        onReset={() => {
          setFailNext(0);
          setAnon(false);
          setKey((k) => k + 1);
        }}
      />
      {/* `key` re-mounts the board whenever a scenario changes something the
          handshake decides (the viewer), so it re-initialises against the fake
          that was just rebuilt above. */}
      {installed === key ? <div key={key}>{children}</div> : null}
    </div>
  );
}

function ScenarioPanel({
  anon,
  onToggleAnon,
  onFailNext,
  onReset,
}: {
  anon: boolean;
  onToggleAnon: () => void;
  onFailNext: () => void;
  onReset: () => void;
}) {
  return (
    <details data-harness-scenario-panel="true" style={panelStyle}>
      <summary style={summaryStyle}>mock scenarios</summary>
      <div style={panelBodyStyle}>
        <button type="button" style={btnStyle} onClick={onToggleAnon}>
          {anon ? 'sign in (viewer)' : 'sign out (anon)'}
        </button>
        <button type="button" style={btnStyle} onClick={onFailNext}>
          fail next mutation
        </button>
        <button type="button" style={btnStyle} onClick={onReset}>
          reset
        </button>
      </div>
    </details>
  );
}

// Dev-only mock chrome — fixed colours by design (see the note at the top).
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const rootStyle: CSSProperties = { position: 'relative', minHeight: '100dvh' };
const bannerStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10000,
  background: CHROME_BG,
  color: CHROME_ACCENT,
  fontFamily: MONO,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'center',
  padding: '4px 8px',
  letterSpacing: 0.3,
  borderBottom: `1px solid ${CHROME_BORDER}`,
};
const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 28,
  left: 8,
  zIndex: 10000,
  background: CHROME_BG,
  color: CHROME_DIM,
  fontFamily: MONO,
  fontSize: 11,
  padding: '6px 10px',
  borderRadius: 10,
  border: `1px solid ${CHROME_BORDER}`,
  maxWidth: 220,
};
const summaryStyle: CSSProperties = { cursor: 'pointer', color: CHROME_ACCENT, letterSpacing: 0.3 };
const panelBodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 };
const btnStyle: CSSProperties = {
  background: CHROME_BG_RAISED,
  color: CHROME_TEXT,
  border: `1px solid ${CHROME_BORDER}`,
  borderRadius: 6,
  fontFamily: MONO,
  fontSize: 11,
  padding: '3px 6px',
  cursor: 'pointer',
  textAlign: 'left',
};
