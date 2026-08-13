'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clipboard, Files, Link2, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { memberHref } from '@/lib/members';
import { AsyncState, ConfirmDialog, PageHeader, ReadOnlyNotice } from '../../_components/Shared';
import { useActiveMember } from '../../member-context';
import { useToast } from '../../toast-context';

type ShareOut = {
  id: string;
  share_token: string;
  study_id: string | null;
  series_id: string | null;
  expires_at: string | null;
  access_count: number;
  created_at: string;
  share_url: string;
};

export default function SharesPage() {
  const router = useRouter();
  const { activeMember, canWriteMember, writeAccessReason } = useActiveMember();
  const { showToast } = useToast();
  const [shares, setShares] = useState<ShareOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [revokeErrors, setRevokeErrors] = useState<Record<string, string>>({});
  const [revokeTarget, setRevokeTarget] = useState<ShareOut | null>(null);

  const loadShares = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.get('/api/dicom/shares') as ShareOut[];
        // Rebuild share_url using current window origin so protocol/host/port are always correct
        const fixed = data.map(s => ({
          ...s,
          share_url: `${window.location.origin}/viewer/${s.share_token}`,
        }));
        setShares(fixed);
    } catch {
      setLoadError(true);
      // Keep the last successful list. A refresh error is not an empty state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadShares(); }, [loadShares]);

  const handleDelete = async (share: ShareOut) => {
    if (deletingId === share.id) return;
    if (!canWriteMember(activeMember)) {
      showToast(writeAccessReason(activeMember) || '權限仍在確認中，目前不能撤銷分享。', 'info');
      setRevokeTarget(null);
      return;
    }
    setDeletingId(share.id);
    try {
      await api.delete(`/api/dicom/shares/${share.id}`);
      // Keep the row until the server confirms success. Failed revokes remain retryable.
      setShares(prev => prev.filter(s => s.id !== share.id));
      setRevokeErrors(prev => { const next = { ...prev }; delete next[share.id]; return next; });
      setRevokeTarget(null);
      showToast('分享連結已撤銷，對方無法再使用。', 'success');
    } catch (error) {
      setRevokeErrors(prev => ({ ...prev, [share.id]: `${error instanceof Error ? error.message : '撤銷失敗'}；連結仍有效且保留，請重試。` }));
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = async (share: ShareOut) => {
    await navigator.clipboard.writeText(share.share_url).catch(() => {});
    setCopiedId(share.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isExpired = (s: ShareOut) =>
    s.expires_at != null && new Date(s.expires_at) < new Date();

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
          <button onClick={() => router.push(memberHref('/dashboard/imaging', activeMember))} aria-label="返回影像庫" style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div style={{ flex: 1 }}><PageHeader eyebrow="醫學影像" title="分享管理" description="查看有效期限、複製連結或立即撤銷影像檢視權限。" /></div>
        </div>

        {!canWriteMember(activeMember) && <div style={{ marginBottom: 16 }}><ReadOnlyNotice>{writeAccessReason(activeMember) || '權限仍在確認中，目前只能查看分享清單。'}</ReadOnlyNotice></div>}

        <div style={{
          background: '#fdf1e0',
          border: '1px solid #fed7aa',
          color: '#b06a10',
          borderRadius: '12px',
          padding: '12px 14px',
          fontSize: '12px',
          lineHeight: 1.65,
          marginBottom: '18px',
        }}>
          這裡是一般影像檢視分享，只提供 DICOM 影像。急診現場請使用「急診資訊」，以便同時查看重要摘要、確認現場人員身分並保留存取紀錄。
        </div>

        {loading && shares.length === 0 ? (
          <AsyncState state="loading" title="正在載入影像分享…" />
        ) : loadError && shares.length === 0 ? (
          <AsyncState state="error" title="分享清單暫時無法載入" description="這不代表沒有分享連結；請重新載入確認。" onRetry={() => { void loadShares(); }} />
        ) : shares.length === 0 ? (
          <AsyncState state="empty" title="目前沒有分享連結" description="在影像庫或檢視器中選擇「分享」即可建立有期限的連結。" />
        ) : (
          <div>{loadError && <div style={{ marginBottom: 14 }}><AsyncState state="partial" title="目前顯示上一次成功載入的分享" description="重新整理失敗，連結狀態可能不是最新資料。" onRetry={() => { void loadShares(); }} /></div>}<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {shares.map(share => {
              const expired = isExpired(share);
              const isDeleting = deletingId === share.id;
              const revokeError = revokeErrors[share.id];
              return (
                <div key={share.id} style={{
                  background: '#fff', borderRadius: '12px', boxShadow: 'var(--shadow-sm)',
                  padding: '16px 20px', opacity: isDeleting ? 0.5 : 1,
                  transition: 'opacity 0.2s',
                  borderLeft: `4px solid ${expired ? '#ef9a9a' : '#81c784'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Type badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
                          borderRadius: '10px', fontSize: '11px', fontWeight: '700',
                          background: share.study_id ? '#e3f2fd' : '#f3e5f5',
                          color: share.study_id ? '#1565c0' : '#6a1b9a',
                        }}>
                          {share.study_id ? <><Files size={13} aria-hidden="true" /> 整份檢查</> : <><Link2 size={13} aria-hidden="true" /> 單一序列</>}
                        </span>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
                          borderRadius: '10px', fontSize: '11px', fontWeight: '600',
                          background: expired ? '#ffebee' : '#e8f5e9',
                          color: expired ? '#c62828' : '#2e7d32',
                        }}>
                          {expired ? '已過期' : '有效'}
                        </span>
                      </div>

                      {/* URL */}
                      <div style={{
                        fontSize: '12px', color: '#666', wordBreak: 'break-all',
                        marginBottom: '6px', fontFamily: 'monospace',
                      }}>
                        {share.share_url}
                      </div>

                      {/* Meta info */}
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', color: '#999' }}>
                          建立：{formatDate(share.created_at)}
                        </span>
                        {share.expires_at && (
                          <span style={{ fontSize: '11px', color: expired ? '#ef5350' : '#999' }}>
                            到期：{new Date(share.expires_at).toLocaleString('zh-TW')}
                          </span>
                        )}
                        <span style={{ fontSize: '11px', color: '#999' }}>
                          存取次數：{share.access_count}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#8a6d3b', marginTop: '8px', lineHeight: 1.5 }}>
                        此連結不包含急診摘要、現場身分確認或醫療人員摘要；若不再需要，請立即撤銷。
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {!expired && (
                        <button type="button"
                          onClick={() => handleCopy(share)}
                          style={{
                            minHeight: 44, padding: '7px 12px', borderRadius: '8px',
                            border: '1px solid var(--primary)', background: '#fff',
                            color: 'var(--primary)', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          }}
                        >
                          <Clipboard size={15} aria-hidden="true" /> {copiedId === share.id ? '已複製' : '複製'}
                        </button>
                      )}
                      <button type="button"
                        onClick={() => setRevokeTarget(share)}
                        disabled={isDeleting || !canWriteMember(activeMember)}
                        style={{
                          minHeight: 44, padding: '7px 12px', borderRadius: '8px',
                          border: '1px solid var(--gray-200)', background: '#fff',
                          color: '#f44336', fontSize: '12px', cursor: 'pointer',
                          opacity: isDeleting ? 0.6 : 1,
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" /> {isDeleting ? '撤銷中…' : revokeError ? '重試撤銷' : '撤銷'}
                      </button>
                    </div>
                  </div>
                  {revokeError && <div role="alert" style={{ color: '#b91c1c', fontSize: 12, fontWeight: 700, marginTop: 10 }}>{revokeError}</div>}
                </div>
              );
            })}
          </div></div>
        )}
      </div>
      <ConfirmDialog open={Boolean(revokeTarget)} onCancel={() => setRevokeTarget(null)} onConfirm={() => { if (revokeTarget) void handleDelete(revokeTarget); }} title="撤銷這個分享連結？" description="撤銷後，任何持有此連結的人都無法再查看影像。影像本身不會被刪除，撤銷無法復原。" confirmLabel={deletingId ? '撤銷中…' : '撤銷分享'} danger />
    </div>
  );
}
