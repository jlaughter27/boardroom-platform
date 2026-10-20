import type { ReactElement, ReactNode } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { cn } from '../../lib/cn';
import { POPUP_MOTION, POPUP_SURFACE } from './popup-motion';

export interface MenuItemDef {
  id: string;
  label: ReactNode;
  /** 16 px Lucide icon, rendered at the start of the row. */
  icon?: ReactNode;
  /** Right-aligned hint, e.g. "⌘K". */
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface MenuSeparatorDef {
  type: 'separator';
}

export type MenuEntry = MenuItemDef | MenuSeparatorDef;

interface MenuProps {
  /** The element that opens the menu; it receives the trigger props and ref (e.g. a `<Button>`). */
  trigger: ReactElement;
  items: MenuEntry[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

const isSeparator = (entry: MenuEntry): entry is MenuSeparatorDef => 'type' in entry && entry.type === 'separator';

/**
 * Action menu on Base UI: typeahead, arrow keys, loop focus, origin-aware
 * 140 ms open. Highlight moves with no transition so keyboard navigation
 * never waits on an animation.
 */
export function Menu({ trigger, items, side = 'bottom', align = 'start', className }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={6} className="z-dropdown">
          <BaseMenu.Popup className={cn(POPUP_MOTION, POPUP_SURFACE, 'min-w-44 p-1', className)}>
            <BaseMenu.List>
              {items.map((entry, index) =>
                isSeparator(entry) ? (
                  <BaseMenu.Separator key={`sep-${index}`} className="my-1 h-px bg-border" />
                ) : (
                  <BaseMenu.Item
                    key={entry.id}
                    disabled={entry.disabled}
                    onClick={entry.onSelect}
                    className={cn(
                      'flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none',
                      'data-[highlighted]:bg-muted data-[disabled]:opacity-50',
                      entry.destructive ? 'text-danger' : 'text-foreground'
                    )}
                  >
                    {entry.icon && <span className="flex shrink-0 text-muted-foreground [&>svg]:size-4" aria-hidden="true">{entry.icon}</span>}
                    <span className="flex-1 truncate">{entry.label}</span>
                    {entry.shortcut && <kbd className="ml-4 font-mono text-[11px] text-muted-foreground">{entry.shortcut}</kbd>}
                  </BaseMenu.Item>
                )
              )}
            </BaseMenu.List>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
