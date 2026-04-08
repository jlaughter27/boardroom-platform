import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'outcome_review' | 'contradiction' | 'cognitive_load' | 'pattern' | 'memo' | 'system';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  actionLabel?: string;
  entityId?: string;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;

  toggle: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isOpen: false,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  markRead: (id) =>
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      );
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  dismiss: (id) =>
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id);
      return {
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
      };
    }),

  addNotification: (n) => {
    const { notifications } = get();
    // Deduplicate by entityId if present
    if (n.entityId && notifications.some((existing) => existing.entityId === n.entityId && existing.type === n.type)) {
      return;
    }
    const notification: Notification = {
      ...n,
      id: `notif-${nextId++}`,
      timestamp: new Date(),
      read: false,
    };
    set((s) => ({
      notifications: [notification, ...s.notifications],
      unreadCount: s.unreadCount + 1,
    }));
  },
}));
