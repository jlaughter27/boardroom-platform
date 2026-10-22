import { useEffect, useRef, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, CircleCheck, Gauge, Info, Lightbulb, Sparkles, TriangleAlert, X, type LucideProps } from 'lucide-react';
import { useNotificationStore, type Notification } from '../../stores/notification.store';
import { Badge } from '../ui/Badge';
import { DURATION, EASE_OUT, slideUp } from '../../lib/motion';
import { cn } from '../../lib/cn';

const TYPE_ICON: Partial<Record<Notification['type'], ComponentType<LucideProps>>> = {
  outcome_review: Bell,
  contradiction: TriangleAlert,
  pattern: Lightbulb,
  cognitive_load: Gauge,
  memo: Sparkles,
};

function getIcon(type: Notification['type']) {
  const Icon = TYPE_ICON[type] ?? Info;
  return <Icon size={16} strokeWidth={1.75} aria-hidden="true" />;
}

function getIconColor(type: Notification['type']) {
  switch (type) {
    case 'outcome_review': return 'text-primary';
    case 'contradiction': return 'text-warning';
    case 'pattern': return 'text-info';
    case 'cognitive_load': return 'text-danger';
    case 'memo': return 'text-success';
    default: return 'text-muted-foreground';
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationCenter() {
  const { notifications, isOpen, unreadCount, toggle, markRead, markAllRead, dismiss } =
    useNotificationStore();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        toggle();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, toggle]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggle();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, toggle]);

  const handleClick = (n: Notification) => {
    markRead(n.id);
    if (n.actionUrl) {
      navigate(n.actionUrl);
    }
    toggle();
  };

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        onClick={toggle}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground',
          'transition-[background-color,color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.normal, ease: EASE_OUT }}
            className="absolute top-2 right-2 flex h-2 w-2 rounded-capsule bg-danger ring-2 ring-background"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-capsule bg-danger opacity-75" />
          </motion.span>
        )}
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            {...slideUp}
            role="region"
            aria-label="Notifications"
            className="absolute right-0 top-full z-dropdown mt-2 w-[360px] origin-top-right overflow-hidden rounded-xl bg-surface-2 shadow-lg ring-1 ring-hairline"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">Notifications</h3>
                {unreadCount > 0 && (
                  <Badge variant="accent" className="text-[10px]">
                    {unreadCount}
                  </Badge>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-primary transition-colors duration-fast ease-out hover:text-primary/80"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Notification list — a frequent surface: rows appear at once, no stagger. */}
            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <CircleCheck size={28} strokeWidth={1.5} aria-hidden="true" className="mb-2 text-success" />
                  <p className="text-sm">All caught up!</p>
                </div>
              ) : (
                <div>
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 border-b border-border cursor-pointer',
                        'transition-colors duration-fast ease-out hover:bg-muted',
                        !n.read && 'border-l-2 border-l-primary',
                      )}
                    >
                      <span className={cn('mt-0.5 flex-shrink-0', getIconColor(n.type))}>
                        {getIcon(n.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm text-foreground', !n.read && 'font-semibold')}>
                          {n.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {n.description}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {timeAgo(n.timestamp)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(n.id);
                        }}
                        className={cn(
                          'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground',
                          'transition-[background-color,color] duration-fast ease-out hover:bg-muted hover:text-foreground'
                        )}
                        aria-label="Dismiss notification"
                      >
                        <X size={14} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
