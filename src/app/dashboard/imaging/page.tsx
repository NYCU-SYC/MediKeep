'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';

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
  series?: SeriesOut[];
};

type ShareResult = { share_url: string; expires_at: string | null };
type ErrorPayload = {
  detail?: unknown;
  error?: { message?: string; code?: string; details?: unknown };
};
const SHARE_EXPIRY_HOURS = 24;
const MISSING_STORAGE_MESSAGE = '影像原始檔不存在於目前後端環境，請重新上傳 DICOM 或同步 api/uploads/dicom 檔案。';

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
  return fallback;
}

const BADGE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
  fontWeight: '700', color: '#fff', flexShrink: 0,
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ImagingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();

  const [studies, setStudies] = useState<StudyOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seriesLoading, setSeriesLoading] = useState<Record<string, boolean>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<(ShareResult & { label: string }) | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');
  const requestedMemberParam = searchParams.get('member');

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
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: '0' });
      if (filterMember !== '全部') params.set('member', filterMember);
      const r = await fetch(`/api/dicom/studies?${params}`, { credentials: 'include' });
      if (r.ok) {
        const data: StudyOut[] = await r.json();
        setStudies(data);
        setTotal(parseInt(r.headers.get('X-Total-Count') ?? String(data.length), 10));
      } else {
        setStudies([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [filterMember]);

  useEffect(() => { fetchStudies(); }, [fetchStudies]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(studies.length) });
      if (filterMember !== '全部') params.set('member', filterMember);
      const r = await fetch(`/api/dicom/studies?${params}`, { credentials: 'include' });
      if (r.ok) {
        const data: StudyOut[] = await r.json();
        setStudies(prev => [...prev, ...data]);
      }
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
      const r = await fetch(`/api/dicom/studies/${id}`, { credentials: 'include' });
      if (r.ok) {
        const detail: StudyOut & { series: SeriesOut[] } = await r.json();
        setStudies(prev => prev.map(s => s.id === id ? { ...s, series: detail.series } : s));
      }
    } finally {
      setSeriesLoading(s => ({ ...s, [id]: false }));
    }
  };

  const handleDelete = async (studyId: string, desc: string) => {
    if (!confirm(`確定要刪除「${desc}」這筆影像檢查？\n所有影像檔案將一併刪除，此操作無法復原。`)) return;
    setDeletingId(studyId);
    try {
      await fetch(`/api/dicom/studies/${studyId}`, { method: 'DELETE', credentials: 'include' });
      setStudies(prev => prev.filter(s => s.id !== studyId));
    } finally {
      setDeletingId(null);
    }
  };

  const handleShareStudy = async (studyId: string, desc: string) => {
    setSharingId(studyId);
    try {
      const r = await fetch('/api/dicom/share', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ study_id: studyId, expiry_hours: SHARE_EXPIRY_HOURS }),
      });
      if (r.ok) {
        const data = await r.json();
        const shareUrl = `${window.location.origin}/viewer/${data.share_token}`;
        setShareResult({ share_url: shareUrl, expires_at: data.expires_at, label: desc });
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
      } else {
        alert(await readApiError(r, '無法建立分享連結'));
      }
    } finally {
      setSharingId(null);
    }
  };

  const handleShareSeries = async (seriesId: string, desc: string) => {
    setSharingId(seriesId);
    try {
      const r = await fetch('/api/dicom/share', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series_id: seriesId, expiry_hours: SHARE_EXPIRY_HOURS }),
      });
      if (r.ok) {
        const data = await r.json();
        const shareUrl = `${window.location.origin}/viewer/${data.share_token}`;
        setShareResult({ share_url: shareUrl, expires_at: data.expires_at, label: desc });
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
      } else {
        alert(await readApiError(r, '無法建立分享連結'));
      }
    } finally {
      setSharingId(null);
    }
  };

  const memberOptions = ['全部', ...members.map(m => m.name)];

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>影像庫</h2>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>
              共 {total || studies.length} 筆影像檢查
            </p>
            <p style={{ fontSize: '12px', color: '#8a6d3b', marginTop: '6px', lineHeight: 1.5 }}>
              影像分享是一般 DICOM 檢視連結，預設 24 小時有效；急診現場請優先使用「急診保命連結」。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => router.push('/dashboard/imaging/shares')}
              style={{
                background: '#fff', color: '#555', border: '1px solid var(--gray-200)',
                padding: '10px 16px', borderRadius: '10px', fontWeight: '600',
                fontSize: '14px', cursor: 'pointer',
              }}
            >
              🔗 分享管理
            </button>
            <button
              onClick={() => router.push('/dashboard/imaging/upload')}
              style={{
                background: 'var(--primary)', color: '#fff', border: 'none',
                padding: '10px 20px', borderRadius: '10px', fontWeight: '700',
                fontSize: '14px', cursor: 'pointer',
              }}
            >
              + 上傳影像
            </button>
          </div>
        </div>

        {/* Member filter */}
        <div className="desktop-only" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>成員</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {memberOptions.map(m => (
              <button key={m} onClick={() => switchMember(m)} style={{
                padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                borderColor: filterMember === m ? 'var(--primary)' : 'var(--gray-200)',
                background: filterMember === m ? 'var(--primary)' : '#fff',
                color: filterMember === m ? '#fff' : '#555',
                fontSize: '13px', fontWeight: filterMember === m ? '700' : '500', cursor: 'pointer',
              }}>{m}</button>
            ))}
          </div>
        </div>

        {/* Share result banner */}
        {shareResult && (
          <div style={{
            background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '12px',
            padding: '16px 20px', marginBottom: '20px',
            display: 'flex', gap: '12px', alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>🔗</span>
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
                這是影像檢視連結，不包含紅區摘要、醫師 break-glass 或急診存取紀錄。
              </div>
            </div>
            <button onClick={() => setShareResult(null)} style={{
              background: 'none', border: 'none', color: '#aaa', fontSize: '18px',
              cursor: 'pointer', flexShrink: 0,
            }}>×</button>
          </div>
        )}

        {/* Studies list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>載入中...</div>
        ) : studies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🩻</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>尚無影像資料</div>
            <p style={{ fontSize: '14px', color: '#999', marginBottom: '20px' }}>
              上傳 DICOM 資料夾、ZIP 壓縮檔或多個 .dcm 檔案
            </p>
            <button onClick={() => router.push('/dashboard/imaging/upload')} style={{
              background: 'var(--primary)', color: '#fff', border: 'none',
              padding: '12px 28px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer',
            }}>
              上傳第一份影像
            </button>
          </div>
        ) : (
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
                      <span style={{ fontSize: '20px' }}>🩻</span>
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
                          <span title={MISSING_STORAGE_MESSAGE} style={{ fontSize: '12px', background: '#fff7ed', color: '#b45309', padding: '2px 8px', borderRadius: '20px', border: '1px solid #fed7aa', fontWeight: 700 }}>
                            需補檔
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          📅 {formatDicomDate(study.study_date)}
                        </span>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          {study.series_count} 個序列
                        </span>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                          {study.instance_count} 張影像
                        </span>
                        {studyMissing && (
                          <span style={{ fontSize: '12px', color: '#b45309', fontWeight: 700 }}>
                            缺少 {study.missing_instance_count || study.instance_count} 個原始檔
                          </span>
                        )}
                      </div>
                      {studyMissing && (
                        <div style={{ fontSize: '12px', color: '#92400e', marginTop: 6, lineHeight: 1.5 }}>
                          目前只保留影像索引，不能查看或分享。請重新上傳 DICOM，或將原始檔同步到 <code>api/uploads/dicom</code>。
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleShareStudy(study.id, desc)}
                        disabled={sharingId === study.id || studyMissing}
                        title={studyMissing ? MISSING_STORAGE_MESSAGE : '建立影像分享連結'}
                        style={{
                          padding: '7px 14px', borderRadius: '8px',
                          border: '1px solid var(--primary)',
                          background: '#fff', color: 'var(--primary)',
                          fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          opacity: sharingId === study.id || studyMissing ? 0.45 : 1,
                        }}
                      >
                        {sharingId === study.id ? '...' : '🔗 分享'}
                      </button>
                      <button
                        onClick={() => handleDelete(study.id, desc)}
                        disabled={isDeleting}
                        style={{
                          padding: '7px 12px', borderRadius: '8px',
                          border: '1px solid var(--gray-200)',
                          background: '#fff', color: '#f44336',
                          fontSize: '12px', cursor: 'pointer',
                        }}
                      >
                        刪除
                      </button>
                    </div>

                    {/* Expand chevron */}
                    <span style={{ color: '#bbb', fontSize: '14px', flexShrink: 0 }}>
                      {isExpanded ? '▲' : '▼'}
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
                                    <span title={MISSING_STORAGE_MESSAGE} style={{ color: '#b45309', fontSize: '11px', fontWeight: 800 }}>缺檔</span>
                                  ) : (
                                    <img
                                      src={`/api/dicom/series/${series.id}/thumbnail`}
                                      alt=""
                                      loading="lazy"
                                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  )}
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
                                      router.push(`/dashboard/imaging/viewer/${series.id}`);
                                    }}
                                    disabled={seriesMissing}
                                    title={seriesMissing ? MISSING_STORAGE_MESSAGE : '查看序列'}
                                    style={{
                                      padding: '6px 14px', borderRadius: '8px',
                                      background: seriesMissing ? '#e5e7eb' : 'var(--primary)', color: seriesMissing ? '#94a3b8' : '#fff',
                                      border: 'none', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                                    }}
                                  >
                                    {seriesMissing ? '需補檔' : '👁 查看'}
                                  </button>
                                  <button
                                    onClick={() => handleShareSeries(series.id, seriesDesc)}
                                    disabled={sharingId === series.id || seriesMissing}
                                    title={seriesMissing ? MISSING_STORAGE_MESSAGE : '分享序列'}
                                    style={{
                                      padding: '6px 12px', borderRadius: '8px',
                                      border: '1px solid var(--gray-200)',
                                      background: '#fff', color: '#555',
                                      fontSize: '12px', cursor: 'pointer',
                                      opacity: sharingId === series.id || seriesMissing ? 0.45 : 1,
                                    }}
                                  >
                                    {sharingId === series.id ? '...' : '🔗'}
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
          </div>
        )}
      </div>
    </div>
  );
}
