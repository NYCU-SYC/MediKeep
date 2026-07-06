'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FamilyMember, MemberProvider, useActiveMember } from './member-context';
import { ToastProvider } from './toast-context';
import { api, setPatientSessionToken } from '@/lib/api';
import { SyncProvider } from '@/lib/sync';
import { ALL_MEMBERS, memberHref, normalizeMemberName } from '@/lib/members';
import { Icon, HeartLogo } from './_components/Icon';

// ── Desktop sidebar — primary model tabs first; legacy pages stay reachable. ──
const menuSections = [
  {
    label: '主要',
    items: [
      { name: '首頁', icon: '🏠', href: '/dashboard' },
      { name: '健康', icon: '🩺', href: '/dashboard/health-summary' },
      { name: '疾病總覽', icon: '🏥', href: '/dashboard/problems' },
      { name: '家庭與權限', icon: '👤', href: '/dashboard/settings' },
    ],
  },
  {
    label: '健康細節',
    items: [
      { name: '詳細健康檔案', icon: '🧬', href: '/dashboard/health-profile' },
      { name: '保命紅區',     icon: '🛟', href: '/dashboard/redzone' },
      { name: '急診連結',     icon: '🆘', href: '/dashboard/emergency' },
      { name: '慢性病',       icon: '🏥', href: '/dashboard/conditions' },
      { name: '藥物',         icon: '💊', href: '/dashboard/medications' },
      { name: '趨勢分析',     icon: '📈', href: '/dashboard/trends' },
    ],
  },
  {
    label: '資料與紀錄',
    items: [
      { name: '新增紀錄', icon: '➕', href: '/dashboard/upload' },
      { name: '健保存摺匯入', icon: '📑', href: '/dashboard/nhi' },
      { name: '影像庫',   icon: '🩻', href: '/dashboard/imaging' },
      { name: '文件庫',   icon: '📁', href: '/dashboard/documents' },
      { name: '歷史紀錄', icon: '📋', href: '/dashboard/history' },
    ],
  },
];

// ── Mobile bottom nav: 4 primary tabs（首頁/健康/疾病/家庭）──
const mobileNavLeft = [
  { name: '首頁', icon: '🏠', href: '/dashboard' },
  { name: '健康', icon: '🩺', href: '/dashboard/health-summary' },
  { name: '疾病', icon: '🏥', href: '/dashboard/problems' },
  { name: '家庭', icon: '👤', href: '/dashboard/settings' },
];

