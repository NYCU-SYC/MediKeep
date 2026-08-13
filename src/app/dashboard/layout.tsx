'use client';

import React, { RefObject, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FamilyMember, MemberProvider, useActiveMember, UserAccessSnapshot } from './member-context';
import { ToastProvider } from './toast-context';
import { api, ApiError, setPatientSessionToken } from '@/lib/api';
import { SyncProvider } from '@/lib/sync';
import { ALL_MEMBERS, memberHref, normalizeMemberName } from '@/lib/members';
import { Icon, HeartLogo } from './_components/Icon';
import { userMemberHref } from './_components/Shared';
import NhiOnboardingGate from '@/components/NhiOnboardingGate';
import { routeIsActive, routeWithNext } from '@/lib/internalRoutes';

export const PRIMARY_NAV_ITEMS = [
  { name: '總覽', icon: 'home', href: '/dashboard' },
  { name: '健康', icon: 'health', href: '/dashboard/health' },
  { name: '紀錄', icon: 'records', href: '/dashboard/records' },
  { name: '待辦', icon: 'bell', href: '/dashboard/tasks' },
  { name: '更多', icon: 'user', href: '/dashboard/more' },
] as const;

const NEW_SHELL_ROUTES: ReadonlySet<string> = new Set(PRIMARY_NAV_ITEMS.map((item) => item.href));

// Secondary destinations only. Primary destinations are rendered exactly once
// in the desktop sidebar and once in the mobile bottom navigation; the mobile
// all-features sheet must not repeat them.
export const SECONDARY_NAV_SECTIONS = [
  {
    label: '快速操作',
    items: [
      { name: '新增紀錄', icon: 'file', href: '/dashboard/upload' },
      { name: '急診資訊', icon: 'emergency', href: '/dashboard/emergency' },
    ],
  },
  {
    label: '健康細項',
    items: [
      { name: '我的病況', icon: 'hospital', href: '/dashboard/conditions' },
      { name: '目前用藥', icon: 'medication', href: '/dashboard/medications' },
      { name: '健康趨勢', icon: 'trend', href: '/dashboard/trends' },
      { name: '健康時間軸', icon: 'activity', href: '/dashboard/timeline' },
    ],
  },
  {
    label: '資料庫',
    items: [
      { name: '文件', icon: 'folder', href: '/dashboard/documents' },
      { name: '影像', icon: 'scan', href: '/dashboard/imaging' },
      { name: '健保資料', icon: 'archive', href: '/dashboard/nhi' },
    ],
  },
];

const PRIMARY_SECTION_ROUTES: Readonly<Record<string, readonly string[]>> = {
  '/dashboard/health': [
    '/dashboard/health',
    '/dashboard/conditions',
    '/dashboard/problems',
    '/dashboard/medications',
    '/dashboard/trends',
    '/dashboard/emergency',
    '/dashboard/redzone',
  ],
  '/dashboard/records': [
    '/dashboard/records',
    '/dashboard/history',
    '/dashboard/timeline',
    '/dashboard/upload',
    '/dashboard/documents',
    '/dashboard/imaging',
    '/dashboard/nhi',
  ],
  '/dashboard/tasks': [
    '/dashboard/tasks',
    '/dashboard/reminders',
    '/dashboard/clarifications',
  ],
  '/dashboard/more': [
    '/dashboard/more',
    '/dashboard/settings',
  ],
};

export function primaryNavIsActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  if (pathname === '/dashboard/imaging/shares' || pathname.startsWith('/dashboard/imaging/shares/')) {
    return href === '/dashboard/more';
  }
  const routes = PRIMARY_SECTION_ROUTES[href] || [href];
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

const mobileNavItems = PRIMARY_NAV_ITEMS;

export function humanizeMemberRelation(value?: string | null): string {
  const relation = (value ?? '').trim();
  switch (relation.toLowerCase()) {
    case 'self':
      return '本人';
    case 'owner':
      return '家庭管理者';
    case 'cmo':
      return '醫療團隊';
    case 'raw':
      return '原始資料';
    default:
      return relation;
  }
}

function humanizeUserCopy(value: string | null | undefined, fallback: string): string {
  return (value?.trim() || fallback)
    .replace(/\bCMO\b/gi, '醫療團隊')
    .replace(/\bOwner\b/gi, '家庭管理者')
    .replace(/\bSelf\b/gi, '本人')
    .replace(/\braw\b/gi, '原始資料');
}

