'use client';

import React, { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';

export type AsyncStateKind = 'loading' | 'empty' | 'error' | 'partial';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="hk-page-header">
      <div className="hk-page-header-copy">
        {eyebrow && <div className="hk-eyebrow">{eyebrow}</div>}
        <h1 className="hk-page-title">{title}</h1>
        {description && <p className="hk-page-description">{description}</p>}
      </div>
      {actions && <div className="hk-page-header-actions">{actions}</div>}
    </header>
  );
}

export function SourceBadge({
  source,
  confirmed = false,
  label,
}: {
  source?: string | null;
  confirmed?: boolean;
  label?: string;
}) {
  const text = label || (confirmed ? '醫療團隊已確認' : `來源：${source || '未標示'}`);
  return (
    <span
      className={`hk-source-badge ${confirmed ? 'hk-source-badge-confirmed' : 'hk-source-badge-source'}`}
      title={confirmed ? '這個內容由醫療團隊確認後提供' : `資料來源：${source || '未標示'}`}
    >
      <span className="hk-source-badge-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export function ConfirmationBadge({
  confirmed,
  label,
}: {
  confirmed: boolean;
  label?: string;
}) {
  return (
    <SourceBadge
      confirmed={confirmed}
      label={label || (confirmed ? '醫療團隊已確認' : '等待醫療團隊確認')}
    />
  );
}

export function AsyncState({
  state,
  title,
  description,
  onRetry,
  children,
}: {
  state: AsyncStateKind;
  title?: string;
  description?: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  if (state === 'loading') {
    return (
      <div className="hk-async-state hk-async-loading" role="status" aria-live="polite">
        <span className="hk-loading-dot" aria-hidden="true" />
        <span>{title || '正在載入資料…'}</span>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="hk-async-state hk-async-empty" role="status">
        <strong>{title || '目前沒有資料'}</strong>
        {description && <span>{description}</span>}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="hk-async-state hk-async-error" role="alert" aria-live="assertive">
        <strong>{title || '暫時無法載入資料'}</strong>
        <span>{description || '資料仍會保留，請稍後再試。'}</span>
        {onRetry && (
          <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={onRetry}>
            重新載入
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="hk-async-partial" role="note">
      <div className="hk-async-partial-message">
        <strong>{title || '部分資料尚未載入'}</strong>
        <span>{description || '以下內容可能不完整，稍後可以再試。'}</span>
        {onRetry && (
          <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={onRetry}>
            重試
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function HomeDataState({
  state,
  onRetry,
  children,
}: {
  state: 'loading' | 'ready' | 'partial' | 'error';
  onRetry: () => void;
  children?: React.ReactNode;
}) {
  if (state === 'loading') return <AsyncState state="loading" title="正在整理你的健康全貌…" />;
  if (state === 'error') return <AsyncState state="error" onRetry={onRetry} />;
  if (state === 'partial') {
    return (
      <>
        <div style={{ marginBottom: 12 }}><AsyncState state="partial" onRetry={onRetry} /></div>
        {children}
      </>
    );
  }
  return <>{children}</>;
}

export function AccessibleDialog({
  open,
  onClose,
  title,
  description,
  children,
  initialFocusRef,
  returnFocusRef,
  closeLabel = '關閉對話框',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  closeLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = returnFocusRef?.current || document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      (initialFocusRef?.current || closeRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [initialFocusRef, open, returnFocusRef]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="hk-dialog-backdrop" data-dialog-backdrop onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={dialogRef}
        className="hk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="hk-dialog-header">
          <div>
            <h2 id={titleId} className="hk-dialog-title">{title}</h2>
            {description && <p id={descriptionId} className="hk-dialog-description">{description}</p>}
          </div>
          <button ref={closeRef} type="button" className="hk-icon-button" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="hk-dialog-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = '確認',
  cancelLabel = '取消',
  danger = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) {
  return (
    <AccessibleDialog open={open} onClose={onCancel} title={title} description={description}>
      <div className="hk-dialog-actions">
        <button type="button" className="hk-btn hk-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className={`hk-btn ${danger ? 'hk-btn-danger' : 'hk-btn-primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </AccessibleDialog>
  );
}

export function ReadOnlyNotice({
  title = '唯讀提示',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="hk-readonly-notice" role="note">
      <strong>{title}</strong>
      <span>{children}</span>
    </aside>
  );
}

export function FilePicker({
  label = '選擇檔案',
  accept,
  multiple = false,
  helperText,
  disabled = false,
  onChange,
}: {
  label?: string;
  accept?: string;
  multiple?: boolean;
  helperText?: string;
  disabled?: boolean;
  onChange: (files: FileList | null) => void;
}) {
  const id = useId();
  return (
    <div className="hk-file-picker">
      <input
        id={id}
        className="hk-file-picker-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.files)}
      />
      <label className="hk-file-picker-label" htmlFor={id}>
        <span className="hk-file-picker-icon" aria-hidden="true"><Icon name="folder" size={20} /></span>
        <span>{label}</span>
      </label>
      {helperText && <p className="hk-file-picker-helper">{helperText}</p>}
    </div>
  );
}

export function TaskLinkCard({
  href,
  title,
  description,
  icon,
  badge,
  meta,
}: {
  href: string;
  title: string;
  description: string;
  icon?: string;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <Link href={href} className="hk-task-card">
      <span className="hk-task-card-icon" aria-hidden="true"><Icon name={icon || 'records'} size={22} /></span>
      <span className="hk-task-card-content">
        <span className="hk-task-card-title-row">
          <strong>{title}</strong>
          {badge}
        </span>
        <span className="hk-task-card-description">{description}</span>
        {meta && <span className="hk-task-card-meta">{meta}</span>}
      </span>
      <span className="hk-task-card-arrow" aria-hidden="true"><Icon name="arrowRight" size={20} /></span>
    </Link>
  );
}

/**
 * Member-scoped href for the five new shell routes. The route catalog is kept
 * in another owned area; this helper only handles literal dashboard paths and
 * encodes the selected member without trusting user-provided URLs.
 */
export function userMemberHref(
  path: string,
  member?: string | null,
  extra?: Record<string, string | null | undefined>,
) {
  const url = new URL(path, 'https://healthkeep.invalid');
  const normalizedMember = (member || '').trim();
  if (normalizedMember && !['all', '全部', '全家', '全家總覽'].includes(normalizedMember)) {
    url.searchParams.set('member', normalizedMember);
  }
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}
