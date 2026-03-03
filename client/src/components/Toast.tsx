import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, type, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

const STYLE: Record<ToastType, { border: string; icon: string; iconBg: string }> = {
  success: { border: 'border-l-green-500', icon: 'text-green-500', iconBg: 'bg-green-50' },
  error: { border: 'border-l-red-500', icon: 'text-red-500', iconBg: 'bg-red-50' },
  info: { border: 'border-l-blue-500', icon: 'text-blue-500', iconBg: 'bg-blue-50' },
};

const ICONS: Record<ToastType, ReactNode> = {
  success: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const s = STYLE[toast.type];

  return (
    <div
      className={`pointer-events-auto bg-white rounded-lg shadow-lg border border-gray-200 border-l-4 ${s.border} px-4 py-3 flex items-center gap-3 min-w-[280px] max-w-sm animate-[toast-in_0.25s_ease-out]`}
    >
      <div className={`w-6 h-6 rounded-full ${s.iconBg} flex items-center justify-center shrink-0 ${s.icon}`}>
        {ICONS[toast.type]}
      </div>
      <p className="text-sm text-gray-700 flex-1">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-gray-300 hover:text-gray-500 shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