// ── MobileNavItem ─────────────────────────────────────────────────────────────
function MobileNavItem({
  item,
  isActive,
}: {
  item: { name: string; icon: string; href: string };
  isActive: boolean;
}) {
  return (
    <Link href={item.href} style={{ flex: 1, WebkitTapHighlightColor: 'transparent' }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '68px', gap: '3px',
        color: isActive ? 'var(--primary)' : '#94a3b8',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 22 }}><Icon name={item.icon} size={22} /></span>
        <span style={{ fontSize: '10px', fontWeight: isActive ? '700' : '500' }}>{item.name}</span>
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

function MobileMenuSheet({
  open,
  onClose,
  pathname,
  navHref,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  navHref: (href: string) => string;
}) {
  if (!open) return null;

  const isActive = (href: string) => href === '/dashboard'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div
      className="mobile-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="全部功能"
    >
      <button
        type="button"
        aria-label="關閉全部功能選單"
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
            <div style={{ fontSize: '17px', fontWeight: 850, color: 'var(--hk-ink)' }}>全部功能</div>
            <div style={{ fontSize: '12px', color: 'var(--hk-ink-2)', marginTop: '2px' }}>
              健康細節、資料紀錄與急診工具
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              background: '#f1f5f9',
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '12px 14px 18px', overflowY: 'auto', maxHeight: 'calc(84vh - 68px)' }}>
          {menuSections.map((section) => (
            <div key={section.label} style={{ marginBottom: '14px' }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 850,
                color: '#64748b',
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
                        border: `1px solid ${active ? '#99f6e4' : 'var(--hk-line)'}`,
                        background: active ? '#f0fdfa' : '#fff',
                        color: active ? '#0f766e' : 'var(--hk-ink)',
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
                        background: active ? '#ccfbf1' : '#f8fafc',
                        color: active ? '#0f766e' : '#475569',
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
  if (membersLoading || members.length === 0) return null;

  const selectedMember = activeMember || (members.length === 1 ? members[0].name : '');
  const mustChooseMember = members.length > 1 && !activeMember;
  const activeInfo = members.find((member) => member.name === activeMember);
  const recordHref = memberHref('/dashboard/upload', selectedMember, { tab: 'manual' });
  const fileHref = memberHref('/dashboard/upload', selectedMember, { tab: 'file' });

  const actionStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '38px',
    padding: '9px 14px',
    borderRadius: '9px',
    fontSize: '13px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
  };

  const disabledAction = (label: string) => (
    <button
      type="button"
      disabled
      title="請先選擇要記錄的家庭成員"
      style={{
        ...actionStyle,
        background: '#e5e7eb',
        color: '#94a3b8',
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
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748b', letterSpacing: '0.04em' }}>
              目前記錄對象
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '16px', color: '#0f172a' }}>
                {activeMember || (members.length > 1 ? '全家總覽' : members[0].name)}
              </strong>
              {activeInfo && (
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {activeInfo.relation}{activeInfo.age ? ` · ${activeInfo.age} 歲` : ''}
                </span>
              )}
              {mustChooseMember && (
                <span style={{
                  fontSize: '12px',
                  color: '#b45309',
                  background: '#fff7ed',
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
                  onClick={() => onSwitchMember(ALL_MEMBERS)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '999px',
                    border: `1px solid ${!activeMember ? 'var(--primary)' : '#dbe3ea'}`,
                    background: !activeMember ? 'var(--primary)' : '#fff',
                    color: !activeMember ? '#fff' : '#475569',
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
                    onClick={() => onSwitchMember(member.name)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '7px 12px',
                      borderRadius: '999px',
                      border: `1px solid ${isActive ? member.color : '#dbe3ea'}`,
                      background: isActive ? member.color : '#fff',
                      color: isActive ? '#fff' : '#475569',
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
          {mustChooseMember ? disabledAction('新增紀錄') : (
            <Link
              href={recordHref}
              style={{
                ...actionStyle,
                background: 'var(--primary)',
                color: '#fff',
                boxShadow: '0 2px 10px rgba(0,123,255,0.22)',
              }}
            >
              + 新增紀錄
            </Link>
          )}
          {mustChooseMember ? disabledAction('上傳文件') : (
            <Link
              href={fileHref}
              style={{
                ...actionStyle,
                background: '#fff',
                color: 'var(--primary)',
                border: '1px solid #bfdbfe',
              }}
            >
              上傳文件
            </Link>
          )}
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
  } = useActiveMember();
  const [authChecked, setAuthChecked] = useState(false);
  const [familyName, setFamilyName] = useState('我的家庭');
  const [canUseFamilyUi, setCanUseFamilyUi] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // ── Auth check ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const check = async (silent: boolean) => {
      try {
        const data = await api.get('/api/auth/me') as { authenticated?: boolean; needs_binding?: boolean; family_name?: string; display_name?: string | null; role?: string | null };
        if (cancelled) return;
        if (!data?.authenticated) { router.replace('/'); return; }
        if (data?.needs_binding) { router.replace('/setup'); return; }
        if (data?.family_name) setFamilyName(data.family_name);
        if (data?.display_name) setDisplayName(data.display_name);
        setCanUseFamilyUi(['owner', 'family_manager', 'proxy', 'caregiver'].includes(data?.role ?? ''));
        if (!silent) setAuthChecked(true);
      } catch {
        if (!cancelled) router.replace('/');
      }
    };
    check(false);
    const iv = setInterval(() => check(true), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [router]);

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
    return memberHref(href, activeMember);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setMobileMenuOpen(false), 0);
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
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
      }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '1px', marginBottom: '6px' }}>
            HealthKeep
          </h1>
          <p style={{ fontSize: '12px', opacity: 0.75, marginBottom: '36px' }}>您的家庭健康守護者</p>
          <div style={{
            width: '48px', height: '48px', border: '4px solid rgba(255,255,255,0.25)',
            borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            margin: '0 auto 20px',
          }} />
          <p style={{ fontSize: '14px', opacity: 0.9 }}>正在確認身分...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f4f7f9' }}>

      {/* ── Desktop Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="app-sidebar" style={{
        width: 'var(--sidebar-width)', background: '#fff',
        borderRight: '1px solid var(--gray-200)',
        position: 'fixed', height: '100vh', zIndex: 100, overflowY: 'auto',
      }}>

        {/* Brand */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '10px', flexShrink: 0,
              background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
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
            <span style={{ display: 'flex', color: '#475569' }}><Icon name={canUseFamilyUi ? 'family' : '👤'} size={20} /></span>
            <div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#333' }}>{canUseFamilyUi ? familyName : (displayName || members[0]?.name || '本人')}</div>
              <div style={{ fontSize: '10px', color: '#aaa', marginTop: '1px' }}>
                {canUseFamilyUi ? (members.length > 0 ? `${members.length} 位成員` : (membersError ? '載入失敗' : '尚未新增成員')) : '目前檢視：自己的健康資料'}
              </div>
            </div>
          </div>
          <Link
            href={navHref('/dashboard/reminders')}
            style={{
              marginTop: 10,
              minHeight: 36,
              borderRadius: 10,
              background: '#fff',
              border: '1px solid var(--gray-200)',
              color: '#475569',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            <Icon name="🔔" size={16} /> 提醒
          </Link>
        </div>

        {/* Nav sections */}
        <nav style={{ padding: '8px', flex: 1 }}>
          {menuSections.map((section, sectionIndex) => {
            const isSecondary = sectionIndex > 0;
            const hasActiveItem = section.items.some((item) => pathname === item.href);
            const sectionItems = (
              <>
                {section.items.map(item => (
                  <Link
                    key={item.name}
                    href={navHref(item.href)}
                    className={`sidebar-nav-item${pathname === item.href ? ' sidebar-active' : ''}`}
                  >
                    <span style={{ marginRight: '10px', width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span>{item.name}</span>
                  </Link>
                ))}
              </>
            );
            if (isSecondary) {
              return (
                <details key={section.label} className="sidebar-secondary" open={hasActiveItem}>
                  <summary>{section.label}</summary>
                  {sectionItems}
                </details>
              );
            }
            return (
              <div key={section.label} style={{ marginBottom: '4px' }}>
                <p style={{
                  fontSize: '10px', fontWeight: '700', color: '#c0c8d4',
                  textTransform: 'uppercase', letterSpacing: '0.8px',
                  padding: '10px 14px 4px',
                }}>
                  {section.label}
                </p>
                {sectionItems}
              </div>
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
                  <p style={{ fontSize: '12px', color: '#c2410c', marginBottom: '8px', paddingLeft: '6px' }}>
                    成員資料載入失敗
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: '12px', color: '#bbb', marginBottom: '8px', paddingLeft: '6px' }}>
                      尚未新增成員
                    </p>
                    <Link href="/dashboard/settings" className="sidebar-nav-item" style={{
                      fontSize: '12px', color: 'var(--primary)', fontWeight: '600', padding: '6px 8px',
                    }}>
                      + 新增第一位成員 →
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <>
                {members.length > 1 && (
                  <div
                    onClick={() => switchMember(ALL_MEMBERS)}
                    style={{
                      display: 'flex', alignItems: 'center', padding: '8px 10px',
                      cursor: 'pointer', borderRadius: '10px',
                      background: !activeMember ? '#e7f1ff' : 'transparent',
                      border: `1px solid ${!activeMember ? '#bfdbfe' : 'transparent'}`,
                      marginBottom: '3px', transition: 'all 0.15s',
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
                  </div>
                )}
                {members.map(member => {
                  const isActive = member.name === activeMember;
                  return (
                <div
                  key={member.id}
                  onClick={() => switchMember(member.name)}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '8px 10px',
                    cursor: 'pointer', borderRadius: '10px',
                    background: isActive ? `${member.color}14` : 'transparent',
                    border: `1px solid ${isActive ? `${member.color}35` : 'transparent'}`,
                    marginBottom: '3px', transition: 'all 0.15s',
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
                      {member.relation}{member.age ? ` · ${member.age} 歲` : ''}
                    </div>
                  </div>
                  {isActive && (
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '3px',
                      background: member.color, flexShrink: 0,
                    }} />
                  )}
                </div>
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

      {/* ── Mobile Header ────────────────────────────────────────────────────────── */}
      <header
        className="mobile-header"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
          background: '#fff', borderBottom: '1px solid var(--gray-200)',
          height: '56px', padding: '0 16px',
          alignItems: 'center', justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        {/* Brand */}
        <Link href={navHref('/dashboard')} style={{ flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
              background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
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
            <Link href="/dashboard/settings" style={{ flexShrink: 0 }}>
              <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: '600' }}>
                + 新增成員
              </span>
            </Link>
          ) : (
            <>
              {members.length > 1 && (
                <button
                  onClick={() => switchMember('')}
                  style={{
                    padding: '6px 14px', borderRadius: '20px', minHeight: '34px',
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
                    onClick={() => switchMember(member.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '6px 14px', borderRadius: '20px', minHeight: '34px',
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

        <Link
          href={navHref('/dashboard/reminders')}
          aria-label="提醒"
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 11,
            background: '#f8fafc',
            color: '#475569',
            border: '1px solid var(--gray-200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <Icon name="🔔" size={18} />
        </Link>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="開啟全部功能"
          style={{
            flexShrink: 0,
            minHeight: '36px',
            padding: '7px 10px',
            borderRadius: '11px',
            background: '#0f766e',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            fontWeight: 850,
            boxShadow: '0 6px 14px rgba(15,118,110,0.22)',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>☰</span>
          全部
        </button>
      </header>

      <MobileMenuSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        pathname={pathname}
        navHref={navHref}
      />

      {/* ── Main Content ─────────────────────────────────────────────────────────── */}
      <main className="app-main">
        <SyncProvider scope="patient" enabled={authChecked}>
          {pathname !== '/dashboard' && (
            <MemberActionBar canUseFamilyUi={canUseFamilyUi} onSwitchMember={switchMember} />
          )}
          {children}
        </SyncProvider>
      </main>

      {/* ── Mobile Bottom Navigation ──────────────────────────────────────────────── */}
      <nav
        className="mobile-nav"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: '#fff', borderTop: '1px solid var(--gray-200)',
          height: '60px', alignItems: 'stretch', padding: '0',
        }}
      >
        {mobileNavLeft.map(item => (
          <MobileNavItem key={item.name} item={{ ...item, href: navHref(item.href) }} isActive={pathname === item.href} />
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
