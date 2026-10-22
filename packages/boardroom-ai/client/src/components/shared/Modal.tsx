import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { animate, motion, useDragControls, useMotionValue, type PanInfo } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { springs, useReducedMotion } from '../../lib/motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional one-line description under the title (wired to `aria-describedby`). */
  description?: string;
  /** Panel width on ≥ 640 px viewports. Below that the modal is always a bottom sheet. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * `dialog` (default): centred panel.
   * `sheet`: a side sheet from the trailing edge on ≥ 640 px (full height,
   * inset, scrolls inside), the same bottom sheet below. Both run on the
   * sheet curve; the bottom sheet can be dragged down to dismiss.
   */
  variant?: 'dialog' | 'sheet';
  /** Optional controls in the header, before the close button (sheet variant). */
  headerActions?: ReactNode;
  className?: string;
}

const SIZE = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' } as const;
const SHEET_SIZE = { sm: 'sm:w-[24rem]', md: 'sm:w-[32rem]', lg: 'sm:w-[42rem]' } as const;

/** Bottom sheet dismiss thresholds: 120 px of travel, or a flick faster than 600 px/s. */
export const SHEET_DISMISS_OFFSET = 120;
export const SHEET_DISMISS_VELOCITY = 600;

export function shouldDismissSheet(info: Pick<PanInfo, 'offset' | 'velocity'>): boolean {
  return info.offset.y > SHEET_DISMISS_OFFSET || info.velocity.y > SHEET_DISMISS_VELOCITY;
}

/** Below Tailwind's `sm` breakpoint every modal is a bottom sheet. */
function useIsBottomSheet(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);
  return narrow;
}

/**
 * Modal on Base UI: focus trap, scroll lock, `inert` page, Escape and
 * outside-press come from the primitive. The dialog panel enters 0.96 → 1
 * with an 8 px rise on the sheet curve (320 ms); the side sheet slides in
 * from the trailing edge; under 640 px both are a bottom sheet sliding up.
 * The bottom sheet follows a downward drag on its handle and dismisses past
 * 120 px or a 600 px/s flick, settling back on `springs.gesture` with the
 * gesture's velocity otherwise. Reduced motion: no drag, close button only;
 * the global rule collapses the CSS transitions.
 */
export function Modal({ isOpen, onClose, title, children, description, size = 'md', variant = 'dialog', headerActions, className }: ModalProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const sheet = variant === 'sheet';
  const bottomSheet = useIsBottomSheet();
  const reducedMotion = useReducedMotion();
  const draggable = bottomSheet && !reducedMotion;
  const dragControls = useDragControls();
  const y = useMotionValue(0);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (shouldDismissSheet(info)) {
      onClose();
      return;
    }
    // Settle back where it was, carrying the release velocity into the spring.
    animate(y, 0, { ...springs.gesture, velocity: info.velocity.y });
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            // `modal-backdrop`: index.css drops the blur under reduced transparency.
            'modal-backdrop fixed inset-0 z-modal-backdrop min-h-dvh bg-black/40 backdrop-blur-sm',
            'transition-opacity duration-normal ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            'supports-[-webkit-touch-callout:none]:absolute'
          )}
        />
        <Dialog.Viewport
          className={cn(
            'fixed inset-0 z-modal grid max-sm:items-end max-sm:p-0',
            sheet
              ? 'sm:items-stretch sm:justify-items-end sm:p-3'
              : 'place-items-center overflow-y-auto p-4 sm:p-6'
          )}
        >
          <Dialog.Popup
            ref={popupRef}
            // Focus lands on the panel itself (like a native sheet), not on the
            // close button, so opening never paints a focus ring; Tab reaches
            // the first control from there.
            initialFocus={popupRef}
            aria-label={title}
            aria-modal="true"
            data-variant={variant}
            className={cn(
              // The popup positions and animates; the surface itself is the motion panel inside.
              'relative w-full outline-none focus-visible:outline-none',
              'transition-[opacity,transform] duration-sheet ease-sheet',
              sheet
                ? cn(
                    // Side sheet: slide in 24 px from the trailing edge, full height, inset.
                    'sm:flex sm:h-full sm:max-h-[calc(100dvh-1.5rem)] translate-x-0',
                    'sm:data-[starting-style]:translate-x-6 sm:data-[starting-style]:opacity-0',
                    'sm:data-[ending-style]:translate-x-6 sm:data-[ending-style]:opacity-0',
                    SHEET_SIZE[size],
                  )
                : cn(
                    // Enter 0.96 → 1 and rise 8 px; exit settles close to rest.
                    'scale-100 translate-y-0',
                    'sm:data-[starting-style]:opacity-0 sm:data-[starting-style]:scale-[0.96] sm:data-[starting-style]:translate-y-2',
                    'sm:data-[ending-style]:opacity-0 sm:data-[ending-style]:scale-[0.98]',
                    SIZE[size],
                  ),
              // Bottom sheet under 640 px: slides up from the edge.
              'max-sm:translate-y-0 max-sm:data-[starting-style]:translate-y-full max-sm:data-[ending-style]:translate-y-full',
              className
            )}
          >
            <motion.div
              data-testid="modal-surface"
              style={{ y }}
              drag={draggable ? 'y' : false}
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0 }}
              dragElastic={{ top: 0, bottom: 1 }}
              dragMomentum={false}
              onDragEnd={onDragEnd}
              className={cn(
                'flex max-h-[inherit] w-full flex-col bg-card text-card-foreground rounded-xl shadow-xl ring-1 ring-hairline',
                '[--parent-radius:var(--radius-xl)] [--parent-pad:1.5rem]',
                sheet && 'sm:h-full',
                // Bottom sheet: square bottom corners, safe-area padding, capped height.
                'max-sm:max-h-[90dvh] max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]',
              )}
            >
              {/* Drag handle (bottom sheet only): the grabber and the title row start the gesture. */}
              <div
                onPointerDown={draggable ? (e) => dragControls.start(e) : undefined}
                className={cn('shrink-0', draggable && 'cursor-grab touch-none active:cursor-grabbing')}
              >
                {draggable && (
                  <div className="flex justify-center pt-2" aria-hidden="true">
                    <span className="h-1.5 w-9 rounded-capsule bg-muted-foreground/35" data-testid="sheet-grabber" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border">
                  <div className="min-w-0">
                    <Dialog.Title className="text-lg font-semibold tracking-title text-foreground">{title}</Dialog.Title>
                    {description && (
                      <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 -mr-2 -mt-1">
                    {headerActions}
                    <Dialog.Close
                      aria-label="Close modal"
                      className={cn(
                        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground',
                        'transition-[background-color,color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      )}
                    >
                      <X size={16} strokeWidth={1.75} aria-hidden="true" />
                    </Dialog.Close>
                  </div>
                </div>
              </div>
              <div className={cn('px-6 py-4', sheet && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>{children}</div>
            </motion.div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
