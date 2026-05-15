import { useId, useState, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/cn';

interface TooltipProps {
  /**
   * Tooltip body. String = single-line nowrap (legacy). ReactNode = rich,
   * wrapping content (max-w-xs).
   */
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** Delay before showing in ms. Defaults to 300. */
  delay?: number;
  /**
   * Override max-width when content is rich. Default 16rem (w-64).
   * Pass `null` to disable wrapping.
   */
  maxWidth?: string | null;
}

/**
 * Lightweight tooltip primitive. Track F will replace with Radix; until then
 * we ship hover + focus + ARIA so keyboard users get parity.
 */
export function Tooltip({ content, children, className, delay = 300, maxWidth }: TooltipProps) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const tooltipId = useId();

  const handleEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), delay);
  };

  const handleLeave = () => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearTimeout(timeoutRef.current);
      setShow(false);
    }
  };

  const isRich = typeof content !== 'string';
  const widthStyle = maxWidth === null
    ? undefined
    : { maxWidth: maxWidth ?? (isRich ? '16rem' : undefined) };

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onKeyDown={handleKeyDown}
      aria-describedby={show ? tooltipId : undefined}
    >
      {children}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[var(--z-dropdown)] pointer-events-none"
            role="tooltip"
            id={tooltipId}
            style={widthStyle}
          >
            <div
              className={cn(
                'bg-foreground text-background text-xs px-2.5 py-1.5 rounded-lg shadow-md',
                isRich ? 'text-left leading-snug' : 'whitespace-nowrap',
              )}
            >
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
