// The overflow menu's a11y contract, asserted BEHAVIOURALLY.
//
// Every item here is something a keyboard-only or screen-reader viewer relies
// on. Checking that an attribute merely EXISTS would be a spelled guard — these
// drive the component and read what it actually did.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OverflowMenu, type OverflowMenuItem } from './OverflowMenu.js';

function items(overrides: Partial<OverflowMenuItem>[] = []): OverflowMenuItem[] {
  const base: OverflowMenuItem[] = [
    { id: 'edit', label: 'Edit request', onSelect: vi.fn() },
    { id: 'report', label: 'Report to moderators', onSelect: vi.fn() },
    { id: 'withdraw', label: 'Withdraw request', destructive: true, onSelect: vi.fn() },
  ];
  return base.map((b, i) => ({ ...b, ...(overrides[i] ?? {}) }));
}

function setup(list = items()) {
  const user = userEvent.setup();
  render(<OverflowMenu label="More actions for “A request”" items={list} />);
  return { user, list, trigger: screen.getByTestId('row-menu-btn') };
}

describe('trigger semantics', () => {
  it('is a button that announces it opens a menu, and its state', async () => {
    const { user, trigger } = setup();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAccessibleName('More actions for “A request”');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('points aria-controls at the menu it opened', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(menu).toHaveAttribute('aria-labelledby', trigger.id);
  });

  it('renders no menu until asked', () => {
    setup();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('menu semantics', () => {
  it('exposes role=menu with one menuitem per action', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
  });

  it('labels destructive actions in WORDS, not colour alone', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: /Withdraw request/ })).toBeInTheDocument();
  });
});

describe('roving focus', () => {
  it('focuses the first item on open and makes exactly ONE item tabbable', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems[0]).toHaveFocus();
    expect(menuItems.filter((i) => i.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(menuItems[0]).toHaveAttribute('tabindex', '0');
    expect(menuItems[1]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown moves focus and WRAPS at the end', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[2]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('ArrowUp moves focus and WRAPS at the start', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('menuitem')[2]).toHaveFocus();
  });

  it('Home and End jump to the ends', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);

    await user.keyboard('{End}');
    expect(screen.getAllByRole('menuitem')[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('ArrowDown on the CLOSED trigger opens it at the first item', async () => {
    const { trigger } = setup();
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('ArrowUp on the CLOSED trigger opens it at the LAST item', async () => {
    const { trigger } = setup();
    trigger.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('menuitem')[2]).toHaveFocus();
  });
});

describe('dismissal', () => {
  it('🔴 Escape closes AND returns focus to the trigger', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('🔴 choosing an item closes AND returns focus to the trigger', async () => {
    const list = items();
    const { user, trigger } = setup(list);
    await user.click(trigger);

    await user.click(screen.getByRole('menuitem', { name: /Edit request/ }));

    expect(list[0].onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('activating an item with the keyboard works the same way', async () => {
    const list = items();
    const { user, trigger } = setup(list);
    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(list[1].onSelect).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it('Tab leaves without stranding an open menu behind', async () => {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a click outside dismisses WITHOUT stealing focus back', async () => {
    const { user, trigger } = setup();
    render(<button type="button">elsewhere</button>);
    await user.click(trigger);

    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    expect(screen.queryByRole('menu')).toBeNull();
    // The viewer deliberately moved somewhere else; yanking focus back is hostile.
    expect(trigger).not.toHaveFocus();
  });
});

describe('disabled items', () => {
  it('does not fire a disabled action', async () => {
    const list = items([{}, { disabled: true }]);
    const { user, trigger } = setup(list);
    await user.click(trigger);

    await user.click(screen.getByRole('menuitem', { name: /Report to moderators/ }));

    expect(list[1].onSelect).not.toHaveBeenCalled();
    // Still open — nothing happened, so nothing closed.
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('layout contract', () => {
  it('🔴 renders IN FLOW so the iframe grows instead of clipping the menu', async () => {
    // This block declares a height contract and the host resizes it from a
    // ResizeObserver on the root. An absolutely positioned popover contributes
    // nothing to the measured height and would be CLIPPED at the bottom of the
    // last card. Keep it in flow.
    const { user, trigger } = setup();
    await user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu.style.position).not.toBe('absolute');
    expect(menu.style.position).not.toBe('fixed');
  });
});
