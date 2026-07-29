import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RootBoundary } from './RootBoundary.js';

/** A child that throws on demand — the malformed-row analogue. */
function Bomb({ boom }: { boom: boolean }) {
  if (boom) throw new Error('row exploded');
  return <div data-testid="ok">rendered fine</div>;
}

describe('RootBoundary', () => {
  it('catches a child render throw and shows the recoverable fallback', () => {
    // React logs the caught error to console.error — silence it for a clean run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RootBoundary>
        <Bomb boom />
      </RootBoundary>,
    );
    expect(screen.getByTestId('root-boundary')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByTestId('root-boundary-retry')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('fires onError with the caught error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <RootBoundary onError={onError}>
        <Bomb boom />
      </RootBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0][0] as Error).message).toBe('row exploded');
    spy.mockRestore();
  });

  it('recovers: "Try again" re-mounts the subtree once the throw is resolved', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    // The boundary's own subtree can't reach the defuse button (it's unmounted
    // behind the fallback), so drive recovery through a keyed remount: click
    // Try again AFTER the child would render fine. We simulate that by rendering
    // a wrapper whose child stops throwing before the reset.
    render(<RecoverableHarness />);

    // Initially thrown → fallback.
    expect(screen.getByTestId('root-boundary')).toBeInTheDocument();

    // Flip the child to non-throwing, then reset the boundary.
    await user.click(screen.getByTestId('external-defuse'));
    await user.click(screen.getByTestId('root-boundary-retry'));

    expect(await screen.findByTestId('ok')).toBeInTheDocument();
    expect(screen.queryByTestId('root-boundary')).toBeNull();
    spy.mockRestore();
  });
});

/**
 * The defuse control lives OUTSIDE the boundary (so it survives the fallback),
 * flipping a module-external flag the child reads. Clicking Try again then
 * re-renders the child, which no longer throws.
 */
let shouldBoom = true;
function RecoverableHarness() {
  const [, force] = useState(0);
  return (
    <>
      <button
        type="button"
        data-testid="external-defuse"
        onClick={() => {
          shouldBoom = false;
          force((n) => n + 1);
        }}
      >
        defuse
      </button>
      <RootBoundary>
        <Bomb boom={shouldBoom} />
      </RootBoundary>
    </>
  );
}
