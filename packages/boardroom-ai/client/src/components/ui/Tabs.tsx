import { useId, useRef, useState, type ReactNode } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { motion } from 'motion/react';
import { instant, springs } from '../../lib/motion';
import { cn } from '../../lib/cn';

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  /** Controlled active tab (optional; `defaultTab` keeps working uncontrolled). */
  value?: string;
  className?: string;
  onChange?: (tabId: string) => void;
}

/**
 * Tabs on Base UI with a shared sliding indicator. Pointer changes slide the
 * indicator on `springs.snappy`; arrow-key moves (a frequent, keyboard-driven
 * action) move it instantly — no animation to wait on.
 */
export function Tabs({ tabs, defaultTab, value, className, onChange }: TabsProps) {
  const [internal, setInternal] = useState(defaultTab || tabs[0]?.id || '');
  const active = value ?? internal;
  const layoutId = useId();
  const fromKeyboard = useRef(false);

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
      <BaseTabs.List activateOnFocus className="relative flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.id}
            value={tab.id}
            className={cn(
              'relative px-3 py-2 text-sm font-medium outline-none rounded-t-md',
              'transition-colors duration-fast ease-out',
              'text-muted-foreground hover:text-foreground data-[active]:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            {tab.label}
            {active === tab.id && (
              <motion.span
                layoutId={layoutId}
                transition={fromKeyboard.current ? instant : springs.snappy}
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-capsule bg-primary"
                aria-hidden="true"
              />
            )}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {tabs.map((tab) => (
        <BaseTabs.Panel key={tab.id} value={tab.id} className="pt-4 outline-none">
          {tab.content}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
