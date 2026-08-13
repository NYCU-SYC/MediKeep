'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, ChevronDown, ChevronUp, Eye, Images, RotateCcw, Share2, Trash2, Upload, X } from 'lucide-react';
import { useActiveMember } from '../member-context';
import { getPatientSessionToken } from '@/lib/api';
import { memberHref, memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';
import { AsyncState, ConfirmDialog, PageHeader, ReadOnlyNotice } from '../_components/Shared';
import { useToast } from '../toast-context';

type SeriesOut = {
  id: string;
  study_id: string;
  series_number: number | null;
  series_description: string | null;
  modality: string | null;
  body_part: string | null;
  instance_count: number;
  available_instance_count: number;
  missing_instance_count: number;
  storage_available: boolean;
};

type StudyOut = {
  id: string;
  member_name: string;
  study_instance_uid: string | null;
  study_date: string | null;
  study_description: string | null;
  modality: string | null;
  patient_name: string | null;
  series_count: number;
  instance_count: number;
  available_instance_count: number;
  missing_instance_count: number;
  storage_available: boolean;
  note: string | null;
  created_at: string;
  deleted_at?: string | null;
  recoverable?: boolean;
  restore_action?: string | null;
  series?: SeriesOut[];
};

type DeleteStudyResult = { deleted_at: string; recoverable: boolean; revoked_share_count: number; save_state: string };

type ShareResult = { share_url: string; expires_at: string | null };
type ErrorPayload = {
  detail?: unknown;
  error?: { message?: string; code?: string; details?: unknown };
};
const SHARE_EXPIRY_HOURS = 24;
const MISSING_STORAGE_MESSAGE = '影像原始檔目前不在安全儲存區，請重新上傳 DICOM，或請系統管理人員協助恢復原始檔。';

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDicomDate(d: string | null): string {
  if (!d || d.length < 8) return '—';
  return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
}

function modalityColor(m: string | null): string {
  const map: Record<string, string> = {
    CT: '#1565c0', MR: '#6a1b9a', CR: '#2e7d32', DR: '#2e7d32',
    US: '#e65100', NM: '#880e4f', PT: '#880e4f', XA: '#37474f',
  };
  return map[m ?? ''] ?? '#607d8b';
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const payload = await res.json().catch(() => null) as ErrorPayload | null;
  if (payload?.error?.message) return payload.error.message;
  if (typeof payload?.detail === 'string') return payload.detail;
  if (payload?.detail && typeof payload.detail === 'object' && 'message' in payload.detail && typeof payload.detail.message === 'string') return payload.detail.message;
  if (res.status === 401) return '登入狀態已失效，請重新登入後查看影像庫';
  return fallback;
}

function authHeaders(): HeadersInit {
  const token = getPatientSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function operationHeaders(key: string): Headers {
  const headers = new Headers(authHeaders());
  headers.set('Idempotency-Key', key);
  return headers;
}

function newOperationKey(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random()}`;
}

const BADGE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
  fontWeight: '700', color: '#fff', flexShrink: 0,
};

function AuthenticatedThumbnail({ seriesId }: { seriesId: string }) {
  const [thumbnail, setThumbnail] = useState({ seriesId: '', src: '', failed: false });

  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;

    fetch(`/api/dicom/series/${seriesId}/thumbnail`, {
      credentials: 'include',
      headers: authHeaders(),
    })
      .then(async res => {
        if (!res.ok) throw new Error(await readApiError(res, '無法載入縮圖'));
        return res.blob();
      })
      .then(blob => {
        if (!blob.type.startsWith('image/')) throw new Error('縮圖格式不正確');
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbnail({ seriesId, src: objectUrl, failed: false });
      })
      .catch(() => {
        if (!cancelled) setThumbnail({ seriesId, src: '', failed: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [seriesId]);

  if (thumbnail.seriesId === seriesId && thumbnail.failed) {
    return <span style={{ color: '#c8d4dc', fontSize: '11px', fontWeight: 700 }}>無預覽</span>;
  }
  if (thumbnail.seriesId !== seriesId || !thumbnail.src) {
    return <span style={{ color: '#6b7c8c', fontSize: '11px', fontWeight: 700 }}>載入</span>;
  }
  return (
    // Blob URLs are authenticated, short-lived previews and cannot use Next Image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbnail.src}
      alt=""
      loading="lazy"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ImagingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members, canWriteMember, writeAccessReason } = useActiveMember();
  const { showToast } = useToast();

  const [studies, setStudies] = useState<StudyOut[]>([]);
  const [total, setTotal] = useState(0);
  const [deletedStudies, setDeletedStudies] = useState<StudyOut[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedError, setDeletedError] = useState('');
  const [section, setSection] = useState<'active' | 'deleted'>('active');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seriesLoading, setSeriesLoading] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<(ShareResult & { label: string }) | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; description: string; member: string } | null>(null);
  const operationKeysRef = useRef(new Map<string, string>());
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');
  const requestedMemberParam = searchParams.get('member');

  const operationKey = (action: 'delete' | 'restore', studyId: string) => {
    const identity = `${action}:${studyId}`;
    const existing = operationKeysRef.current.get(identity);
    if (existing) return existing;
    const created = newOperationKey(`dicom-${action}`);
    operationKeysRef.current.set(identity, created);
    return created;
  };

  useEffect(() => {
    if (requestedMemberParam === null) return;
    const requestedMember = normalizeMemberName(requestedMemberParam);
    setActiveMember(requestedMember);
    setFilterMember(requestedMember || '全部');
  }, [requestedMemberParam, setActiveMember]);

  const switchMember = (label: string) => {
    const normalized = label === '全部' ? '' : normalizeMemberName(label);
    setFilterMember(label);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  const PAGE = 20;

  const fetchStudies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: '0' });
      if (filterMember !== '全部') params.set('member', filterMember);
      const r = await fetch(`/api/dicom/studies?${params}`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (r.ok) {
        const data: StudyOut[] = await r.json();
        setStudies(data);
        setTotal(parseInt(r.headers.get('X-Total-Count') ?? String(data.length), 10));
      } else {
        setError(await readApiError(r, '無法載入影像庫'));
      }
    } catch {
      setError('無法連線到影像庫，請稍後再試');
    } finally {
      setLoading(false);
    }
  }, [filterMember]);

  useEffect(() => { fetchStudies(); }, [fetchStudies]);

  const fetchDeletedStudies = useCallback(async () => {
    setDeletedLoading(true);
    setDeletedError('');
    try {
      const params = new URLSearchParams({ deleted: 'true', limit: '50', offset: '0' });
      if (filterMember !== '全部') params.set('member', filterMember);
      const response = await fetch(`/api/dicom/studies?${params}`, { credentials: 'include', headers: authHeaders() });
      if (!response.ok) throw new Error(await readApiError(response, '無法載入最近刪除'));
      setDeletedStudies(await response.json() as StudyOut[]);
    } catch (error) {
      setDeletedError(error instanceof Error ? error.message : '無法載入最近刪除');
    } finally {
      setDeletedLoading(false);
    }
  }, [filterMember]);

  useEffect(() => {
    if (section === 'deleted') void fetchDeletedStudies();
  }, [fetchDeletedStudies, section]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(studies.length) });
      if (filterMember !== '全部') params.set('member', filterMember);
      const r = await fetch(`/api/dicom/studies?${params}`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (r.ok) {
        const data: StudyOut[] = await r.json();
        setStudies(prev => [...prev, ...data]);
      } else {
        setError(await readApiError(r, '無法載入更多影像'));
      }
    } catch {
      setError('無法載入更多影像；已顯示的影像仍保留。');
    } finally {
      setLoadingMore(false);
    }
  };

  // Expand a study → lazy-load its series list
  const toggleStudy = async (study: StudyOut) => {
    const id = study.id;
    if (expanded[id]) {
      setExpanded(e => ({ ...e, [id]: false }));
      return;
    }
    setExpanded(e => ({ ...e, [id]: true }));
    if (study.series && study.series.length > 0) return; // already loaded

    setSeriesLoading(s => ({ ...s, [id]: true }));
    try {
      const r = await fetch(`/api/dicom/studies/${id}`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (r.ok) {
        const detail: StudyOut & { series: SeriesOut[] } = await r.json();
        setStudies(prev => prev.map(s => s.id === id ? { ...s, series: detail.series } : s));
      } else {
        setError(await readApiError(r, '無法載入影像序列'));
      }
    } finally {
      setSeriesLoading(s => ({ ...s, [id]: false }));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deletingId) return;
    if (!canWriteMember(deleteTarget.member)) {
      showToast(writeAccessReason(deleteTarget.member) || '權限仍在確認中，目前只能查看。', 'info');
      setDeleteTarget(null);
      return;
    }
    const studyId = deleteTarget.id;
    setDeletingId(studyId);
    setOperationError('');
    try {
      const r = await fetch(`/api/dicom/studies/${studyId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: operationHeaders(operationKey('delete', studyId)),
      });
      if (r.ok) {
        const result = await r.json() as DeleteStudyResult;
        const removed = studies.find(study => study.id === studyId);
        setStudies(prev => prev.filter(s => s.id !== studyId));
        if (removed) setDeletedStudies(previous => [{ ...removed, deleted_at: result.deleted_at, recoverable: result.recoverable }, ...previous.filter(item => item.id !== removed.id)]);
        setTotal(previous => Math.max(0, previous - 1));
        setDeleteTarget(null);
        showToast(
          `影像檢查已移到最近刪除${result.revoked_share_count ? `，並撤銷 ${result.revoked_share_count} 個分享連結` : ''}。`,
          'success',
          result.recoverable && removed ? {
            label: '復原',
            durationMs: 8000,
            onClick: () => { void restoreStudy({ ...removed, deleted_at: result.deleted_at, recoverable: true }); },
          } : undefined,
        );
      } else {
        const message = await readApiError(r, '無法刪除影像檢查');
        setOperationError(`${message}；本次沒有移除，影像與清單項目都仍保留，請稍後重試。`);
      }
    } catch {
      setOperationError('網路連線中斷；無法確認刪除結果。清單項目仍保留，請重新載入確認後再重試。');
    } finally {
      setDeletingId(null);
    }
  };

  const restoreStudy = async (study: StudyOut) => {
    if (restoringId === study.id) return;
    if (!canWriteMember(study.member_name)) {
      showToast(writeAccessReason(study.member_name) || '權限仍在確認中，目前無法復原影像。', 'info');
      return;
    }
    setRestoringId(study.id);
    setOperationError('');
    try {
      const response = await fetch(`/api/dicom/studies/${study.id}/restore`, { method: 'POST', credentials: 'include', headers: operationHeaders(operationKey('restore', study.id)) });
      if (!response.ok) throw new Error(await readApiError(response, '無法復原影像檢查'));
      const restored = await response.json() as StudyOut;
      setDeletedStudies(previous => previous.filter(item => item.id !== study.id));
      setStudies(previous => [restored, ...previous.filter(item => item.id !== study.id)]);
      setTotal(previous => previous + 1);
      operationKeysRef.current.delete(`delete:${study.id}`);
      operationKeysRef.current.delete(`restore:${study.id}`);
      showToast('影像檢查已復原。先前撤銷的分享連結不會自動恢復。', 'success');
    } catch (error) {
      setOperationError(`${error instanceof Error ? error.message : '復原失敗'}；影像仍在最近刪除，請重試。`);
    } finally {
      setRestoringId(null);
    }
  };

  const handleShareStudy = async (studyId: string, desc: string) => {
    const study = studies.find(item => item.id === studyId);
    if (!study || !canWriteMember(study.member_name)) {
      showToast(writeAccessReason(study?.member_name) || '權限仍在確認中，目前不能建立分享連結。', 'info');
      return;
    }
    setSharingId(studyId);
    setOperationError('');
    try {
      const r = await fetch('/api/dicom/share', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ study_id: studyId, expiry_hours: SHARE_EXPIRY_HOURS }),
      });
      if (r.ok) {
        const data = await r.json();
        const shareUrl = `${window.location.origin}/viewer/${data.share_token}`;
        setShareResult({ share_url: shareUrl, expires_at: data.expires_at, label: desc });
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
      } else {
        setOperationError(`${await readApiError(r, '無法建立分享連結')}；分享連結尚未建立。`);
      }
    } catch {
      setOperationError('網路連線中斷，分享連結尚未建立。請稍後重試。');
    } finally {
      setSharingId(null);
    }
  };

  const handleShareSeries = async (seriesId: string, desc: string, memberName: string) => {
    if (!canWriteMember(memberName)) {
      showToast(writeAccessReason(memberName) || '權限仍在確認中，目前不能建立分享連結。', 'info');
      return;
    }
    setSharingId(seriesId);
    setOperationError('');
    try {
      const r = await fetch('/api/dicom/share', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ series_id: seriesId, expiry_hours: SHARE_EXPIRY_HOURS }),
      });
      if (r.ok) {
        const data = await r.json();
        const shareUrl = `${window.location.origin}/viewer/${data.share_token}`;
        setShareResult({ share_url: shareUrl, expires_at: data.expires_at, label: desc });
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
      } else {
        setOperationError(`${await readApiError(r, '無法建立分享連結')}；分享連結尚未建立。`);
      }
    } catch {
      setOperationError('網路連線中斷，分享連結尚未建立。請稍後重試。');
    } finally {
      setSharingId(null);
    }
  };

  const memberOptions = ['全部', ...members.map(m => m.name)];

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>

        <PageHeader
          eyebrow="紀錄"
          title="醫學影像"
          description={`共 ${total || studies.length} 筆影像檢查。一般影像分享預設 24 小時有效；急診現場請使用「急診資訊」。`}
          actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => router.push(memberHref('/dashboard/imaging/shares', activeMember))}
              className="hk-btn hk-btn-ghost"
              style={{
                minHeight: 44,
              }}
            >
              <Share2 size={17} aria-hidden="true" /> 分享管理
            </button>
            <button
              onClick={() => router.push(memberHref('/dashboard/imaging/upload', activeMember))}
              disabled={!canWriteMember(activeMember)}
              className="hk-btn hk-btn-primary"
              style={{
                minHeight: 44,
              }}
            >
              <Upload size={17} aria-hidden="true" /> 上傳影像
            </button>
          </div>}
        />

        {!canWriteMember(activeMember) && (
          <div style={{ marginBottom: 16 }}><ReadOnlyNotice>{writeAccessReason(activeMember) || '權限仍在確認中，目前只能查看影像。'}</ReadOnlyNotice></div>
        )}

        {/* Member filter */}
        <div className="desktop-only" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>成員</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {memberOptions.map(m => (
              <button key={m} onClick={() => switchMember(m)} style={{
                minHeight: 44, padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                borderColor: filterMember === m ? 'var(--primary)' : 'var(--gray-200)',
                background: filterMember === m ? 'var(--primary)' : '#fff',
                color: filterMember === m ? '#fff' : '#555',
                fontSize: '13px', fontWeight: filterMember === m ? '700' : '500', cursor: 'pointer',
              }}>{m}</button>
            ))}
          </div>
        </div>

        <div role="tablist" aria-label="影像區段" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button type="button" role="tab" aria-selected={section === 'active'} className={`hk-btn ${section === 'active' ? 'hk-btn-primary' : 'hk-btn-ghost'}`} style={{ minHeight: 44 }} onClick={() => setSection('active')}><Images size={17} aria-hidden="true" />目前影像</button>
          <button type="button" role="tab" aria-selected={section === 'deleted'} className={`hk-btn ${section === 'deleted' ? 'hk-btn-primary' : 'hk-btn-ghost'}`} style={{ minHeight: 44 }} onClick={() => setSection('deleted')}><Trash2 size={17} aria-hidden="true" />最近刪除 {deletedStudies.length > 0 ? `(${deletedStudies.length})` : ''}</button>
        </div>

        {operationError && (
          <div role="alert" style={{ background: '#faecea', border: '1px solid #f2d3cf', color: '#a03a30', borderRadius: 12, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 260px', fontSize: 13, fontWeight: 700 }}>{operationError}</span>
            <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" style={{ minHeight: 44 }} onClick={() => setOperationError('')}>關閉</button>
          </div>
        )}

        {/* Share result banner */}
        {shareResult && (
          <div style={{
            background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '12px',
            padding: '16px 20px', marginBottom: '20px',
            display: 'flex', gap: '12px', alignItems: 'flex-start',
          }}>
            <Share2 size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: '700', fontSize: '14px', color: '#2e7d32', marginBottom: '4px' }}>
                分享連結已複製到剪貼簿
              </div>
              <div style={{ fontSize: '12px', color: '#555', wordBreak: 'break-all', marginBottom: '6px' }}>
                {shareResult.share_url}
              </div>
              {shareResult.expires_at && (
                <div style={{ fontSize: '11px', color: '#888' }}>
                  有效期限：{new Date(shareResult.expires_at).toLocaleString('zh-TW')}（24 小時）
                </div>
              )}
              <div style={{ fontSize: '11px', color: '#8a6d3b', marginTop: '4px' }}>
                這是一般影像檢視連結，不包含急診摘要、現場身分確認或急診存取紀錄。
              </div>
            </div>
            <button type="button" aria-label="關閉分享結果" onClick={() => setShareResult(null)} style={{
              background: 'none', border: 'none', color: '#aaa', fontSize: '18px',
              cursor: 'pointer', flexShrink: 0, width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><X size={18} aria-hidden="true" /></button>
          </div>
        )}

        {/* Studies list */}
        {section === 'active' ? (loading && studies.length === 0 ? (
          <AsyncState state="loading" title="正在載入影像檢查…" />
        ) : error && studies.length === 0 ? (
          <AsyncState state="error" title="影像庫暫時無法載入" description={`${error}。這不代表沒有影像，既有資料沒有被移除。`} onRetry={() => { void fetchStudies(); }} />
        ) : studies.length === 0 ? (
          <div><AsyncState state="empty" title="目前沒有影像資料" description="可上傳 DICOM 資料夾、ZIP 壓縮檔或多個 DICOM 檔案。" /><button type="button" className="hk-btn hk-btn-primary" style={{ minHeight: 44, margin: '14px auto 0', display: 'flex' }} disabled={!canWriteMember(activeMember)} onClick={() => router.push(memberHref('/dashboard/imaging/upload', activeMember))}><Upload size={17} aria-hidden="true" />上傳第一份影像</button></div>
        ) : (
          <div>
            {error && <div style={{ marginBottom: 14 }}><AsyncState state="partial" title="目前顯示上一次成功載入的影像" description="重新整理失敗，畫面上的資料可能不是最新狀態。" onRetry={() => { void fetchStudies(); }} /></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {studies.map((study) => {
              const isExpanded = !!expanded[study.id];
              const isDeleting = deletingId === study.id;
              const desc = study.study_description
                || (study.modality ? `${study.modality} 影像` : '未命名檢查');
              const studyMissing = !study.storage_available;

              return (
                <div key={study.id} style={{
                  background: '#fff', borderRadius: '14px',
                  boxShadow: 'var(--shadow-sm)',
                  opacity: isDeleting ? 0.5 : 1, transition: 'opacity 0.2s',
                  overflow: 'hidden',
                }}>
                  {/* Study header row */}
                  <div
                    onClick={() => toggleStudy(study)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '14px',
                      padding: '16px 20px', cursor: 'pointer',
                    }}
                  >
                    {/* Modality badge */}
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0,
                      background: `${modalityColor(study.modality)}15`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexDirection: 'column', gap: '2px',
                    }}>
                      <Images size={21} aria-hidden="true" style={{ color: modalityColor(study.modality) }} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {study.modality && (
                          <span style={{ ...BADGE, background: modalityColor(study.modality) }}>
                            {study.modality}
                          </span>
                        )}
                        <span style={{ fontSize: '15px', fontWeight: '700', color: '#111' }}>
                          {desc}
                        </span>
                        <span style={{ fontSize: '12px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>
                          {study.member_name}
                        </span>
                        {studyMissing && (
                          <span title={MISSING_STORAGE_MESSAGE} style={{ fontSize: '12px', background: '#fdf1e0', color: '#a97614', padding: '2px 8px', borderRadius: '20px', border: '1px solid #fed7aa', fontWeight: 700 }}>
                            需補檔
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          <CalendarDays size={14} aria-hidden="true" style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />{formatDicomDate(study.study_date)}
                        </span>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          {study.series_count} 個序列
                        </span>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          {study.instance_count} 張影像
                        </span>
                        {studyMissing && (
                          <span style={{ fontSize: '12px', color: '#a97614', fontWeight: 700 }}>
                            缺少 {study.missing_instance_count || study.instance_count} 個原始檔
                          </span>
                        )}
                      </div>
                      {studyMissing && (
                        <div style={{ fontSize: '12px', color: '#92400e', marginTop: 6, lineHeight: 1.5 }}>
                          目前只保留影像索引，不能查看或分享。請重新上傳 DICOM，或請系統管理人員協助恢復安全儲存區中的原始檔。
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleShareStudy(study.id, desc)}
                        disabled={sharingId === study.id || studyMissing || !canWriteMember(study.member_name)}
                        title={studyMissing ? MISSING_STORAGE_MESSAGE : '建立影像分享連結'}
                        style={{
                          minHeight: 44, padding: '7px 14px', borderRadius: '8px',
                          border: '1px solid var(--primary)',
                          background: '#fff', color: 'var(--primary)',
                          fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          opacity: sharingId === study.id || studyMissing ? 0.45 : 1,
                        }}
                      >
                        <Share2 size={15} aria-hidden="true" /> {sharingId === study.id ? '建立中…' : '分享'}
                      </button>
                      <button
                        onClick={() => {
                          if (studyMissing) return;
                          setDeleteTarget({ id: study.id, description: desc, member: study.member_name });
                        }}
                        disabled={isDeleting || studyMissing || !canWriteMember(study.member_name)}
                        aria-label={`移到最近刪除：${desc}`}
                        title={studyMissing ? MISSING_STORAGE_MESSAGE : '移到最近刪除'}
                        style={{
                          minWidth: 44, minHeight: 44, padding: '7px 12px', borderRadius: '8px',
                          border: '1px solid var(--gray-200)',
                          background: '#fff', color: '#f44336',
                          fontSize: '12px', cursor: studyMissing ? 'not-allowed' : 'pointer',
                          opacity: isDeleting || studyMissing ? 0.45 : 1,
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>

                    {/* Expand chevron */}
                    <span style={{ color: '#6b7c8c', fontSize: '14px', flexShrink: 0 }} aria-hidden="true">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </span>
                  </div>

                  {/* Series list (expanded) */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--gray-100)', padding: '12px 20px 16px' }}>
                      {seriesLoading[study.id] ? (
                        <div style={{ color: '#bbb', fontSize: '13px', padding: '8px 0' }}>載入序列中...</div>
                      ) : !study.series || study.series.length === 0 ? (
                        <div style={{ color: '#bbb', fontSize: '13px' }}>尚無序列資料</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {study.series.map(series => {
                            const seriesDesc = series.series_description
                              || (series.series_number != null ? `序列 ${series.series_number}` : '未命名序列');
                            const seriesMissing = !series.storage_available;
                            return (
                              <div key={series.id} style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                background: '#f8f9fa', borderRadius: '10px', padding: '10px 14px',
                              }}>
                                {/* Thumbnail */}
                                <div style={{
                                  width: '52px', height: '52px', flexShrink: 0, borderRadius: '8px',
                                  overflow: 'hidden', background: '#1a1a1a',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {seriesMissing ? (
                                    <span title={MISSING_STORAGE_MESSAGE} style={{ color: '#a97614', fontSize: '11px', fontWeight: 800 }}>缺檔</span>
                                  ) : <AuthenticatedThumbnail seriesId={series.id} />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {series.modality && (
                                      <span style={{ ...BADGE, background: modalityColor(series.modality), fontSize: '10px', padding: '1px 6px' }}>
                                        {series.modality}
                                      </span>
                                    )}
                                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#333' }}>
                                      {seriesDesc}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                                    {series.instance_count} 張影像
                                    {series.body_part ? ` · ${series.body_part}` : ''}
                                    {seriesMissing ? ` · 缺少 ${series.missing_instance_count || series.instance_count} 個原始檔` : ''}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                  <button
                                    onClick={() => {
                                      if (seriesMissing) return;
                                      router.push(memberHref(`/dashboard/imaging/viewer/${series.id}`, study.member_name));
                                    }}
                                    disabled={seriesMissing}
                                    title={seriesMissing ? MISSING_STORAGE_MESSAGE : '查看序列'}
                                    style={{
                                      minHeight: 44, padding: '6px 14px', borderRadius: '8px',
                                      background: seriesMissing ? '#e5e7eb' : 'var(--primary)', color: seriesMissing ? '#93a3af' : '#fff',
                                      border: 'none', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                                    }}
                                  >
                                    {seriesMissing ? '需補檔' : <><Eye size={15} aria-hidden="true" /> 查看</>}
                                  </button>
                                  <button
                                    onClick={() => handleShareSeries(series.id, seriesDesc, study.member_name)}
                                    disabled={sharingId === series.id || seriesMissing || !canWriteMember(study.member_name)}
                                    aria-label={`分享序列：${seriesDesc}`}
                                    title={seriesMissing ? MISSING_STORAGE_MESSAGE : '分享序列'}
                                    style={{
                                      minWidth: 44, minHeight: 44, padding: '6px 12px', borderRadius: '8px',
                                      border: '1px solid var(--gray-200)',
                                      background: '#fff', color: '#555',
                                      fontSize: '12px', cursor: 'pointer',
                                      opacity: sharingId === series.id || seriesMissing ? 0.45 : 1,
                                    }}
                                  >
                                    {sharingId === series.id ? '…' : <Share2 size={15} aria-hidden="true" />}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Load More */}
            {studies.length > 0 && studies.length < total && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{
                  width: '100%', padding: '12px', borderRadius: '10px',
                  border: '1px solid var(--gray-200)', background: '#fff',
                  color: '#555', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? '載入中...' : `載入更多（還有 ${total - studies.length} 筆）`}
              </button>
            )}
          </div></div>
        )) : (
          <section aria-labelledby="deleted-imaging-title">
            <h2 id="deleted-imaging-title" style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>最近刪除</h2>
            <p style={{ fontSize: 13, color: '#56687a', lineHeight: 1.6, marginBottom: 16 }}>影像移除後仍保留原始檔，可在這裡復原。為避免已外流連結繼續存取，相關分享會在移除時撤銷，復原影像不會自動恢復分享。</p>
            {deletedLoading && deletedStudies.length === 0 ? <AsyncState state="loading" title="正在載入最近刪除…" /> : deletedError && deletedStudies.length === 0 ? <AsyncState state="error" title="最近刪除暫時無法載入" description="這不代表沒有已移除的影像。" onRetry={() => { void fetchDeletedStudies(); }} /> : deletedStudies.length === 0 ? <AsyncState state="empty" title="最近刪除目前沒有影像" description="從影像庫移除的檢查會出現在這裡，並保留復原入口。" /> : (
              <div>{deletedError && <div style={{ marginBottom: 14 }}><AsyncState state="partial" title="目前顯示上一次成功載入的最近刪除" description="清單可能不是最新狀態。" onRetry={() => { void fetchDeletedStudies(); }} /></div>}<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{deletedStudies.map(study => {
                const description = study.study_description || (study.modality ? `${study.modality} 影像` : '未命名檢查');
                const recoverable = study.recoverable !== false && Boolean(study.storage_available);
                return <article key={study.id} style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><Images size={21} aria-hidden="true" style={{ color: modalityColor(study.modality) }} /><div style={{ flex: '1 1 220px', minWidth: 0 }}><strong style={{ display: 'block' }}>{description}</strong><span style={{ display: 'block', marginTop: 3, fontSize: 12, color: '#687989' }}>{study.member_name} · {formatDicomDate(study.study_date)} · 已於 {study.deleted_at ? new Date(study.deleted_at).toLocaleString('zh-TW') : '最近'}移除</span><span style={{ display: 'block', marginTop: 3, fontSize: 12, color: recoverable ? '#687989' : '#8f342b' }}>{recoverable ? `${study.instance_count} 張影像；原始檔仍保留，可復原。` : '原始影像目前不完整，無法復原；請聯絡支援人員確認保存狀態。'}</span></div>{recoverable ? <button type="button" className="hk-btn hk-btn-ghost" style={{ minHeight: 44 }} disabled={restoringId === study.id || !canWriteMember(study.member_name)} onClick={() => { void restoreStudy(study); }}><RotateCcw size={16} aria-hidden="true" />{restoringId === study.id ? '復原中…' : '復原'}</button> : null}</article>;
              })}</div></div>
            )}
          </section>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { void handleDelete(); }}
        title="移到最近刪除？"
        description={deleteTarget ? `「${deleteTarget.description}」會從影像庫移除，但原始影像仍保留並可復原。與這筆影像相關的分享連結會立即撤銷，復原影像時不會自動恢復分享。` : undefined}
        confirmLabel={deletingId ? '移除中…' : '移到最近刪除'}
        danger
      />
    </div>
  );
}
