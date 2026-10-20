import { useRef, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional one-line description under the title (wired to `aria-describedby`). */
  description?: string;
  /** Panel width on ≥ 640 px viewports. Below that the modal is always a bottom sheet. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' } as const;

/**
 * Modal dialog on Base UI: focus trap, scroll lock, `inert` page, Escape and
 * outside-press come from the primitive. The panel enters 0.96 → 1 with an
 * 8 px rise on the sheet curve (320 ms); under 640 px it is a bottom sheet
 * sliding up. The global reduced-motion rule collapses both transitions.
 */
export function Modal({ isOpen, onClose, title, children, description, size = 'md', className }: ModalProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            'fixed inset-0 z-modal-backdrop min-h-dvh bg-black/40 backdrop-blur-sm',
            'transition-opacity duration-normal ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
            'supports-[-webkit-touch-callout:none]:absolute'
          )}
        />
        <Dialog.Viewport className="fixed inset-0 z-modal grid place-items-center overflow-y-auto p-4 sm:p-6 max-sm:items-end max-sm:p-0">
          <Dialog.Popup
            ref={popupRef}
            // Focus lands on the panel itself (like a native sheet), not on the
            // close button, so opening never paints a focus ring; Tab reaches
            // the first control from there.
            initialFocus={popupRef}
            aria-label={title}
            aria-modal="true"
            className={cn(
              'relative w-full bg-card text-card-foreground rounded-xl shadow-xl ring-1 ring-hairline outline-none focus-visible:outline-none',
              '[--parent-radius:var(--radius-xl)] [--parent-pad:1.5rem]',
              // Enter 0.96 → 1 and rise 8 px; exit settles close to rest.
              'scale-100 translate-y-0 transition-[opacity,transform] duration-sheet ease-sheet',
              'data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.96] data-[starting-style]:translate-y-2',
              'data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]',
              // Bottom sheet under 640 px: slides up from the edge, square bottom corners.
              'max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]',
              'max-sm:data-[starting-style]:scale-100 max-sm:data-[starting-style]:translate-y-full',
              'max-sm:data-[ending-style]:scale-100 max-sm:data-[ending-style]:translate-y-full',
              SIZE[size],
              className
            )}
          >
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold tracking-title text-foreground">{title}</Dialog.Title>
                {description && (
                  <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description>
                )}
              </div>
              <Dialog.Close
                aria-label="Close modal"
                className={cn(
                  '-mr-2 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground',
                  'transition-[background-color,color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="px-6 py-4">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
