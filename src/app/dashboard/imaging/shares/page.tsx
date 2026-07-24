'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  const [shares, setShares] = useState<ShareOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dicom/shares', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: ShareOut[]) => {
        // Rebuild share_url using current window origin so protocol/host/port are always correct
        const fixed = data.map(s => ({
          ...s,
          share_url: `${window.location.origin}/viewer/${s.share_token}`,
        }));
        setShares(fixed);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (share: ShareOut) => {
    if (!confirm('確定要撤銷此分享連結？對方將無法再使用此連結存取影像。')) return;
    setDeletingId(share.id);
    try {
      await fetch(`/api/dicom/shares/${share.id}`, { method: 'DELETE', credentials: 'include' });
      setShares(prev => prev.filter(s => s.id !== share.id));
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

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <button onClick={() => router.push('/dashboard/imaging')} style={{
            width: '40px', height: '40px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: '800', color: '#111' }}>分享管理</h2>
            <p style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>
              管理您建立的所有影像分享連結
            </p>
          </div>
        </div>

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
          這裡是一般影像 viewer 分享，僅適合讓對方查看 DICOM 影像。急診現場請優先使用「急診保命連結」，因為它會顯示紅區摘要、要求醫師留下身分，並保留急診存取紀錄。
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>載入中...</div>
        ) : shares.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔗</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>尚無分享連結</div>
            <p style={{ fontSize: '14px', color: '#999' }}>
              在影像庫或檢視器中點選「分享」即可建立連結
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {shares.map(share => {
              const expired = isExpired(share);
              const isDeleting = deletingId === share.id;
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
                          {share.study_id ? '📋 整份檢查' : '📂 單一序列'}
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
                        此連結不包含急診紅區、break-glass 身分紀錄或醫師摘要；若不再需要，請立即撤銷。
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      {!expired && (
                        <button
                          onClick={() => handleCopy(share)}
                          style={{
                            padding: '7px 12px', borderRadius: '8px',
                            border: '1px solid var(--primary)', background: '#fff',
                            color: 'var(--primary)', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          }}
                        >
                          {copiedId === share.id ? '✓ 已複製' : '複製'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(share)}
                        disabled={isDeleting}
                        style={{
                          padding: '7px 12px', borderRadius: '8px',
                          border: '1px solid var(--gray-200)', background: '#fff',
                          color: '#f44336', fontSize: '12px', cursor: 'pointer',
                          opacity: isDeleting ? 0.6 : 1,
                        }}
                      >
                        撤銷
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
