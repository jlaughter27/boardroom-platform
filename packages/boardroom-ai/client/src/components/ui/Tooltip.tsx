import { useState, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/cn';

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), 300);
  };

  const handleLeave = () => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  };

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[var(--z-dropdown)]"
          >
            <div className="bg-foreground text-background text-xs px-2 py-1 rounded-lg shadow-md whitespace-nowrap">
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
