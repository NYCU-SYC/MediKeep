'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { useToast } from '../toast-context';
import { ALL_MEMBERS, memberHref, memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';
import { api } from '@/lib/api';

type DocOut = {
  id: string;
  member_name: string;
  doc_type: string;
  file_name: string;
  file_size: number | null;
  note: string | null;
  doc_date: string | null;
  created_at: string;
  status: string;
  processing_status: string;
  processing_status_label: string;
  processing_note: string;
  next_action: string;
  is_verified: boolean;
  linked_to_verified_data: boolean;
};

const DOC_TYPE_INFO: Record<string, { label: string; icon: string; color: string }> = {
  lab_report:   { label: '檢驗報告',   icon: '🧪', color: '#2196f3' },
  prescription: { label: '處方箋',     icon: '💊', color: '#4caf50' },
  discharge:    { label: '出院摘要',   icon: '🏥', color: '#f44336' },
  image:        { label: '影像報告',   icon: '🩻', color: '#9c27b0' },
  nhia_card:    { label: '健保快易通', icon: '🪪', color: '#00796b' },
  other:        { label: '其他文件',   icon: '📄', color: '#607d8b' },
};

const DOC_TYPES_FILTER = ['全部', ...Object.keys(DOC_TYPE_INFO)];

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  uploaded: { bg: '#fdf1e0', color: '#b06a10', border: '#fed7aa' },
  queued: { bg: '#e7f3f5', color: '#33596a', border: '#cfe3e8' },
  extracting: { bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe' },
  needs_review: { bg: '#fefce8', color: '#a97614', border: '#efdfae' },
  confirmed: { bg: '#e7f4ec', color: '#2e8b57', border: '#cfe8da' },
  failed: { bg: '#faecea', color: '#b91c1c', border: '#f2d3cf' },
  rejected: { bg: '#faecea', color: '#8f342b', border: '#f2d3cf' },
  deleted: { bg: '#eef2f5', color: '#6b7c8c', border: '#e3e9ee' },
};

function statusStyle(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.uploaded;
}

function docStatus(doc: DocOut): string {
  return doc.processing_status || doc.status || 'uploaded';
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const { showToast } = useToast();
  const memberFilterOptions = ['全部', ...members.map(m => m.name)];
  const [docs, setDocs] = useState<DocOut[]>([]);
  const [loading, setLoading] = useState(true);
  // Initialise from global activeMember; sync whenever the header chip changes
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');
  const [filterType, setFilterType] = useState('全部');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const switchMember = (member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  // Keep local filter in sync with global member selection
  useEffect(() => {
    setFilterMember(activeMember || '全部');
  }, [activeMember]);

  // Quick-upload state
  const [dragOver, setDragOver] = useState(false);
  const [quickMember, setQuickMember] = useState(activeMember || (members.length === 1 ? members[0]?.name || '' : ''));
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuickMember(activeMember || (members.length === 1 ? members[0]?.name || '' : ''));
  }, [activeMember, members]);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams();
      if (filterMember !== '全部') params.set('member', filterMember);
      const resp = await fetch(`/api/documents?${params}`, { credentials: 'include' });
      if (!resp.ok) throw new Error('documents_load_failed');
      setDocs(await resp.json());
    } catch {
      setLoadError(true);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [filterMember]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這份文件嗎？')) return;
    setDeleting(id);
    try {
      await api.delete(`/api/documents/${id}`);
      setDocs(prev => prev.filter(d => d.id !== id));
      showToast('文件已移除', 'success');
    } catch {
      showToast('移除失敗，文件仍保留在清單中', 'error');
    } finally {
      setDeleting(null);
    }
  };

  // ── View: opens the file in a new browser tab ──────────────────────────────
  const handleView = (id: string) => {
    window.open(`/api/documents/${id}/download`, '_blank', 'noopener');
  };

  // ── Share: Web Share API with clipboard fallback ───────────────────────────
  const handleShare = async (doc: DocOut) => {
    const url = `${window.location.origin}/api/documents/${doc.id}/download`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: doc.file_name, url });
        return;
      } catch {
        // user cancelled or not supported — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(doc.id);
      setTimeout(() => setShareCopied(null), 2500);
    } catch {
      // clipboard not available — show the URL in prompt
      window.prompt('複製以下連結來分享文件：', url);
    }
  };

  const handleQuickUpload = async (file: File) => {
    if (!quickMember) {
      showToast('請先選擇文件所屬家庭成員', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('member_name', quickMember);
      formData.append('doc_type', 'other');
      const resp = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: formData });
      if (resp.ok) {
        const newDoc: DocOut = await resp.json();
        setDocs(prev => [newDoc, ...prev]);
        showToast('文件已收到，接下來會進入系統擷取（OCR）與醫療團隊確認', 'success');
      } else {
        showToast('文件上傳失敗，請確認格式與網路後重試', 'error');
      }
    } catch {
      showToast('文件上傳失敗，請確認格式與網路後重試', 'error');
    } finally {
      setUploading(false);
    }
  };

  const filteredDocs = docs.filter(d => {
    if (filterMember !== '全部' && d.member_name !== filterMember) return false;
    if (filterType !== '全部' && d.doc_type !== filterType) return false;
    return true;
  });
  const statusSummary = useMemo(() => {
    const rows = [
      { key: 'received', label: '已收到', hint: '尚未等於已整理完成', statuses: ['uploaded', 'queued'] },
      { key: 'processing', label: '系統 / CMO 整理中', hint: '擷取或人工 QA 中', statuses: ['extracting', 'needs_review'] },
      { key: 'action', label: '需要你處理', hint: '補件、重傳或查看退件原因', statuses: ['failed', 'rejected'] },
      { key: 'confirmed', label: '可作為摘要依據', hint: '已確認可追溯原始文件', statuses: ['confirmed'] },
    ];
    return rows.map((row) => {
      const count = filteredDocs.filter((doc) => row.statuses.includes(docStatus(doc))).length;
      const tone = row.key === 'action' && count > 0 ? 'danger' : row.key === 'confirmed' ? 'success' : 'info';
      return { ...row, count, tone };
    });
  }, [filteredDocs]);
  const selectedMemberForAction = activeMember || (members.length === 1 ? members[0]?.name || '' : '');
  const fileUploadHref = memberHref('/dashboard/upload', selectedMemberForAction, { tab: 'file' });

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <button onClick={() => router.back()} style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>文件庫</h2>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>{filteredDocs.length} 份文件</p>
          </div>
          <button onClick={() => router.push(fileUploadHref)} style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '10px 20px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
          }}>
            📤 上傳文件
          </button>
        </div>

        {/* Imaging library cross-link */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: '12px',
          padding: '12px 16px', marginBottom: '20px', cursor: 'pointer',
        }}
          onClick={() => router.push('/dashboard/imaging')}
        >
          <span style={{ fontSize: '24px', flexShrink: 0 }}>🩻</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1565c0' }}>需要上傳 DICOM 醫學影像？</div>
            <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>
              前往影像庫，支援 CT / MRI / X-Ray 等 DICOM 格式、自動分組、互動式檢視
            </div>
          </div>
          <span style={{ color: '#1565c0', fontSize: '18px', flexShrink: 0 }}>›</span>
        </div>

        {/* Quick upload drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleQuickUpload(f); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--gray-300)'}`,
            borderRadius: '14px', padding: '24px', textAlign: 'center',
            background: dragOver ? '#e7f1ff' : '#fafafa', cursor: 'pointer',
            marginBottom: '24px', transition: 'all 0.2s',
          }}
        >
          {uploading ? (
            <div style={{ color: '#666', fontSize: '14px' }}>
              上傳中... 這只代表正在傳送檔案，尚未辨識內容
            </div>
          ) : (
            <>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📁</div>
              <div style={{ fontWeight: '600', color: '#555', marginBottom: '4px' }}>拖曳文件到這裡快速上傳</div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '12px' }}>
                支援 PDF、HTML、JPG、PNG；上傳後會先進入待整理狀態
              </div>
              {!quickMember && members.length > 1 && (
                <div style={{ fontSize: '12px', color: '#a97614', fontWeight: 700, marginBottom: '10px' }}>
                  先選擇這份文件屬於哪位家庭成員，再上傳。
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {members.map(m => (
                  <button key={m.name} type="button"
                    onClick={e => { e.stopPropagation(); setQuickMember(m.name); switchMember(m.name); }}
                    style={{
                      padding: '4px 12px', borderRadius: '20px', border: '1px solid',
                      borderColor: quickMember === m.name ? 'var(--primary)' : 'var(--gray-200)',
                      background: quickMember === m.name ? 'var(--primary)' : '#fff',
                      color: quickMember === m.name ? '#fff' : '#555', fontSize: '12px', cursor: 'pointer',
                    }}>{m.name}</button>
                ))}
              </div>
            </>
          )}
          <input ref={fileInputRef} type="file"
            accept=".pdf,.html,.htm,.jpg,.jpeg,.png,.doc,.docx"
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) handleQuickUpload(e.target.files[0]); }} />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <div className="desktop-only">
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>成員</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {memberFilterOptions.map(m => (
                <button key={m} onClick={() => {
                    setFilterMember(m);
                    switchMember(m === '全部' ? ALL_MEMBERS : m);
                  }} style={{
                  padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                  borderColor: filterMember === m ? 'var(--primary)' : 'var(--gray-200)',
                  background: filterMember === m ? 'var(--primary)' : '#fff',
                  color: filterMember === m ? '#fff' : '#555', fontSize: '13px', cursor: 'pointer',
                }}>{m}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>類型</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {DOC_TYPES_FILTER.map(t => {
                const info = t !== '全部' ? DOC_TYPE_INFO[t] : null;
                return (
                  <button key={t} onClick={() => setFilterType(t)} style={{
                    padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                    borderColor: filterType === t ? 'var(--primary)' : 'var(--gray-200)',
                    background: filterType === t ? 'var(--primary)' : '#fff',
                    color: filterType === t ? '#fff' : '#555', fontSize: '13px', cursor: 'pointer',
                  }}>{info ? `${info.icon} ${info.label}` : '全部'}</button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{
          background: '#fdf1e0', border: '1px solid #fed7aa', color: '#b06a10',
          borderRadius: '12px', padding: '12px 16px', marginBottom: '20px',
          fontSize: '13px', lineHeight: 1.6,
        }}>
          文件庫顯示的是原始檔案處理狀態。「已上傳」只代表 HealthKeep 收到檔案；「文件可作為整理依據」也只代表醫療團隊可用此文件整理資料，不代表診斷、治療建議或系統擷取已完成。
        </div>

        {loadError && (
          <div role="alert" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
            background: '#faecea', border: '1px solid #f2d3cf', color: '#b91c1c',
            borderRadius: '12px', padding: '12px 16px', marginBottom: '20px',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>
              文件狀態載入失敗。這不代表沒有文件，請重新載入確認。
            </span>
            <button type="button" onClick={fetchDocs} style={{
              border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c',
              borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: 800, cursor: 'pointer',
            }}>重新載入</button>
          </div>
        )}

        {!loading && !loadError && filteredDocs.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', marginBottom: '20px' }}>
            {statusSummary.map((item) => {
              const bg = item.tone === 'danger' ? '#faecea' : item.tone === 'success' ? '#e7f4ec' : '#f6f9fa';
              const border = item.tone === 'danger' ? '#f2d3cf' : item.tone === 'success' ? '#cfe8da' : '#e3e9ee';
              const color = item.tone === 'danger' ? '#b91c1c' : item.tone === 'success' ? '#2e8b57' : '#22313f';
              return (
                <div key={item.key} style={{
                  background: bg, border: `1px solid ${border}`, borderRadius: '12px',
                  padding: '14px', minHeight: '96px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                    <div style={{ fontSize: '13px', color: '#56687a', fontWeight: 800 }}>{item.label}</div>
                    <div style={{ fontSize: '24px', color, fontWeight: 900 }}>{item.count}</div>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7c8c', marginTop: '8px', lineHeight: 1.5 }}>
                    {item.hint}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Documents grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>載入中...</div>
        ) : loadError ? (
          <div style={{ textAlign: 'center', padding: '56px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontWeight: '800', color: '#8f342b', marginBottom: '8px' }}>目前無法顯示文件庫</div>
            <div style={{ fontSize: '13px', color: '#6b7c8c', lineHeight: 1.6, marginBottom: '18px' }}>
              請先重新載入；若仍失敗，不要把空畫面視為沒有資料。
            </div>
            <button onClick={fetchDocs} style={{
              color: '#fff', border: 'none', background: 'var(--primary)',
              cursor: 'pointer', fontWeight: '700', fontSize: '14px', borderRadius: '10px', padding: '10px 18px',
            }}>重新載入</button>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📂</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>還沒有文件</div>
            <div style={{ fontSize: '13px', color: '#6b7c8c', lineHeight: 1.6, marginBottom: '14px' }}>
              上傳藥袋、檢驗報告或健康存摺後，會在這裡看到「已收到、整理中、需補件、可作為摘要依據」。
            </div>
            <button onClick={() => router.push(fileUploadHref)} style={{
              color: 'var(--primary)', border: 'none', background: 'none',
              cursor: 'pointer', fontWeight: '600', fontSize: '14px',
            }}>+ 上傳第一份文件 →</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {filteredDocs.map(d => {
              const info = DOC_TYPE_INFO[d.doc_type] ?? DOC_TYPE_INFO.other;
              const copied = shareCopied === d.id;
              const st = statusStyle(docStatus(d));
              return (
                <div key={d.id} style={{
                  background: '#fff', borderRadius: '14px', padding: '20px',
                  boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: '12px',
                  opacity: deleting === d.id ? 0.5 : 1, transition: 'opacity 0.2s',
                }}>
                  {/* Icon + badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{
                      width: '48px', height: '48px', borderRadius: '12px',
                      background: `${info.color}15`, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: '24px',
                    }}>
                      {info.icon}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: '11px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>
                        {d.member_name}
                      </span>
                      <span style={{ fontSize: '11px', background: `${info.color}15`, color: info.color, padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>
                        {info.label}
                      </span>
                      <span style={{
                        fontSize: '11px', background: st.bg, color: st.color,
                        border: `1px solid ${st.border}`, padding: '2px 8px',
                        borderRadius: '20px', fontWeight: '700',
                      }}>
                        {d.processing_status_label || '已上傳，等待整理'}
                      </span>
                    </div>
                  </div>

                  {/* File name */}
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>
                      {d.file_name}
                    </div>
                    {d.note && <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>{d.note}</div>}
                  </div>

                  <div style={{
                    background: st.bg, border: `1px solid ${st.border}`, color: st.color,
                    borderRadius: '10px', padding: '10px 12px', fontSize: '12px',
                    lineHeight: 1.45,
                  }}>
                    <div style={{ fontWeight: 800 }}>{d.processing_status_label || '已上傳，等待整理'}</div>
                    <div style={{ marginTop: '3px' }}>{d.processing_note || '檔案已收到，但尚未完成辨識或人工確認。'}</div>
                    <div style={{ marginTop: '3px', color: '#555' }}>{d.next_action || '請等待醫療團隊整理。'}</div>
                  </div>

                  {/* Meta */}
                  <div style={{ fontSize: '12px', color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
                    <span>📅 {fmtDate(d.doc_date)}</span>
                    <span>{fmtSize(d.file_size)}</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', paddingTop: '4px', borderTop: '1px solid var(--gray-100)' }}>
                    <button
                      onClick={() => handleView(d.id)}
                      style={{
                        flex: 1, padding: '7px', borderRadius: '8px',
                        border: '1px solid var(--gray-200)',
                        background: '#fff', color: '#555', fontSize: '12px',
                        cursor: 'pointer', fontWeight: '600',
                      }}>
                      👁 查看
                    </button>
                    <button
                      onClick={() => handleShare(d)}
                      style={{
                        flex: 1, padding: '7px', borderRadius: '8px',
                        border: `1px solid ${copied ? '#4caf50' : 'var(--gray-200)'}`,
                        background: copied ? '#f0fff4' : '#fff',
                        color: copied ? '#4caf50' : '#555',
                        fontSize: '12px', cursor: 'pointer',
                        fontWeight: copied ? '700' : '400',
                        transition: 'all 0.2s',
                      }}>
                      {copied ? '✓ 已複製' : '複製下載連結'}
                    </button>
                    <button
                      onClick={() => handleDelete(d.id)}
                      style={{
                        padding: '7px 10px', borderRadius: '8px',
                        border: '1px solid var(--gray-200)',
                        background: '#fff', color: '#f44336', fontSize: '12px', cursor: 'pointer',
                      }}>
                      🗑
                    </button>
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