type AuthMe = {
  authenticated?: boolean;
  needs_binding?: boolean;
  family_name?: string;
  display_name?: string | null;
  role?: string | null;
  health_data_scope?: 'family' | 'member' | 'none' | string | null;
  family_member_id?: string | null;
  family_member_name?: string | null;
  allowed_member_names?: string[] | null;
  permissions?: {
    can_view_family_health_data?: boolean;
    can_edit_patient_reported_data?: boolean;
    can_manage_family_members?: boolean;
    can_manage_join_code?: boolean;
  } | null;
};

type ReminderBellItem = {
  id: string;
  label: string;
  title: string;
  meta: string;
  href: string;
};

function ReminderBell({
  count,
  items,
  href,
  open,
  onToggle,
  variant,
}: {
  count: number;
  items: ReminderBellItem[];
  href: string;
  open: boolean;
  onToggle: () => void;
  variant: 'desktop' | 'mobile';
}) {
  const isDesktop = variant === 'desktop';
  return (
    <div
      data-mobile-dialog-background
      className={isDesktop ? 'desktop-reminder-bell' : undefined}
      style={isDesktop ? {
        position: 'fixed',
        top: 18,
        right: 24,
        zIndex: 180,
      } : {
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        aria-label="提醒浮層"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          position: 'relative',
          width: 44,
          height: 44,
          minHeight: 44,
          borderRadius: 22,
          background: '#fff',
          border: '1px solid var(--gray-200)',
          boxShadow: isDesktop ? '0 10px 24px rgba(15,23,42,0.10)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#22313f',
          cursor: 'pointer',
        }}
      >
        <Icon name="bell" size={20} />
        {count > 0 && (
          <span style={{
            position: 'absolute',
            top: -5,
            right: -5,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: '#c0453a',
            color: '#fff',
            fontSize: 10,
            fontWeight: 850,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 5px',
          }}>{count}</span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="提醒摘要"
          style={{
            position: 'absolute',
            top: isDesktop ? 50 : 42,
            right: 0,
            width: isDesktop ? 330 : 300,
            maxWidth: 'calc(100vw - 24px)',
            background: '#fff',
            border: '1px solid var(--gray-200)',
            borderRadius: 10,
            boxShadow: '0 20px 45px rgba(15,23,42,0.16)',
            padding: 12,
            zIndex: 260,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14, color: '#22313f' }}>提醒</strong>
            <Link href={href} style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>提醒中心</Link>
          </div>
          {items.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6b7c8c', padding: '10px 0' }}>目前沒有需要立即處理的提醒。</div>
          ) : items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: 'block',
                textDecoration: 'none',
                color: '#22313f',
                borderTop: '1px solid #eef2f5',
                padding: '9px 0',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#6b7c8c', fontWeight: 800 }}>{item.label}</span>
                <span style={{ fontSize: 11, color: '#93a3af' }}>{item.meta}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 750, marginTop: 3, lineHeight: 1.35 }}>{item.title}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MobileNavItem ─────────────────────────────────────────────────────────────
export function MobileNavItem({
  item,
  isActive,
}: {
  item: { name: string; icon: string; href: string };
  isActive: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '60px', gap: '3px',
        color: isActive ? 'var(--primary)' : '#93a3af',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 22 }}><Icon name={item.icon} size={22} /></span>
        <span className="mobile-nav-item-label" style={{ fontSize: '10px', fontWeight: isActive ? '700' : '500' }}>{item.name}</span>
        {isActive && (
          <div style={{
            width: '20px', height: '2.5px', borderRadius: '2px',
            background: 'var(--primary)',
          }} />
        )}
      </div>
    </Link>
  );
}

