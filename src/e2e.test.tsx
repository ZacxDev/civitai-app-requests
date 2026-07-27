// End-to-end: drive the REAL <App/> against the published SDK mock host
// (`createMockHost` via `<Harness>`), exercising the actual `SHARED_*` +
// `APP_STORAGE_*` postMessage round-trips (no hook mocking). Proves the app
// integrates with the real transport + shared-store contract, not just our
// fakes.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Harness, type MockSharedSeed } from '@civitai/blocks-react/testing';

import { App } from './App.js';

const VIEWER = { id: 7777, username: 'dev-viewer' };

const SEED: MockSharedSeed[] = [
  { value: { title: 'Prompt library app' }, authorUserId: 4021, voters: [1, 2, 3] },
  { value: { title: 'My own idea' }, authorUserId: 7777, voters: [1] },
];

function renderApp(extra?: { viewer?: typeof VIEWER | null; seed?: MockSharedSeed[] }) {
  return render(
    <Harness
      applyUrlToggles={false}
      showLog={false}
      theme="dark"
      viewer={extra?.viewer === undefined ? VIEWER : extra.viewer}
      shared={{ seed: extra?.seed ?? SEED }}
    >
      <App />
    </Harness>,
  );
}

describe('e2e against the SDK mock host', () => {
  it('lists the seeded shared entries through the real transport', async () => {
    renderApp();
    expect(await screen.findByText('Prompt library app', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('My own idea')).toBeInTheDocument();
    // Seed voters=[1,2,3] -> count 3.
    const rows = screen.getAllByTestId('request-row');
    const promptRow = rows.find((r) => within(r).queryByText('Prompt library app'))!;
    expect(within(promptRow).getByTestId('vote-count')).toHaveTextContent('3');
  });

  it('casts a real vote and the count increments', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Prompt library app', {}, { timeout: 5000 });

    const rows = screen.getAllByTestId('request-row');
    const promptRow = rows.find((r) => within(r).queryByText('Prompt library app'))!;
    await user.click(within(promptRow).getByTestId('vote-btn'));

    await waitFor(() =>
      expect(within(promptRow).getByTestId('vote-count')).toHaveTextContent('4'),
    );
    expect(within(promptRow).getByTestId('vote-btn')).toHaveAttribute('aria-pressed', 'true');
  });

  it('appends a new request through the host and shows it on refresh', async () => {
    const user = userEvent.setup();
    renderApp({ seed: [] });
    // Empty board first.
    await screen.findByText('No requests yet', {}, { timeout: 5000 });

    await user.type(screen.getByTestId('title-input'), 'Brand new idea');
    await user.click(screen.getByTestId('submit-btn'));

    expect(await screen.findByText('Brand new idea', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
