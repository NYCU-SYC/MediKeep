'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, action?: { label: string; onClick: () => void; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success', action?: { label: string; onClick: () => void; durationMs?: number }) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type, actionLabel: action?.label, onAction: action?.onClick }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, action?.durationMs ?? 3000);
  }, []);

  const COLORS: Record<ToastType, string> = {
    success: '#2e7d32',
    error:   '#c62828',
    info:    '#1565c0',
  };

  const ICONS: Record<ToastType, string> = {
    success: '✅',
    error:   '❌',
    info:    'ℹ️',
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container — top-right on desktop, top-center on mobile */}
      <div data-toast-container style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 32px)',
      }}>
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              borderRadius: '12px',
              fontSize: '14px',
              fontWeight: '600',
              color: '#fff',
              background: COLORS[t.type],
              boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
              animation: 'toastSlideIn 0.25s ease',
              whiteSpace: 'normal',
              maxWidth: '320px',
              overflow: 'hidden',
            }}
          >
            <span style={{ flexShrink: 0 }}>{ICONS[t.type]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.message}</span>
            {t.actionLabel && t.onAction && (
              <button
                type="button"
                onClick={() => {
                  t.onAction?.();
                  setToasts(prev => prev.filter(item => item.id !== t.id));
                }}
                style={{
                  marginLeft: 'auto',
                  border: '1px solid rgba(255,255,255,0.65)',
                  background: 'rgba(255,255,255,0.14)',
                  color: '#fff',
                  borderRadius: '8px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @media (max-width: 768px) {
          /* on mobile, keep toasts below the fixed header (56px) */
          [data-toast-container] { top: 68px !important; right: 12px !important; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  return useContext(ToastContext);
}
