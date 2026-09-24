// Prop-vocabulary adapters over `@civitai/components-react`.
//
// The board was written against the blocks-react bridge package's `/ui` pack, whose layout
// components take NUMERIC gaps and flexbox props (`justify`, `align`, `wrap`),
// and whose `Button`/`Badge` take a `color`. The components pack expresses the
// same designs differently: gaps are three presets, layout is left to CSS, and
// `data-color` exists only for the intent components.
//
// 🔴 THESE WRAPPERS EXIST SO THE DIFFERENCE LIVES IN ONE PLACE. The alternative
// was rewriting ~40 JSX sites across a 1,300-line file, which would have made
// the port a visual redesign as well as a transport change — two risks in one
// diff, with no way to tell which one broke a screenshot. Here the board's JSX
// is untouched and every mapping is stated once, checkably.
//
// The numeric gaps are passed through as EXACT PIXELS rather than bucketed into
// the pack's `'sm' | 'md' | 'lg'` presets. Bucketing seven distinct spacings
// (6, 8, 10, 12, 14, 16, 18) into three would silently redesign the board;
// `style.gap` reproduces it exactly. Presets remain the right choice for NEW
// code — this is a compatibility layer, not a recommendation.

import { forwardRef, useEffect, useId, useRef, type ReactNode } from 'react';
import {
  Badge as PackBadge,
  Button as PackButton,
  Group as PackGroup,
  SegmentedControl as PackSegmentedControl,
  Stack as PackStack,
  type BadgeProps as PackBadgeProps,
  type ButtonProps as PackButtonProps,
  type GroupProps as PackGroupProps,
  type SegmentedControlProps as PackSegmentedControlProps,
  type StackProps as PackStackProps,
} from '@civitai/components-react';

type Justify = React.CSSProperties['justifyContent'];
type Align = React.CSSProperties['alignItems'];

/** Vertical flex layout, accepting a pixel gap. */
export interface StackProps extends Omit<PackStackProps, 'gap'> {
  gap?: number;
  justify?: Justify;
  align?: Align;
}

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap, justify, align, style, ...rest },
  ref,
) {
  return (
    <PackStack
      ref={ref}
      style={{
        ...(gap != null ? { gap } : {}),
        ...(justify ? { justifyContent: justify } : {}),
        ...(align ? { alignItems: align } : {}),
        ...style,
      }}
      {...rest}
    />
  );
});

/** Horizontal flex layout, accepting a pixel gap plus the flexbox props. */
export interface GroupProps extends Omit<PackGroupProps, 'gap'> {
  gap?: number;
  justify?: Justify;
  align?: Align;
  /** `true` lets items wrap onto another line; `false` pins them to one. */
  wrap?: boolean;
}

export const Group = forwardRef<HTMLDivElement, GroupProps>(function Group(
  { gap, justify, align, wrap, style, ...rest },
  ref,
) {
  return (
    <PackGroup
      ref={ref}
      style={{
        ...(gap != null ? { gap } : {}),
        ...(justify ? { justifyContent: justify } : {}),
        ...(align ? { alignItems: align } : {}),
        ...(wrap != null ? { flexWrap: wrap ? 'wrap' : 'nowrap' } : {}),
        ...style,
      }}
      {...rest}
    />
  );
});

/**
 * Button colours.
 *
 * `'primary'` is the pack's DEFAULT appearance, so it maps to omitting the prop
 * — same pixels, one fewer attribute.
 *
 * `'error'` has no equivalent: the pack's CSS reads `data-color` for Alert and
 * Badge only, never for Button, so a destructive button would silently render
 * as an ordinary one. Losing the destructive affordance on a "withdraw" or
 * "remove" confirm is a real UX regression, so it is re-applied here.
 *
 * 🔴 THE THEME DEFINES EXACTLY ONE ERROR TOKEN — `--civitai-color-error`. There
 * is no `on-error` foreground to pair with a filled error background, so the
 * destructive treatment is drawn as error-coloured TEXT AND BORDER on the
 * button's own surface rather than as a filled block. That keeps the contrast
 * legible on both themes without inventing a colour: an earlier pass used a
 * `#fff` fallback and `theme.test.tsx`'s "no hex in inline styles" guard caught
 * it, which is exactly what that guard is for.
 */
export type ButtonColor = 'primary' | 'error';

export interface ButtonProps extends PackButtonProps {
  color?: ButtonColor;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { color, variant, style, ...rest },
  ref,
) {
  const destructive = color === 'error';
  return (
    <PackButton
      ref={ref}
      variant={variant}
      data-color={color}
      style={
        destructive
          ? {
              background: 'transparent',
              color: 'var(--civitai-color-error)',
              borderColor: 'var(--civitai-color-error)',
              ...style,
            }
          : style
      }
      {...rest}
    />
  );
});

/**
 * Badge colours.
 *
 * The pack's own docs say an absent `data-color` renders the default primary
 * accent, so `'primary'` maps to omitting it — identical output.
 */
