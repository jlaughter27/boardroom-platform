import { useId, useRef, useState, type ReactNode } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { motion } from 'motion/react';
import { instant, springs } from '../../lib/motion';
import { cn } from '../../lib/cn';

interface Tab {
  id: string;
  label: string;
  /** 16 px Lucide glyph shown before the label (segmented variant). */
  icon?: ReactNode;
  /** Panel content. Optional: a segmented control that only reports a value renders no panels. */
  content?: ReactNode;
  /** Tooltip / long description on the tab itself. */
  title?: string;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  /** Controlled active tab (optional; `defaultTab` keeps working uncontrolled). */
  value?: string;
  className?: string;
  onChange?: (tabId: string) => void;
  /**
   * `underline` (default): text tabs over a hairline with a sliding 2 px bar.
   * `segmented`: a capsule segmented control — the active segment is a raised
   * pill that slides between labels.
   */
  variant?: 'underline' | 'segmented';
  /** Segmented only: stretch the segments to fill the row. */
  fullWidth?: boolean;
  'aria-label'?: string;
}

/**
 * Tabs on Base UI with a shared sliding indicator. Pointer changes slide the
 * indicator on `springs.snappy`; arrow-key moves (a frequent, keyboard-driven
 * action) move it instantly — no animation to wait on.
 */
export function Tabs({ tabs, defaultTab, value, className, onChange, variant = 'underline', fullWidth = false, 'aria-label': ariaLabel }: TabsProps) {
  const [internal, setInternal] = useState(defaultTab || tabs[0]?.id || '');
  const active = value ?? internal;
  const layoutId = useId();
  const fromKeyboard = useRef(false);
  const segmented = variant === 'segmented';
  const hasPanels = tabs.some((t) => t.content !== undefined);

  return (
    <BaseTabs.Root
      value={active}
      onValueChange={(next, details) => {
        fromKeyboard.current = 'key' in details.event;
        const id = String(next);
        setInternal(id);
        onChange?.(id);
      }}
      className={cn('', className)}
    >
      <BaseTabs.List
        activateOnFocus
        aria-label={ariaLabel}
        className={cn(
          'relative flex',
          segmented
            ? 'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-capsule bg-muted p-1 shadow-[inset_0_1px_1px_hsl(var(--shadow-color)/0.06)] ring-1 ring-inset ring-hairline scrollbar-thin'
            : 'gap-1 border-b border-border',
          segmented && fullWidth && 'flex w-full',
        )}
      >
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.id}
            value={tab.id}
            title={tab.title}
            className={cn(
              'relative outline-none transition-colors duration-fast ease-out',
              'text-muted-foreground hover:text-foreground data-[active]:text-foreground',
              segmented
                ? 'flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-capsule px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring'
                : 'px-3 py-2 text-sm font-medium rounded-t-md focus-visible:ring-2 focus-visible:ring-ring',
              segmented && fullWidth && 'flex-1',
            )}
          >
            {active === tab.id && (
              <motion.span
                layoutId={layoutId}
                transition={fromKeyboard.current ? instant : springs.snappy}
                className={cn(
                  segmented
                    // The raised pill: card surface, hairline ring, one shadow step — never a colour fill.
                    ? 'absolute inset-0 rounded-capsule bg-card shadow-sm ring-1 ring-hairline'
                    : 'absolute inset-x-0 -bottom-px h-0.5 rounded-capsule bg-primary',
                )}
                aria-hidden="true"
              />
            )}
            {segmented ? (
              <span className="relative flex items-center gap-1.5">
                {tab.icon && <span className="flex shrink-0 translate-y-[0.5px] text-current opacity-80 [[data-active]_&]:opacity-100" aria-hidden="true">{tab.icon}</span>}
                <span>{tab.label}</span>
              </span>
            ) : (
              tab.label
            )}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {hasPanels && tabs.map((tab) => (
        <BaseTabs.Panel key={tab.id} value={tab.id} className="pt-4 outline-none">
          {tab.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
