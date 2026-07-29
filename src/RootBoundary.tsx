import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Recoverable root error boundary for the App Requests block.
 *
 * The block mounts inside an opaque-origin iframe: an uncaught render throw
 * (e.g. a malformed shared row that trips {@link RequestRow}) would otherwise
 * white-screen the whole iframe with no way back. This boundary catches the
 * throw, renders a self-contained "something went wrong" card with a
 * **Try again** button that RESETS the boundary (re-mounts the subtree), and
 * fires an `onError` callback so the failure is analytics-visible.
 *
 * It is intentionally styling-independent of the `/ui` pack's `injectBlocksStyles`
 * (which may not have run, or may itself be implicated): the fallback uses inline
 * styles with hard fallbacks on top of the design-system tokens so it renders
 * legibly no matter what broke.
 *
 * Must be a class component — React error boundaries have no hook equivalent.
 */
export interface RootBoundaryProps {
  children: ReactNode;
  /**
   * Invoked once per caught error with the error and React's component stack.
   * Fire-and-forget analytics; the boundary never awaits or depends on it.
   */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Test seam: override the fallback UI. */
  fallback?: (reset: () => void, error: Error) => ReactNode;
}

interface RootBoundaryState {
  error: Error | null;
}

export class RootBoundary extends Component<RootBoundaryProps, RootBoundaryState> {
  state: RootBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info);
    } catch {
      /* analytics must never mask the original error */
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error == null) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, error);
    return (
      <div role="alert" style={wrapStyle} data-testid="root-boundary">
        <div style={cardStyle}>
          <span style={{ fontSize: 30 }} aria-hidden>
            ⚠️
          </span>
          <strong style={titleStyle}>Something went wrong</strong>
          <span style={bodyStyle}>
            The requests board hit an unexpected error. Your data is safe — try again.
          </span>
          <button type="button" onClick={this.reset} style={buttonStyle} data-testid="root-boundary-retry">
            Try again
          </button>
        </div>
      </div>
    );
  }
}

const wrapStyle: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
  background: 'var(--civitai-color-surface-2, transparent)',
  color: 'var(--civitai-color-text, inherit)',
};
const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  textAlign: 'center',
  maxWidth: 420,
  padding: 24,
  borderRadius: 10,
  border: '1px solid var(--civitai-color-border, rgba(128,128,128,0.25))',
  background: 'var(--civitai-color-surface, transparent)',
};
const titleStyle: React.CSSProperties = { fontSize: 16 };
const bodyStyle: React.CSSProperties = {
  color: 'var(--civitai-color-text-dimmed, #868e96)',
  lineHeight: 1.5,
};
const buttonStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '8px 16px',
  borderRadius: 8,
  cursor: 'pointer',
  border: '1px solid var(--civitai-color-primary, #1971c2)',
  background: 'var(--civitai-color-primary, #1971c2)',
  color: 'var(--civitai-color-primary-fg, #fff)',
  font: 'inherit',
  fontWeight: 600,
};
