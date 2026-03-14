/**
 * Custom confirmation dialog — replaces browser's native confirm().
 *
 * Provides a context-based API so any component can `await` a confirmation
 * result without managing modal state manually.
 *
 * Usage:
 *   const confirm = useConfirmDialog();
 *   const ok = await confirm({ title: 'Delete session?', ... });
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmDialogOptions {
  /** Dialog heading. */
  title: string;
  /** Descriptive body text (supports line breaks via \n). */
  message?: string;
  /** Label for the confirm button. Default: "Confirm". */
  confirmLabel?: string;
  /** Visual style for the confirm button. */
  confirmVariant?: 'danger' | 'warning';
  /** Label for the cancel button. Default: "Cancel". */
  cancelLabel?: string;
  /** Monospace-styled name displayed prominently (e.g. session name). */
  itemName?: string;
}

type ConfirmFn = (options: ConfirmDialogOptions) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

/** Hook that returns a promise-based confirm function. */
export function useConfirmDialog(): ConfirmFn {
  const fn = useContext(ConfirmDialogContext);
  if (!fn) throw new Error('useConfirmDialog must be used within <ConfirmDialogProvider>');
  return fn;
}

// ---------------------------------------------------------------------------
// Provider — mount once at app root
// ---------------------------------------------------------------------------

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    options: ConfirmDialogOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  const handleResult = useCallback((result: boolean) => {
    state?.resolve(result);
    setState(null);
  }, [state]);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialogModal
          {...state.options}
          onConfirm={() => handleResult(true)}
          onCancel={() => handleResult(false)}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Modal component (internal)
// ---------------------------------------------------------------------------

interface ModalProps extends ConfirmDialogOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialogModal({
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  cancelLabel = 'Cancel',
  itemName,
  onConfirm,
  onCancel,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  // Entrance animation trigger
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Focus the cancel button on mount (safer default)
  useEffect(() => {
    cancelBtnRef.current?.focus();
  }, []);

  // Keyboard: Escape → cancel, Enter → confirm
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
      if (e.key === 'Enter') {
        e.stopPropagation();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onCancel, onConfirm]);

  // Focus trap: Tab cycles between Cancel and Confirm buttons
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusable = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean) as HTMLElement[];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Click on backdrop → cancel
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onCancel();
  };

  // Confirm button styles by variant
  const confirmStyles =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500 text-white'
      : 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-400 text-white';

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-150 ${
        visible
          ? 'bg-black/50 backdrop-blur-sm'
          : 'bg-black/0 backdrop-blur-none'
      }`}
    >
      <div
        className={`confirm-dialog w-full max-w-md rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-2xl overflow-hidden transition-all duration-150 ${
          visible
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-2'
        }`}
      >
        {/* Top accent bar — thin red/amber stripe */}
        <div
          className={`h-0.5 ${
            confirmVariant === 'danger' ? 'bg-red-500' : 'bg-amber-500'
          }`}
        />

        <div className="px-5 pt-4 pb-5">
          {/* Header with terminal icon */}
          <div className="flex items-start gap-3">
            {/* Icon container */}
            <div
              className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                confirmVariant === 'danger'
                  ? 'bg-red-50 dark:bg-red-950/40 text-red-500'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-500'
              }`}
            >
              {/* Terminal/process kill icon */}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                <rect x="2" y="3" width="20" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-surface-900 dark:text-surface-50">
                {title}
              </h3>

              {/* Item name in monospace — terminal-style display */}
              {itemName && (
                <div className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
                  <span className="text-surface-400 dark:text-surface-500 text-xs font-mono select-none">&gt;</span>
                  <span className="text-sm font-mono font-medium text-surface-800 dark:text-surface-200 truncate">
                    {itemName}
                  </span>
                </div>
              )}

              {message && (
                <p className="mt-2 text-sm text-surface-500 dark:text-surface-400 leading-relaxed">
                  {message}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2.5 mt-5">
            <button
              ref={cancelBtnRef}
              onClick={onCancel}
              className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-md border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-800 hover:bg-surface-50 dark:hover:bg-surface-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 transition-colors cursor-pointer"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              onClick={onConfirm}
              className={`min-h-[44px] px-4 py-2 text-sm font-medium rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors cursor-pointer ${confirmStyles}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
