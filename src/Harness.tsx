import { useState, type CSSProperties, type ReactNode } from 'react';

import {
  Harness as SdkHarness,
  type MockHostOptions,
  type MockSharedSeed,
} from '@civitai/blocks-react/testing';

// A seeded, cross-user board so the local harness looks like a live one. Author
// ids other than the viewer (7777) exercise the "user #N" label; the viewer's
// own seed (author 7777) exercises the withdraw affordance; `voters` seeds the
// vote counts + the one-vote-per-user set.
const SHARED_SEED: MockSharedSeed[] = [
  {
    value: { title: 'A prompt-library app with tags & sharing', body: 'Save prompts, tag them, share collections with the community.' },
    authorUserId: 4021,
    voters: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  {
    value: { title: 'Batch upscaler that queues overnight' },
    authorUserId: 5099,
    voters: [1, 2, 3, 4, 5, 6, 7],
  },
  {
    value: { title: 'A LoRA training cost estimator', body: 'Estimate Buzz before you commit a training run.' },
    authorUserId: 7777,
    voters: [1, 2, 3],
  },
  {
    value: { title: 'Dark-mode-aware model cards on profiles' },
    authorUserId: 3140,
    voters: [1],
  },
];

/**
 * Local dev mock host for the App Requests PAGE app. The real platform mounts
 * the block in a full-bleed iframe and answers the `SHARED_*` + `APP_STORAGE_*`
 * postMessage protocol from the shared/per-user datastores. Locally there's no
 * host, so the published SDK's `createMockHost` plays one — seeded with a small
 * board so the app is immediately usable. A loud banner + a tiny scenario panel
 * make it obvious this is synthetic (no real data written).
 */
export function Harness({ children }: { children: ReactNode }) {
  // `viewer: undefined` → the SDK's default dev-viewer (id set by the mock host).
  // We pin the viewer id to 7777 so the seeded "own" entry shows the withdraw
  // affordance. `null` exercises the anonymous read-only path.
  const [anon, setAnon] = useState(false);
  const [failNext, setFailNext] = useState(0);
  const [key, setKey] = useState(0);

  const options: MockHostOptions = {
    viewer: anon ? null : { id: 7777, username: 'dev-viewer' },
    shared: { seed: SHARED_SEED, failNext: failNext || undefined },
    theme: 'dark',
  };

  return (
    <div style={rootStyle}>
      <div data-harness-banner="mock" style={bannerStyle}>
        MOCK HOST · shared store is in-memory · nothing is written to Civitai
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
      {/* applyUrlToggles kept on so ?viewer=anon etc. still work; the panel
          re-mounts via `key` when it changes an init-only field (viewer). */}
      <SdkHarness key={key} showLog={false} {...options}>
        {children}
      </SdkHarness>
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

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const TERMINAL_BG = '#0d1117';
const TERMINAL_BORDER = '#30363d';
const TERMINAL_TEXT = '#c9d1d9';
const TERMINAL_ACCENT = '#3fb950';

const rootStyle: CSSProperties = { position: 'relative', minHeight: '100dvh' };
const bannerStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10000,
  background: TERMINAL_BG,
  color: TERMINAL_ACCENT,
  fontFamily: MONO,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'center',
  padding: '4px 8px',
  letterSpacing: 0.3,
  borderBottom: `1px solid ${TERMINAL_BORDER}`,
};
const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 28,
  left: 8,
  zIndex: 10000,
  background: TERMINAL_BG,
  color: TERMINAL_TEXT,
  fontFamily: MONO,
  fontSize: 11,
  padding: '6px 10px',
  borderRadius: 6,
  border: `1px solid ${TERMINAL_BORDER}`,
  maxWidth: 220,
};
const summaryStyle: CSSProperties = { cursor: 'pointer', color: TERMINAL_ACCENT, letterSpacing: 0.3 };
const panelBodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 };
const btnStyle: CSSProperties = {
  background: '#161b22',
  color: TERMINAL_TEXT,
  border: `1px solid ${TERMINAL_BORDER}`,
  borderRadius: 4,
  fontFamily: MONO,
  fontSize: 11,
  padding: '3px 6px',
  cursor: 'pointer',
  textAlign: 'left',
};
