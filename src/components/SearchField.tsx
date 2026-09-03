// The board's search field.
//
// Hand-composed rather than the pack's <TextInput> because it carries two things
// the pack input does not: a clear button inside the field, and the app-owned
// focus ring the skin depth requires.
//
// 🔴 It is a FILTER OVER LOADED ROWS. The caller is responsible for rendering
// the horizon disclosure whenever a query is active — see `<HorizonNote>` in
// App.tsx. A search box that quietly misses a row reads as "that request does
// not exist", which is a lie the board cannot afford.

import { useId, useState } from 'react';
import type { CSSProperties } from 'react';

import { useReducedMotion, transitionFor } from '../motion.js';
import { radius, token } from '../theme.js';

export interface SearchFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Announced count of matches, e.g. "3 of 12 requests". Rendered in a live region. */
  resultSummary?: string;
  placeholder?: string;
  /**
   * The flow of the toolbar this field sits in.
   *
   * 🔴 A FLEX BASIS IS AXIS-RELATIVE, AND THAT IS WHY THIS PROP EXISTS. In a
   * `row` toolbar `flex: 1 1 220px` means "at least 220px WIDE, then grow" —
   * which is what it was written for. When the toolbar flips to `column` the
   * main axis becomes vertical and the identical declaration means "220px
   * TALL", with `flex-grow: 1` holding it there. Measured in a real Chromium at
   * 375px: the wrapper laid out at **220px around 53px of content**, ~167px of
   * dead space between the field and the sort switcher — while every
   * attribute-level assertion stayed green, because the layout DECISION was
   * right and only the SIZING was wrong. jsdom has no layout engine, so the
   * suite could not see it.
   *
   * `stacked` therefore drops to a content-sized basis; the toolbar's own
   * `align-items: stretch` supplies the full width.
   *
   * Defaults to `row` — the 0.3.x behaviour, unchanged.
   */
  toolbar?: 'row' | 'stacked';
  'data-testid'?: string;
}

export function SearchField({
  value,
  onChange,
  resultSummary,
  placeholder = 'Search requests…',
  toolbar = 'row',
  'data-testid': testId = 'search',
}: SearchFieldProps): React.JSX.Element {
  const inputId = useId();
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div style={toolbar === 'stacked' ? stackedWrapStyle : rowWrapStyle}>
      <label htmlFor={inputId} style={srOnly}>
        Search requests
      </label>
      <div
        style={{
          ...fieldStyle,
          borderColor: focused ? token.brandEdge : token.border,
          boxShadow: focused ? `0 0 0 3px ${token.brandSoft}` : 'none',
          transition: transitionFor(['border-color', 'box-shadow'], 'control', reduced),
        }}
        data-focused={focused ? 'true' : 'false'}
      >
        <span aria-hidden="true" style={{ color: token.dimmed, fontSize: 13 }}>
          ⌕
        </span>
        <input
          id={inputId}
          type="search"
          value={value}
          placeholder={placeholder}
          data-testid={`${testId}-input`}
          onChange={(e) => onChange(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={inputStyle}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            data-testid={`${testId}-clear`}
            style={clearStyle}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
      {/*
        The match count is announced, not just drawn — a filter that silently
        empties a list is disorienting for a screen-reader user. `polite` so it
        never interrupts, and it is the same string sighted viewers read.
      */}
      <div role="status" aria-live="polite" data-testid={`${testId}-summary`} style={summaryStyle}>
        {resultSummary ?? ''}
      </div>
    </div>
  );
}

// The two wrappers, and the ONLY difference between them is which axis the
// basis lands on. `minWidth: 0` is kept in both — in a row it is what lets the
// field actually shrink below its content; in a column it is inert but harmless,
// and dropping it would make the two look more different than they are.
const rowWrapStyle: CSSProperties = { flex: '1 1 220px', minWidth: 0 };
// 🔴 `flex-basis: auto` — a LENGTH here is a height. See the `toolbar` prop.
const stackedWrapStyle: CSSProperties = { flex: '0 0 auto', minWidth: 0 };

const fieldStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 10px',
  borderRadius: radius.md,
  border: `1px solid ${token.border}`,
  background: token.surface,
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: token.text,
  font: 'inherit',
  fontSize: 13,
  padding: 0,
};

const clearStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: radius.pill,
  background: 'transparent',
  color: token.dimmed,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 11,
};

const summaryStyle: CSSProperties = {
  color: token.dimmed,
  fontSize: 12,
  lineHeight: 1.4,
  minHeight: 17,
  marginTop: 4,
};

const srOnly: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
