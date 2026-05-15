import { type ReactNode } from 'react';
import { Dialog } from '../ui/Dialog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Modal — DEPRECATED thin shim over the new Radix-backed `<Dialog>` primitive.
 *
 * The hand-rolled implementation was replaced as part of Track F (audit
 * P0 #16). New code should import `<Dialog>` from `components/ui/Dialog`
 * directly — it exposes `open/onOpenChange/title/description/size/hideClose`
 * and the full Radix compound API.
 *
 * Existing callers (DashboardConfigurator, OutcomeReviewModal, DashboardPage,
 * SettingsPage) continue to work via this shim until they're migrated.
 */
export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
    >
      {children}
    </Dialog>
  );
}