export function MobileMenuSheet({
  open,
  onClose,
  pathname,
  navHref,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  navHref: (href: string) => string;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = returnFocusRef.current ?? document.activeElement as HTMLElement | null;
    const background = Array.from(document.querySelectorAll<HTMLElement>('[data-mobile-dialog-background]'));
    const previousState = background.map((node) => ({ node, hidden: node.getAttribute('aria-hidden'), inert: (node as HTMLElement & { inert?: boolean }).inert }));
    background.forEach((node) => {
      node.setAttribute('aria-hidden', 'true');
      (node as HTMLElement & { inert?: boolean }).inert = true;
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previousState.forEach(({ node, hidden, inert }) => {
        if (hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', hidden);
        (node as HTMLElement & { inert?: boolean }).inert = inert ?? false;
      });
      previous?.focus();
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  const isActive = (href: string) => routeIsActive(pathname, href);

  const containFocus = (event: React.KeyboardEvent) => {
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
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div
      className="mobile-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-menu-title"
      onKeyDown={containFocus}
      ref={dialogRef}
    >
      <div
        data-dialog-backdrop
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(15,23,42,0.38)',
        }}
      />
      <section className="mobile-menu-sheet">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '16px 18px 12px',
          borderBottom: '1px solid var(--hk-line)',
        }}>
          <div>
            <h2 id="mobile-menu-title" style={{ fontSize: '17px', fontWeight: 850, color: 'var(--hk-ink)' }}>全部功能</h2>
            <div style={{ fontSize: '12px', color: 'var(--hk-ink-2)', marginTop: '2px' }}>
              健康細節、資料紀錄與急診工具
            </div>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="關閉"
            style={{
              width: 44,
              height: 44,
              minHeight: 44,
              borderRadius: 22,
              background: '#eef2f5',
              color: '#45596a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              lineHeight: 1,
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '12px 14px 18px', overflowY: 'auto', maxHeight: 'calc(84vh - 68px)' }}>
          {SECONDARY_NAV_SECTIONS.map((section) => (
            <div key={section.label} style={{ marginBottom: '14px' }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 850,
                color: '#6b7c8c',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '4px 4px 8px',
              }}>
                {section.label}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.name}
                      href={navHref(item.href)}
                      onClick={onClose}
                      aria-current={active ? 'page' : undefined}
                      style={{
                        minHeight: '58px',
                        borderRadius: '12px',
                        border: `1px solid ${active ? '#cfe3e8' : 'var(--hk-line)'}`,
                        background: active ? '#e7f3f5' : '#fff',
                        color: active ? '#3e6b7e' : 'var(--hk-ink)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 11px',
                        boxShadow: active ? '0 6px 18px rgba(15,118,110,0.10)' : 'none',
                      }}
                    >
                      <span style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9,
                        background: active ? '#ccfbf1' : '#f6f9fa',
                        color: active ? '#3e6b7e' : '#56687a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <Icon name={item.icon} size={17} />
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 800, lineHeight: 1.25 }}>{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MemberActionBar({
  canUseFamilyUi,
  onSwitchMember,
}: {
  canUseFamilyUi: boolean;
  onSwitchMember: (member: string) => void;
}) {
  const { activeMember, members, membersLoading } = useActiveMember();
  const { canWriteMember, writeAccessReason } = useActiveMember();
  if (membersLoading || members.length === 0) return null;

  const selectedMember = activeMember || (members.length === 1 ? members[0].name : '');
  const mustChooseMember = members.length > 1 && !activeMember;
  const writeReason = writeAccessReason(selectedMember);
  const activeInfo = members.find((member) => member.name === activeMember);
  const recordHref = memberHref('/dashboard/upload', selectedMember, { tab: 'manual' });
  const emergencyHref = memberHref('/dashboard/emergency', selectedMember);

  const actionStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '44px',
    padding: '9px 14px',
    borderRadius: '9px',
    fontSize: '13px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  };

  const disabledAction = (label: string, reason = '請先選擇要記錄的家庭成員') => (
    <button
      type="button"
      disabled
      title={reason}
      aria-label={`${label}：${reason}`}
      style={{
        ...actionStyle,
        background: '#e5e7eb',
        color: '#93a3af',
        cursor: 'not-allowed',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="member-action-bar">
      <div className="member-action-content">
        <div className="member-action-main">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#6b7c8c', letterSpacing: '0.04em' }}>
              目前記錄對象
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '16px', color: '#22313f' }}>
                {activeMember || (members.length > 1 ? '全家總覽' : members[0].name)}
              </strong>
              {activeInfo && (
                <span style={{ fontSize: '12px', color: '#6b7c8c' }}>
                  {humanizeMemberRelation(activeInfo.relation)}{activeInfo.age ? ` · ${activeInfo.age} 歲` : ''}
                </span>
              )}
              {mustChooseMember && (
                <span style={{
                  fontSize: '12px',
                  color: '#a97614',
                  background: '#fdf1e0',
                  border: '1px solid #fed7aa',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontWeight: 700,
                }}>
                  新增紀錄或上傳前請先選一位成員
                </span>
              )}
            </div>
          </div>

          {canUseFamilyUi && (
            <div className="member-action-chips" aria-label="切換家庭成員">
              {members.length > 1 && (
                <button
                  type="button"
                  aria-pressed={!activeMember}
                  onClick={() => onSwitchMember(ALL_MEMBERS)}
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    padding: '7px 12px',
                    borderRadius: '999px',
                    border: `1px solid ${!activeMember ? 'var(--primary)' : '#dbe3ea'}`,
                    background: !activeMember ? 'var(--primary)' : '#fff',
                    color: !activeMember ? '#fff' : '#56687a',
                    fontSize: '12px',
                    fontWeight: !activeMember ? 800 : 650,
                  }}
                >
                  全家總覽
                </button>
              )}
              {members.map((member) => {
                const isActive = member.name === activeMember;
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onSwitchMember(member.name)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      minWidth: 44,
                      minHeight: 44,
                      padding: '7px 12px',
                      borderRadius: '999px',
                      border: `1px solid ${isActive ? member.color : '#dbe3ea'}`,
                      background: isActive ? member.color : '#fff',
                      color: isActive ? '#fff' : '#56687a',
                      fontSize: '12px',
                      fontWeight: isActive ? 800 : 650,
                    }}
                  >
                    <span>{member.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="member-action-actions">
          {mustChooseMember || !canWriteMember(selectedMember) ? disabledAction('新增紀錄', mustChooseMember ? undefined : writeReason ?? undefined) : (
            <Link
              href={recordHref}
              style={{
                ...actionStyle,
                background: 'var(--primary)',
                color: '#fff',
                boxShadow: '0 2px 10px rgba(14,116,144,0.22)',
              }}
            >
              <><Icon name="file" size={16} /> 新增紀錄</>
            </Link>
          )}
          <Link
              href={emergencyHref}
              style={{
                ...actionStyle,
                background: '#fff',
                color: '#8f342b',
                border: '1px solid #f2d3cf',
              }}
            >
              急診資訊
            </Link>
        </div>
      </div>
    </div>
  );
}

// ── DashboardInner ────────────────────────────────────────────────────────────
function DashboardInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const {
    activeMember, setActiveMember,
    members, setMembers, setMembersLoading,
    membersError, setMembersError,
    setUserAccess,
    writeAccessReason,
  } = useActiveMember();
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authRetry, setAuthRetry] = useState(0);
  const [familyName, setFamilyName] = useState('我的家庭');
  const [canUseFamilyUi, setCanUseFamilyUi] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reminderBellOpen, setReminderBellOpen] = useState(false);
  const [unreadReminderCount, setUnreadReminderCount] = useState(0);
  const [reminderBellItems, setReminderBellItems] = useState<ReminderBellItem[]>([]);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  // ── Auth check ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const check = async (silent: boolean) => {
      if (!silent) setAuthError('');
      try {
        const data = await api.get('/api/auth/me') as AuthMe;
        if (cancelled) return;
        const currentRoute = typeof window === 'undefined'
          ? '/dashboard'
          : `${window.location.pathname}${window.location.search}`;
        if (!data?.authenticated) {
          window.location.replace(routeWithNext('/upload-entry', currentRoute));
          return;
        }
        if (data?.needs_binding) {
          router.replace(routeWithNext('/setup', currentRoute));
          return;
        }
        if (data?.family_name) setFamilyName(data.family_name);
        if (data?.display_name) setDisplayName(data.display_name);
        setUserAccess(data as UserAccessSnapshot);
        const canViewFullFamily = data?.permissions?.can_view_family_health_data === true;
        setCanUseFamilyUi(canViewFullFamily || ['family', 'member', 'none'].includes(data?.health_data_scope ?? ''));
        if (!silent) setAuthChecked(true);
      } catch (error) {
        if (cancelled || (error instanceof ApiError && error.status === 401)) return;
        if (!silent) {
          const retryHint = error instanceof ApiError && error.retryAfter
            ? `，約 ${error.retryAfter} 秒後可重試`
            : '';
          setAuthError(`暫時無法確認登入狀態${retryHint}。`);
        }
      }
    };
    check(false);
    const iv = setInterval(() => check(true), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [authRetry, router, setUserAccess]);

  // ── Load members ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked) return;
    setMembersLoading(true);
    setMembersError(false);
    // Use the authenticated api wrapper (Bearer token + same-origin cookie),
    // consistent with the /api/auth/me check above. The previous raw
    // fetch(..., {credentials:'include'}) was cookie-only, so a valid token
    // with an expired/absent cookie silently fell back to an empty list and
    // rendered the misleading "no members yet" onboarding state.
    api.get('/api/members')
      .then((raw) => {
        const data: FamilyMember[] = Array.isArray(raw) ? raw : [];
        const selfMember = data.find((m) => {
          const relation = (m.relation || '').toLowerCase();
          return ['self', '本人', '我', 'owner'].includes(relation) || (displayName && m.name === displayName);
        }) ?? data[0];
        const visibleMembers = canUseFamilyUi ? data : (selfMember ? [selfMember] : []);
        setMembers(visibleMembers);
        if (canUseFamilyUi) {
          const normalizedActive = normalizeMemberName(activeMember);
          if (normalizedActive && !data.some((member) => member.name === normalizedActive)) {
            setActiveMember(ALL_MEMBERS);
          } else if (data.length === 1 && !normalizedActive) {
            setActiveMember(data[0].name);
          }
        } else {
          setActiveMember(selfMember?.name ?? '');
        }
      })
      .catch((err: unknown) => {
        // 401 already triggers a redirect to login inside the api wrapper, so
        // don't flag it as a load error. Any other failure is a real error and
        // must NOT masquerade as the empty/onboarding state.
        const status = (err as { status?: number } | null)?.status;
        if (status !== 401) setMembersError(true);
      })
      .finally(() => setMembersLoading(false));
  }, [authChecked, canUseFamilyUi, displayName, activeMember, setActiveMember, setMembers, setMembersLoading, setMembersError]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setPatientSessionToken(null);
    router.replace('/');
  };

  const navHref = (href: string) => {
    if (href === '/dashboard/settings') return href;
    if (NEW_SHELL_ROUTES.has(href)) return userMemberHref(href, activeMember);
    return memberHref(href, activeMember);
  };

  useEffect(() => {
    if (!authChecked) return;
    const params = activeMember && activeMember !== ALL_MEMBERS ? { member: activeMember } : undefined;
    Promise.allSettled([
      api.get('/api/patients/me/reminders', params),
      api.get('/api/patients/me/missing-data-requests', params),
      api.get('/api/patients/me/follow-ups', params),
    ])
      .then((results) => {
        const valueAt = (index: number): unknown => results[index].status === 'fulfilled' ? (results[index] as PromiseFulfilledResult<unknown>).value : [];
        const rows = Array.isArray(valueAt(0)) ? valueAt(0) as Array<{ id: number | string; is_done?: boolean; status?: string; scheduled_date?: string | null; title?: string | null }> : [];
        const missingRows = Array.isArray(valueAt(1)) ? valueAt(1) as Array<{ id: string; title?: string | null; status?: string; due_date?: string | null }> : [];
        const followRows = Array.isArray(valueAt(2)) ? valueAt(2) as Array<{ id: number | string; item?: string | null; reason?: string | null; status?: string; suggested_date?: string | null; priority?: string | null }> : [];
        const today = new Date().toISOString().slice(0, 10);
        const dueReminders = rows.filter((item) => !item.is_done && item.status !== 'completed' && item.status !== 'deleted' && item.scheduled_date && item.scheduled_date <= today);
        const pendingMissing = missingRows.filter((item) => item.status && !['resolved', 'canceled', 'deleted'].includes(item.status));
        const activeFollowUps = followRows.filter((item) => item.status && !['done', 'completed', 'resolved', 'closed', 'deleted', 'canceled'].includes(item.status));
        const centerHref = memberHref('/dashboard/reminders', activeMember);
        const items: ReminderBellItem[] = [
          ...dueReminders.map((item) => ({
            id: `reminder-${item.id}`,
            label: '提醒',
            title: item.title || '待處理提醒',
            meta: item.scheduled_date || '今天',
            href: centerHref,
          })),
          ...pendingMissing.map((item) => ({
            id: `missing-${item.id}`,
            label: '補資料',
            title: humanizeUserCopy(item.title, '醫療團隊需要補充資料'),
            meta: item.due_date || item.status || '待回覆',
            href: `${centerHref}${centerHref.includes('?') ? '&' : '?'}highlight=missing-${item.id}`,
          })),
          ...activeFollowUps.map((item) => ({
            id: `followup-${item.id}`,
            label: item.priority === 'high' ? '高優先追蹤' : '醫療團隊追蹤',
            title: humanizeUserCopy(item.item || item.reason, '醫療團隊追蹤提醒'),
            meta: item.suggested_date || '待追蹤',
            href: `${centerHref}${centerHref.includes('?') ? '&' : '?'}highlight=followup-${item.id}`,
          })),
        ].slice(0, 8);
        setReminderBellItems(items);
        setUnreadReminderCount(dueReminders.length + pendingMissing.length + activeFollowUps.length);
      })
      .catch(() => {
        setUnreadReminderCount(0);
        setReminderBellItems([]);
      });
  }, [authChecked, activeMember]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMobileMenuOpen(false);
      setReminderBellOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, searchKey]);

  const switchMember = (member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMember(normalized);
    if (pathname === '/dashboard/settings') return;

    const params = new URLSearchParams(searchParams.toString());
    if (normalized) {
      params.set('member', normalized);
    } else {
      params.delete('member');
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // ── Auth loading screen ───────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <main style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #3e6b7e 0%, #33596a 100%)',
      }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '1px', marginBottom: '6px' }}>
            HealthKeep
          </h1>
          <p style={{ fontSize: '12px', opacity: 0.75, marginBottom: '36px' }}>您的家庭健康守護者</p>
          {authError ? (
            <div role="alert" aria-live="assertive">
              <p style={{ fontSize: '14px', opacity: 0.95, marginBottom: 16 }}>{authError}</p>
              <button
                type="button"
                onClick={() => setAuthRetry((value) => value + 1)}
                style={{ border: '1px solid rgba(255,255,255,0.7)', background: '#fff', color: '#33596a', borderRadius: 10, padding: '10px 16px', fontWeight: 800, cursor: 'pointer' }}
              >
                重新確認
              </button>
            </div>
          ) : (
            <>
              <div style={{
                width: '48px', height: '48px', border: '4px solid rgba(255,255,255,0.25)',
                borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                margin: '0 auto 20px',
              }} />
              <p role="status" style={{ fontSize: '14px', opacity: 0.9 }}>正在確認身分...</p>
            </>
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f2f5f7' }}>

      {/* ── Desktop Sidebar ─────────────────────────────────────────────────────── */}
      <aside data-mobile-dialog-background className="app-sidebar" style={{
        width: 'var(--sidebar-width)', background: '#fff',
        borderRight: '1px solid var(--gray-200)',
        position: 'fixed', height: '100vh', zIndex: 100, overflowY: 'auto',
      }}>

        {/* Brand */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
              background: 'linear-gradient(135deg, #3e6b7e 0%, #33596a 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}><HeartLogo size={18} /></div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: '800', color: '#111', lineHeight: 1.1 }}>HealthKeep</div>
              <div style={{ fontSize: '10px', color: '#bbb', marginTop: '2px' }}>{canUseFamilyUi ? '家庭健康守護者' : '個人健康檔案'}</div>
            </div>
          </div>
          <div style={{
            background: '#f8f9fa', borderRadius: '10px', padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{ display: 'flex', color: '#56687a' }}><Icon name={canUseFamilyUi ? 'family' : 'user'} size={20} /></span>
            <div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#333' }}>{canUseFamilyUi ? familyName : (displayName || members[0]?.name || '本人')}</div>
              <div style={{ fontSize: '10px', color: '#aaa', marginTop: '1px' }}>
                {canUseFamilyUi ? (members.length > 0 ? `${members.length} 位成員` : (membersError ? '載入失敗' : '尚未新增成員')) : '目前檢視：自己的健康資料'}
              </div>
            </div>
          </div>
        </div>

        {/* Nav sections */}
        <nav aria-label="桌面主要導覽" style={{ padding: '8px', flex: 1 }}>
          <div style={{ marginBottom: '4px' }}>
            <p style={{
              fontSize: '10px', fontWeight: '700', color: '#c0c8d4',
              textTransform: 'uppercase', letterSpacing: '0.8px',
              padding: '10px 14px 4px',
            }}>
              主要入口
            </p>
            {PRIMARY_NAV_ITEMS.map((item) => (
              <Link
                key={item.name}
                href={navHref(item.href)}
                className={`sidebar-nav-item${primaryNavIsActive(pathname, item.href) ? ' sidebar-active' : ''}`}
                aria-current={primaryNavIsActive(pathname, item.href) ? 'page' : undefined}
              >
                <span style={{ marginRight: '10px', width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={item.icon} size={18} />
                </span>
                <span>{item.name}</span>
              </Link>
            ))}
          </div>

          {SECONDARY_NAV_SECTIONS.map((section) => {
            const hasActiveItem = section.items.some((item) => routeIsActive(pathname, item.href));
            return (
              <details key={section.label} className="sidebar-secondary" open={hasActiveItem}>
                <summary>{section.label}</summary>
                {section.items.map((item) => (
                  <Link
                    key={item.name}
                    href={navHref(item.href)}
                    className={`sidebar-nav-item${routeIsActive(pathname, item.href) ? ' sidebar-active' : ''}`}
                    aria-current={routeIsActive(pathname, item.href) ? 'page' : undefined}
                  >
                    <span style={{ marginRight: '10px', width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span>{item.name}</span>
                  </Link>
                ))}
              </details>
            );
          })}

          {/* Family members section */}
          {canUseFamilyUi && <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--gray-100)' }}>
            <p style={{
              fontSize: '10px', fontWeight: '700', color: '#c0c8d4',
              textTransform: 'uppercase', letterSpacing: '0.8px',
              padding: '0 14px 8px',
            }}>
              家庭成員
            </p>

            {members.length === 0 ? (
              <div style={{ padding: '4px 8px 8px' }}>
                {membersError ? (
                  <p style={{ fontSize: '12px', color: '#b06a10', marginBottom: '8px', paddingLeft: '6px' }}>
                    成員資料載入失敗
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: '12px', color: '#bbb', marginBottom: '8px', paddingLeft: '6px' }}>
                      尚未新增成員
                    </p>
                    <Link href={navHref('/dashboard/settings')} className="sidebar-nav-item" style={{
                      fontSize: '12px', color: 'var(--primary)', fontWeight: '600', padding: '6px 8px',
                    }}>
                      <><Icon name="user" size={16} /> 新增第一位成員 <Icon name="arrowRight" size={16} /></>
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <>
                {members.length > 1 && (
                  <button
                    type="button"
                    aria-pressed={!activeMember}
                    onClick={() => switchMember(ALL_MEMBERS)}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '8px 10px',
                      cursor: 'pointer', borderRadius: '10px',
                      background: !activeMember ? '#e7f1ff' : 'transparent',
                      border: `1px solid ${!activeMember ? '#cfe3e8' : 'transparent'}`,
                      marginBottom: '3px', transition: 'all 0.15s',
                      width: '100%', textAlign: 'left', font: 'inherit',
                    }}
                  >
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '16px', flexShrink: 0,
                      background: !activeMember ? 'var(--primary)' : '#eee',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginRight: '10px', fontSize: '14px', fontWeight: 'bold',
                      color: !activeMember ? '#fff' : '#888', transition: 'all 0.15s',
                    }}>
                      全
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: !activeMember ? '700' : '500', color: !activeMember ? '#111' : '#666' }}>
                        全家總覽
                      </div>
                      <div style={{ fontSize: '10px', color: !activeMember ? 'var(--primary)' : '#bbb', fontWeight: !activeMember ? '600' : '400' }}>
                        {members.length} 位成員
                      </div>
                    </div>
                    {!activeMember && <div style={{ width: '6px', height: '6px', borderRadius: '3px', background: 'var(--primary)', flexShrink: 0 }} />}
                  </button>
                )}
                {members.map(member => {
                  const isActive = member.name === activeMember;
                  return (
                <button
                  type="button"
                  aria-pressed={isActive}
                  key={member.id}
                  onClick={() => switchMember(member.name)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '8px 10px',
                    cursor: 'pointer', borderRadius: '10px',
                    background: isActive ? `${member.color}14` : 'transparent',
                    border: `1px solid ${isActive ? `${member.color}35` : 'transparent'}`,
                    marginBottom: '3px', transition: 'all 0.15s',
                    width: '100%', textAlign: 'left', font: 'inherit',
                  }}
                >
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '16px', flexShrink: 0,
                    background: isActive ? member.color : '#eee',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginRight: '10px', fontSize: '12px', fontWeight: 'bold',
                    color: isActive ? '#fff' : '#888', transition: 'all 0.15s',
                  }}>
                    {member.name.slice(0, 2)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px', fontWeight: isActive ? '700' : '500',
                      color: isActive ? '#111' : '#666',
                    }}>
                      {member.name}
                    </div>
                    <div style={{ fontSize: '10px', color: isActive ? member.color : '#bbb', fontWeight: isActive ? '600' : '400' }}>
                      {humanizeMemberRelation(member.relation)}{member.age ? ` · ${member.age} 歲` : ''}
                    </div>
                  </div>
                  {isActive && (
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '3px',
                      background: member.color, flexShrink: 0,
                    }} />
                  )}
                </button>
                  );
                })}
              </>
            )}
          </div>}
        </nav>

        {/* Logout */}
        <div style={{ padding: '12px', borderTop: '1px solid var(--gray-100)' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', padding: '9px', borderRadius: '8px',
              background: '#f8f9fa', color: '#666', fontSize: '13px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', cursor: 'pointer', border: '1px solid var(--gray-200)',
              transition: 'background 0.15s',
            }}
          >
            <Icon name="logout" size={16} /> 登出系統
          </button>
        </div>
      </aside>

      <ReminderBell
        count={unreadReminderCount}
        items={reminderBellItems}
        href={navHref('/dashboard/reminders')}
        open={reminderBellOpen}
        onToggle={() => setReminderBellOpen((value) => !value)}
        variant="desktop"
      />

      {/* ── Mobile Header ────────────────────────────────────────────────────────── */}
      <header
        data-mobile-dialog-background
        className="mobile-header"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
          background: '#fff', borderBottom: '1px solid var(--gray-200)',
          height: 'calc(56px + env(safe-area-inset-top))',
          padding: 'env(safe-area-inset-top) max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left))',
          alignItems: 'center', justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        {/* Brand */}
        <Link
          href={navHref('/dashboard')}
          aria-label="回到總覽"
          style={{
            flexShrink: 0,
            minWidth: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
              background: 'linear-gradient(135deg, #3e6b7e 0%, #33596a 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
            }}><HeartLogo size={16} /></div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: '#111', letterSpacing: '-0.3px' }}>
              HealthKeep
            </div>
          </div>
        </Link>

        {/* Member chips — horizontal scroll */}
        {canUseFamilyUi && <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: '6px',
          overflowX: 'auto', justifyContent: 'flex-end',
          scrollbarWidth: 'none', paddingRight: '2px',
        }}>
          {members.length === 0 ? (
            <Link
              href={navHref('/dashboard/settings')}
              style={{ flexShrink: 0, minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <><Icon name="user" size={15} /> 新增成員</>
              </span>
            </Link>
          ) : (
            <>
              {members.length > 1 && (
                <button
                  type="button"
                  onClick={() => switchMember('')}
                  aria-pressed={!activeMember}
                  style={{
                    padding: '6px 14px', borderRadius: '22px', minWidth: 44, minHeight: 44,
                    border: `1.5px solid ${!activeMember ? 'var(--primary)' : 'var(--gray-200)'}`,
                    background: !activeMember ? 'var(--primary)' : '#fff',
                    color: !activeMember ? '#fff' : '#666',
                    fontSize: '12px', fontWeight: !activeMember ? '700' : '500',
                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >全部</button>
              )}
              {members.map(member => {
                const isActive = member.name === activeMember;
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => switchMember(member.name)}
                    aria-pressed={isActive}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '6px 14px', borderRadius: '22px', minWidth: 44, minHeight: 44,
                      border: `1.5px solid ${isActive ? member.color : 'var(--gray-200)'}`,
                      background: isActive ? member.color : '#fff',
                      color: isActive ? '#fff' : '#666',
                      fontSize: '12px', fontWeight: isActive ? '700' : '500',
                      cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                      transition: 'all 0.15s',
                    }}
                  >
                    <span>{member.name}</span>
                    {isActive && member.age && (
                      <span style={{ fontSize: '10px', opacity: 0.85 }}>{member.age}y</span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>}

        <ReminderBell
          count={unreadReminderCount}
          items={reminderBellItems}
          href={navHref('/dashboard/reminders')}
          open={reminderBellOpen}
          onToggle={() => setReminderBellOpen((value) => !value)}
          variant="mobile"
        />

        <button
          type="button"
          ref={mobileMenuTriggerRef}
          onClick={() => setMobileMenuOpen(true)}
          aria-label="開啟全部功能"
          style={{
            flexShrink: 0,
            minHeight: '44px',
            minWidth: '44px',
            padding: '7px 10px',
            borderRadius: '11px',
            background: '#3e6b7e',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            fontWeight: 850,
            boxShadow: '0 6px 14px rgba(15,118,110,0.22)',
          }}
        >
          全部
        </button>
      </header>

      <MobileMenuSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        pathname={pathname}
        navHref={navHref}
        returnFocusRef={mobileMenuTriggerRef}
      />

      {/* ── Main Content ─────────────────────────────────────────────────────────── */}
      <main data-mobile-dialog-background className="app-main">
        <SyncProvider scope="patient" enabled={authChecked}>
          <Suspense fallback={null}>
            <NhiOnboardingGate />
          </Suspense>
          {pathname !== '/dashboard' && (
            <MemberActionBar canUseFamilyUi={canUseFamilyUi} onSwitchMember={switchMember} />
          )}
          {writeAccessReason(activeMember) && (
            <div role="note" style={{ margin: '0 16px 12px', padding: '10px 12px', borderRadius: 10, border: '1px solid #fed7aa', background: '#fff7ed', color: '#9a5b13', fontSize: 13, lineHeight: 1.55 }}>
              唯讀提示：{writeAccessReason(activeMember)}
            </div>
          )}
          {children}
        </SyncProvider>
      </main>

      {/* ── Mobile Bottom Navigation ──────────────────────────────────────────────── */}
      <nav
        data-mobile-dialog-background
        className="mobile-nav"
        aria-label="主要入口"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: '#fff', borderTop: '1px solid var(--gray-200)',
          height: 'calc(60px + env(safe-area-inset-bottom))',
          alignItems: 'stretch',
          padding: '0 max(4px, env(safe-area-inset-right)) env(safe-area-inset-bottom) max(4px, env(safe-area-inset-left))',
        }}
      >
        {mobileNavItems.map(item => (
          <MobileNavItem key={item.name} item={{ ...item, href: navHref(item.href) }} isActive={primaryNavIsActive(pathname, item.href)} />
        ))}
      </nav>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <MemberProvider>
      <ToastProvider>
        <Suspense fallback={null}>
          <DashboardInner>{children}</DashboardInner>
        </Suspense>
      </ToastProvider>
    </MemberProvider>
  );
}
