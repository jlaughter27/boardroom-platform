import { type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Dialog — Radix-backed modal/dialog primitive.
 *
 * Replaces the hand-rolled `components/shared/Modal.tsx`. Radix gives us:
 *   - Portal (escapes overflow:hidden ancestors — audit P0 #16)
 *   - Scroll-lock on the body while open
 *   - Focus trap + ESC-restore-focus to trigger
 *   - Proper ARIA (role="dialog", aria-modal, labelled-by/described-by)
 *   - Animation hooks via `data-state` attributes
 *
 * API mirrors the old Modal contract so callers can migrate:
 *
 *   <Dialog open={open} onOpenChange={setOpen} title="..." description="...">
 *     ...body...
 *   </Dialog>
 *
 * For more control use the compound form via `Dialog.Root/Trigger/Content`:
 *
 *   <Dialog.Root>
 *     <Dialog.Trigger asChild><Button /></Dialog.Trigger>
 *     <Dialog.Content title="..."><Body /></Dialog.Content>
 *   </Dialog.Root>
 */

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Default `lg` (max-w-lg). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Hide the X close button (useful for typed-confirm dialogs). */
  hideClose?: boolean;
  /** Class for the content container. */
  className?: string;
}

const sizeMap: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

function DialogComponent({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'lg',
  hideClose,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0'
          )}
        />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[var(--z-modal)] -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-2rem)]',
            sizeMap[size],
            'bg-card border border-border rounded-lg shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'focus:outline-none',
            className
          )}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex-1 min-w-0">
              <RadixDialog.Title className="text-lg font-semibold text-foreground">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-muted-foreground">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {!hideClose && (
              <RadixDialog.Close
                aria-label="Close dialog"
                className={cn(
                  'ml-4 inline-flex h-8 w-8 items-center justify-center rounded-md',
                  'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </RadixDialog.Close>
            )}
          </div>
          <div className="px-6 py-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Compound exports — power users can compose Radix primitives directly while
 * picking up our styling for the Content surface via `Dialog.contentClassName`.
 */
export const Dialog = Object.assign(DialogComponent, {
  Root: RadixDialog.Root,
  Trigger: RadixDialog.Trigger,
  Close: RadixDialog.Close,
  Portal: RadixDialog.Portal,
  Overlay: RadixDialog.Overlay,
  Title: RadixDialog.Title,
  Description: RadixDialog.Description,
  /**
   * Raw RadixDialog.Content with our default chrome stripped — use when
   * you want a fully custom shell (e.g. typed-confirm).
   */
  Content: RadixDialog.Content,
});
