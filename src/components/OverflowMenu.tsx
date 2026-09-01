// A three-dots overflow menu with real menu semantics.
//
// a11y contract, all of it asserted in OverflowMenu.test.tsx:
//   * trigger is a <button> with `aria-haspopup="menu"` and `aria-expanded`
//     that actually tracks open/closed;
//   * the popup is `role="menu"`, labelled by the trigger;
//   * items are `role="menuitem"` in a ROVING TAB INDEX — exactly one item is
//     tabbable at a time, ArrowDown/ArrowUp wrap, Home/End jump;
//   * Escape closes AND returns focus to the trigger;
//   * choosing an item closes AND returns focus to the trigger;
//   * Tab out closes.
//
// 🔴 LAYOUT DECISION — the menu is IN FLOW, not an absolutely-positioned
// popover. This block is an iframe with a declared height contract: the host
// resizes it from a ResizeObserver on the block root, and an absolutely
// positioned panel contributes NOTHING to the root's measured height. A popover
// hanging off the last card would therefore be CLIPPED by the iframe, and the
// symptom would look like a CSS overflow bug rather than the height-contract
// violation it is. Opening this menu grows the card, which grows the root, which
// fires the observer, which grows the iframe. Do not "fix" it into a popover.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useReducedMotion, entryMotionProps, transitionFor } from '../motion.js';
import { focusRing, metaText, radius, token } from '../theme.js';

export interface OverflowMenuItem {
  id: string;
  label: string;
  /** Rendered before the label; decorative. */
  icon?: string;
  /** Destructive items are tinted and read out with their meaning in the label, not by colour alone. */
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  'data-testid'?: string;
}

export interface OverflowMenuProps {
  /** Accessible name for the trigger, e.g. `More actions for "Dark mode"`. */
  label: string;
  items: OverflowMenuItem[];
  'data-testid'?: string;
  /** Notified whenever the menu opens or closes (the board uses it for analytics). */
  onOpenChange?: (open: boolean) => void;
}

export function OverflowMenu({
  label,
  items,
  'data-testid': testId = 'row-menu',
  onOpenChange,
}: OverflowMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const triggerId = useId();
  const reduced = useReducedMotion();
  const entry = entryMotionProps('ar-menu-in', 'panel', reduced);
  const hoverTransition = transitionFor(['background-color', 'color'], 'control', reduced);

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen((wasOpen) => {
        if (wasOpen) onOpenChange?.(false);
        return false;
      });
      if (restoreFocus) triggerRef.current?.focus();
    },
    [onOpenChange],
  );

  // Move DOM focus onto the active item whenever the menu is open. This is the
  // roving part: the item that holds tabIndex={0} is also the focused one.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  // A click anywhere outside dismisses. Focus is NOT restored here — the viewer
  // deliberately moved somewhere else, and yanking focus back would be hostile.
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const root = triggerRef.current?.parentElement;
      if (root && e.target instanceof Node && !root.contains(e.target)) close(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open, close]);

  function openMenu(startIndex: number) {
    itemRefs.current = [];
    setActiveIndex(startIndex);
    setOpen(true);
    onOpenChange?.(true);
  }

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(items.length - 1);
    }
  }

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % items.length);
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % items.length);
        return;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        e.preventDefault();
        setActiveIndex(items.length - 1);
        return;
      case 'Tab':
        // Let focus leave naturally, but don't leave an orphaned open menu behind.
        close(false);
        return;
      default:
        return;
    }
  }

  function choose(item: OverflowMenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        data-testid={`${testId}-btn`}
        onClick={() => (open ? close(false) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
        style={triggerStyle}
      >
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1, letterSpacing: 1 }}>
          ⋯
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          data-testid={testId}
          data-motion={entry['data-motion']}
          onKeyDown={onMenuKeyDown}
          style={{ ...menuStyle, animation: entry.animation }}
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              // Roving tab index: exactly one item is in the tab order.
              tabIndex={i === activeIndex ? 0 : -1}
              disabled={item.disabled}
              data-testid={item['data-testid'] ?? `${testId}-item-${item.id}`}
              data-active={i === activeIndex ? 'true' : 'false'}
              data-motion={entry['data-motion']}
              onClick={() => choose(item)}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                ...itemStyle,
                color: item.destructive ? token.error : token.text,
                opacity: item.disabled ? 0.5 : 1,
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                background: i === activeIndex ? token.brandSoft : 'transparent',
                transition: hoverTransition,
              }}
            >
              {item.icon && (
                <span aria-hidden="true" style={{ width: 16, textAlign: 'center' }}>
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const triggerStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  padding: 0,
  borderRadius: radius.sm,
  border: `1px solid transparent`,
  background: 'transparent',
  color: token.dimmed,
  cursor: 'pointer',
  font: 'inherit',
};

const menuStyle: CSSProperties = {
  // In flow — see the header note. `marginTop` gives it breathing room from the
  // meta row it grew out of.
  marginTop: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 4,
  borderRadius: radius.md,
  border: `1px solid ${token.border}`,
  background: token.surface2,
  boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
};

const itemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: radius.sm,
  border: '1px solid transparent',
  textAlign: 'left',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.3,
};

/** Exported so the board can render a matching hint under a disabled item. */
export const menuHintStyle: CSSProperties = { ...metaText, padding: '0 10px 6px' };

/** Exported for tests + reuse: the ring every hand-composed control in this app uses. */
export const menuFocusRing = focusRing;
