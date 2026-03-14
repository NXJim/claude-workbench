/**
 * Toast notification container — lower-right, z-50.
 */

import { useNotificationStore } from '@/stores/notificationStore';

const TYPE_STYLES = {
  info: 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
  success: 'bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200',
  warning: 'bg-yellow-50 dark:bg-yellow-950/50 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200',
  error: 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
};

export function ToastContainer() {
  const { toasts, removeToast } = useNotificationStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-enter border rounded-lg px-4 py-3 shadow-lg flex items-start gap-3 ${TYPE_STYLES[toast.type]}`}
        >
          {toast.sessionColor && (
            <div
              className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
              style={{ backgroundColor: toast.sessionColor }}
            />
          )}
          <p className="text-sm flex-1">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
