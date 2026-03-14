/**
 * Notification/toast state.
 */

import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  sessionId?: string;
  sessionColor?: string;
  timestamp: number;
}

interface NotificationState {
  toasts: Toast[];
  browserNotificationsEnabled: boolean;

  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  enableBrowserNotifications: () => void;
  sendBrowserNotification: (title: string, body: string) => void;
}

let toastCounter = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  browserNotificationsEnabled: false,

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`;
    const newToast: Toast = { ...toast, id, timestamp: Date.now() };
    set((s) => ({ toasts: [...s.toasts, newToast] }));

    // Auto-remove after 5 seconds
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);

    // Also send browser notification if enabled
    if (get().browserNotificationsEnabled && document.hidden) {
      get().sendBrowserNotification('Claude Workbench', toast.message);
    }
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  enableBrowserNotifications: () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        set({ browserNotificationsEnabled: perm === 'granted' });
      });
    } else if (Notification.permission === 'granted') {
      set({ browserNotificationsEnabled: true });
    }
  },

  sendBrowserNotification: (title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  },
}));