export interface BadgeProps extends Omit<PackBadgeProps, 'color'> {
  color?: 'primary' | PackBadgeProps['color'];
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ color, ...rest }, ref) {
  return <PackBadge ref={ref} {...(color && color !== 'primary' ? { color } : {})} {...rest} />;
});

/**
 * Segmented control.
 *
 * Most of the pack's props already match the board's (`data`, `value`,
 * `onChange`, `size`, `aria-label`). Two things are mapped:
 *
 * `fullWidth` has no equivalent, so it is applied as a style rather than
 * dropped — the sort switcher stretches across the toolbar's second row on
 * narrow layouts, a decision `src/layout.ts` makes and this must not ignore.
 *
 * 🔴 THE SORT SWITCHER IS A `radiogroup`, NOT A `tablist`, AND THAT IS A
 * DELIBERATE CHANGE FROM WHAT THIS APP SHIPPED BEFORE. The previous pack
 * rendered `role="tablist"` with `role="tab"` segments. That is the wrong
 * pattern here: a tab controls a PANEL via `aria-controls`, and this control
 * has no panels — it picks a value and the one list below it re-sorts. A
 * screen-reader user was being promised a tabbed interface that does not exist.
 *
 * The components pack's default `mode="toggle"` is the WAI-ARIA radio-group
 * pattern (`role="radiogroup"` + `aria-checked` segments), which is what a
 * panel-less value switch should be, and the pack's own docs say so. Adopting
 * the default is therefore the fix, not the compatibility risk — so `mode` is
 * simply passed through and the pack decides.
 *
 * Operator decision 2026-09-23, made with the alternative (pin `tabs`, keep the
 * old semantics, revisit later) on the table.
 */
export interface SegmentedControlProps extends PackSegmentedControlProps {
  fullWidth?: boolean;
}

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl({ fullWidth, style, ...rest }, ref) {
    return (
      <PackSegmentedControl
        ref={ref}
        style={{ ...(fullWidth ? { display: 'flex', width: '100%' } : {}), ...style }}
        {...rest}
      />
    );
  },
);

/**
 * Modal.
 *
 * 🔴 WRITTEN OUT RATHER THAN WRAPPED, AND THE REASON IS BEHAVIOURAL. The
 * components pack ships a modal only as a Lit custom element
 * (`<civitai-modal>`). Bound through `@lit/react` it renders, but under jsdom
 * the element is never upgraded, so it does two things a modal must not: it
 * leaves its children in the document WHILE CLOSED, and it exposes no
 * `role="dialog"`. The board's suites caught both — a closed composer's inputs
 * were still findable, and every confirm dialog assertion failed to find a
 * dialog. Those are not test artefacts: "content is present while closed" is a
 * real defect for a modal holding a composer.
 *
 * So this keeps the contract the board was written against and the one the
 * previous pack provided: nothing rendered while closed, `role="dialog"` +
 * `aria-modal`, a labelled heading, Escape and backdrop-click to close, and
 * focus restored to whatever was focused before it opened.
 */
export type ModalSize = 'sm' | 'md' | 'lg';

const MODAL_WIDTH: Record<ModalSize, number> = { sm: 380, md: 560, lg: 780 };

export interface ModalProps {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  children?: ReactNode;
}

export function Modal({
  opened,
  onClose,
  title,
  size = 'md',
  children,
}: ModalProps): React.JSX.Element | null {
  const headingId = useId();
  const restoreTo = useRef<Element | null>(null);

  // Remember the pre-open focus so it can be restored — a viewer who opened the
  // composer from the toolbar should land back on the toolbar, not at the top
  // of the document.
  useEffect(() => {
    if (!opened) return;
    restoreTo.current = document.activeElement;
    return () => {
      const el = restoreTo.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Deliberately NOT stopPropagation: swallowing Escape breaks the case
      // where the host page or a second layer also listens for it.
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [opened, onClose]);

  if (!opened) return null;

  return (
    <div style={modalBackdropStyle} onMouseDown={onClose} data-civitai-ui="modal-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        {...(typeof title === 'string' ? { 'aria-labelledby': headingId } : {})}
        style={{ ...modalStyle, maxWidth: MODAL_WIDTH[size] }}
        // The backdrop closes on mousedown; the panel must not inherit that.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title != null &&
          (typeof title === 'string' ? (
            <h2 id={headingId} style={modalTitleStyle}>
              {title}
            </h2>
          ) : (
            title
          ))}
        {children}
      </div>
    </div>
  );
}

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'var(--civitai-color-overlay, rgba(0, 0, 0, 0.6))',
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: 20,
  borderRadius: 12,
  background: 'var(--civitai-color-surface-1)',
  color: 'var(--civitai-color-text)',
  border: '1px solid var(--civitai-color-border)',
};

const modalTitleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 16,
  fontWeight: 700,
};
