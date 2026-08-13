'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarDays,
  Copy,
  Eye,
  FileImage,
  FileText,
  FlaskConical,
  FolderOpen,
  Hospital,
  IdCard,
  Images,
  Link2,
  Pill,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, ApiError, getPatientSessionToken } from '@/lib/api';
import { ALL_MEMBERS, memberHref, memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';
import { AccessibleDialog, AsyncState, ConfirmDialog, FilePicker, PageHeader, ReadOnlyNotice } from '../_components/Shared';
import { useActiveMember } from '../member-context';
import { useToast } from '../toast-context';

type DocumentItem = {
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
  source?: string | null;
  is_verified: boolean;
  linked_to_verified_data: boolean;
  deleted_at?: string | null;
  recoverable?: boolean;
};

type DeletedDocument = DocumentItem & { deletedAt: string; restoring?: boolean; restoreError?: string };
type DeleteResponse = { deleted_at: string; recoverable: boolean; save_state: string };
type RestoreResponse = { document: DocumentItem; save_state: string };
type DocumentOperation = 'delete' | 'restore';

type DocumentUploadPolicy = {
  max_file_bytes: number;
  max_file_mb: number;
  allowed_extensions: string[];
  allowed_mime_types: string[];
  content_validation: boolean;
};

const DEFAULT_DOCUMENT_POLICY: DocumentUploadPolicy = {
  max_file_bytes: 25 * 1024 * 1024,
  max_file_mb: 25,
  allowed_extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.html', '.htm', '.doc', '.docx'],
  allowed_mime_types: [],
  content_validation: true,
};

const DOC_TYPE_INFO: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  lab_report: { label: '檢驗報告', Icon: FlaskConical, color: '#1565c0' },
  prescription: { label: '處方箋', Icon: Pill, color: '#2e7d32' },
  discharge: { label: '出院摘要', Icon: Hospital, color: '#b91c1c' },
  image: { label: '影像報告', Icon: FileImage, color: '#5a4f8f' },
  nhia_card: { label: '健保快易通', Icon: IdCard, color: '#00796b' },
  other: { label: '其他文件', Icon: FileText, color: '#536776' },
};

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  uploaded: { bg: '#fdf1e0', color: '#8a4b08', border: '#fed7aa' },
  queued: { bg: '#e7f3f5', color: '#33596a', border: '#cfe3e8' },
  extracting: { bg: '#edf4ff', color: '#255ea8', border: '#c8dcfa' },
  needs_review: { bg: '#fefce8', color: '#84610f', border: '#efdfae' },
  confirmed: { bg: '#e7f4ec', color: '#267348', border: '#b7dfc6' },
  failed: { bg: '#faecea', color: '#a03a30', border: '#f2d3cf' },
  rejected: { bg: '#faecea', color: '#8f342b', border: '#f2d3cf' },
};

function isDocumentUploadPolicy(value: unknown): value is DocumentUploadPolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Partial<DocumentUploadPolicy>;
  return Number.isFinite(policy.max_file_bytes)
    && Number.isFinite(policy.max_file_mb)
    && Array.isArray(policy.allowed_extensions)
    && policy.allowed_extensions.every(item => typeof item === 'string');
}

function validateDocumentSelection(file: File, policy: DocumentUploadPolicy): string | null {
  const suffix = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
  if (!policy.allowed_extensions.includes(suffix)) return '此格式不支援。請依畫面列出的格式重新選擇。';
  if (file.size === 0) return '檔案是空的，尚未保存。';
  if (file.size > policy.max_file_bytes) return `檔案超過 ${policy.max_file_mb} MB，尚未保存。`;
  return null;
}

function statusOf(document: DocumentItem) {
  return document.processing_status || document.status || 'uploaded';
}

function formatSize(bytes: number | null) {
  if (!bytes) return '未提供大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return '未提供日期';
  return new Date(value).toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
}

function newDocumentOperationKey(action: DocumentOperation, documentId: string) {
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `document-${action}-${documentId}-${nonce}`;
}

function friendlyUploadError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 413) return '檔案超過 25 MB，未保存。請縮小檔案後再試。';
    if (error.status === 415) return '檔案格式或實際內容不符合限制，未保存。請改用 PDF、JPG、PNG、HTML、DOC 或 DOCX。';
    return `${error.message || '上傳失敗'}${error.saveState === 'saved' ? '；檔案已保存。' : '；檔案尚未保存，請重試。'}`;
  }
  return '網路連線中斷，無法確認檔案是否送達。清單尚未新增，請重新載入後再試。';
}

export default function DocumentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members, canWriteMember, writeAccessReason } = useActiveMember();
  const { showToast } = useToast();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [recentlyDeleted, setRecentlyDeleted] = useState<DeletedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [deletedLoadError, setDeletedLoadError] = useState('');
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');
  const [filterType, setFilterType] = useState('全部');
  const [section, setSection] = useState<'active' | 'deleted'>('active');
  const [uploadMember, setUploadMember] = useState(activeMember || '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadPolicy, setUploadPolicy] = useState<DocumentUploadPolicy | null>(null);
  const [uploadPolicyError, setUploadPolicyError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<DocumentItem | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const requestedDocumentId = searchParams.get('document') || '';
  const requestedMember = searchParams.get('member');
  const sharedDocumentRef = useRef<HTMLDivElement>(null);
  const operationKeysRef = useRef<Map<string, string>>(new Map());

  const operationKey = (action: DocumentOperation, documentId: string) => {
    const key = `${action}:${documentId}`;
    const existing = operationKeysRef.current.get(key);
    if (existing) return existing;
    const created = newDocumentOperationKey(action, documentId);
    operationKeysRef.current.set(key, created);
    return created;
  };

  const retireDocumentLifecycleKeys = (documentId: string) => {
    operationKeysRef.current.delete(`delete:${documentId}`);
    operationKeysRef.current.delete(`restore:${documentId}`);
  };

  useEffect(() => {
    if (requestedMember === null) return;
    const normalized = normalizeMemberName(requestedMember);
    setActiveMember(normalized);
    setFilterMember(normalized || '全部');
  }, [requestedMember, setActiveMember]);

  useEffect(() => {
    setUploadMember(activeMember || (members.length === 1 ? members[0]?.name || '' : ''));
  }, [activeMember, members]);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setDeletedLoadError('');
    setUploadPolicyError('');
    const params: Record<string, string> = filterMember === '全部' ? {} : { member: filterMember };
    const [activeResult, deletedResult, policyResult] = await Promise.allSettled([
      api.get('/api/documents', params),
      api.get('/api/documents', { ...params, deleted: 'true' }),
      api.get('/api/documents/upload-policy'),
    ]);
    if (activeResult.status === 'fulfilled') {
      setDocuments(activeResult.value as DocumentItem[]);
    } else {
      setLoadError(activeResult.reason instanceof Error ? activeResult.reason.message : '文件清單暫時無法載入');
    }
    if (deletedResult.status === 'fulfilled') {
      const deletedRows = deletedResult.value as DocumentItem[];
      setRecentlyDeleted(deletedRows.map(item => ({
        ...item,
        deletedAt: item.deleted_at || new Date().toISOString(),
      })));
    } else {
      setDeletedLoadError(deletedResult.reason instanceof Error ? deletedResult.reason.message : '最近刪除暫時無法載入');
    }
    if (policyResult.status === 'fulfilled' && isDocumentUploadPolicy(policyResult.value)) {
      setUploadPolicy(policyResult.value);
    } else {
      setUploadPolicy(null);
      setUploadPolicyError('目前無法確認伺服器的檔案限制，為避免選到無法安全接收的檔案，暫時停用上傳。');
    }
    setLoading(false);
  }, [filterMember]);

  useEffect(() => { void fetchDocuments(); }, [fetchDocuments]);

  const switchMember = (member: string) => {
    const normalized = member === '全部' ? ALL_MEMBERS : normalizeMemberName(member);
    setFilterMember(member);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  const handleUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploadError('');
    if (!uploadPolicy) {
      setUploadError('尚未取得伺服器檔案限制，檔案尚未保存。請重試載入後再選檔。');
      return;
    }
    const validationError = validateDocumentSelection(file, uploadPolicy);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    if (!uploadMember) {
      setUploadError('請先選擇文件所屬成員；檔案尚未保存。');
      return;
    }
    if (!canWriteMember(uploadMember)) {
      setUploadError(writeAccessReason(uploadMember) || '權限仍在確認中，目前只能查看；檔案尚未保存。');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('member_name', uploadMember);
      form.append('doc_type', 'other');
      const token = getPatientSessionToken();
      const response = await fetch('/api/documents', {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
        const detail = payload?.detail as { message?: string; save_state?: string } | string | undefined;
        throw new ApiError(
          typeof detail === 'object' && detail?.message ? detail.message : '上傳失敗',
          response.status,
          'document_upload_failed',
          detail,
          undefined,
          response.status >= 500,
          null,
          typeof detail === 'object' && detail?.save_state === 'saved' ? 'saved' : 'not_saved',
        );
      }
      const saved = await response.json() as DocumentItem;
      setDocuments(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
      showToast('文件已安全保存；內容整理與醫療確認尚未完成。', 'success');
    } catch (error) {
      setUploadError(friendlyUploadError(error));
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || deletingId) return;
    if (!canWriteMember(target.member_name)) {
      showToast(writeAccessReason(target.member_name) || '目前只能查看，沒有移除文件。', 'info');
      setDeleteTarget(null);
      return;
    }
    setDeletingId(target.id);
    try {
      const result = await api.delete(
        `/api/documents/${target.id}`,
        { idempotencyKey: operationKey('delete', target.id) },
      ) as DeleteResponse;
      const deleted: DeletedDocument = { ...target, deletedAt: result.deleted_at };
      setDocuments(previous => previous.filter(item => item.id !== target.id));
      setRecentlyDeleted(previous => [deleted, ...previous.filter(item => item.id !== target.id)]);
      setDeleteTarget(null);
      showToast('文件已移到最近刪除，原始檔仍保留。', 'success', {
        label: '復原',
        durationMs: 8000,
        onClick: () => { void restoreDocument(deleted); },
      });
    } catch (error) {
      showToast(error instanceof Error ? `${error.message}；文件仍保留在原處。` : '移除失敗；文件仍保留在原處。', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const restoreDocument = async (target: DeletedDocument) => {
    if (target.restoring) return;
    if (!canWriteMember(target.member_name)) {
      showToast(writeAccessReason(target.member_name) || '目前只能查看，無法復原文件。', 'info');
      return;
    }
    setRecentlyDeleted(previous => previous.map(item => item.id === target.id ? { ...item, restoring: true, restoreError: undefined } : item));
    try {
      const result = await api.post(
        `/api/documents/${target.id}/restore`,
        undefined,
        { idempotencyKey: operationKey('restore', target.id) },
      ) as RestoreResponse;
      setRecentlyDeleted(previous => previous.filter(item => item.id !== target.id));
      setDocuments(previous => [result.document, ...previous.filter(item => item.id !== target.id)]);
      // A confirmed restore closes the old delete/restore lifecycle. The next
      // delete is a new logical mutation and therefore must receive a new key.
      retireDocumentLifecycleKeys(target.id);
      showToast('文件已復原並回到文件庫。', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '復原失敗';
      setRecentlyDeleted(previous => previous.map(item => item.id === target.id ? { ...item, restoring: false, restoreError: `${message}；文件仍在最近刪除。` } : item));
    }
  };

  const openShare = async (document: DocumentItem) => {
    const url = `${window.location.origin}${memberHref('/dashboard/documents', document.member_name, { document: document.id })}`;
    setShareTarget(document);
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      showToast('家庭內連結已複製。', 'success');
    } catch {
      // Dialog remains open so keyboard and touch users can copy the visible URL manually.
    }
  };

  const activeDocuments = useMemo(() => documents.filter(document => {
    if (filterMember !== '全部' && document.member_name !== filterMember) return false;
    if (filterType !== '全部' && document.doc_type !== filterType) return false;
    return true;
  }), [documents, filterMember, filterType]);
  const selectedDocument = documents.find(item => item.id === requestedDocumentId) || null;

  useEffect(() => {
    if (!selectedDocument || loading) return;
    const frame = window.requestAnimationFrame(() => {
      sharedDocumentRef.current?.focus({ preventScroll: true });
      sharedDocumentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, selectedDocument]);

  const selectedMemberForAction = activeMember || (members.length === 1 ? members[0]?.name || '' : '');
  const readonlyReason = !canWriteMember(selectedMemberForAction)
    ? writeAccessReason(selectedMemberForAction) || '權限仍在確認中，目前只能查看。'
    : '';

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
        <PageHeader
          eyebrow="紀錄"
          title="文件與報告"
          description="查看上傳、處理與醫療確認狀態；原始文件與整理後的健康資料是不同層次。"
          actions={(
            <button type="button" className="hk-btn hk-btn-primary" style={{ minHeight: 44 }} onClick={() => document.getElementById('document-upload')?.scrollIntoView({ behavior: 'smooth' })} disabled={!canWriteMember(selectedMemberForAction)}>
              <Upload size={18} aria-hidden="true" /> 上傳文件
            </button>
          )}
        />

        {readonlyReason && <div style={{ marginBottom: 16 }}><ReadOnlyNotice>{readonlyReason}</ReadOnlyNotice></div>}

        {requestedDocumentId && !loading && !loadError && (
          selectedDocument ? (
            <div role="status" className="hk-async-state hk-async-partial" style={{ marginBottom: 16 }}>
              <strong>已找到家庭內連結的文件</strong>
              <span>「{selectedDocument.file_name}」只有同家庭且具查看權限的登入者可以開啟。</span>
              <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => window.open(`/api/documents/${selectedDocument.id}/download`, '_blank', 'noopener')}>開啟文件</button>
            </div>
          ) : (
            <AsyncState state="error" title="無法開啟這個家庭內連結" description="文件可能屬於其他家庭、已移除，或連結格式不正確。" />
          )
        )}

        <button type="button" onClick={() => router.push(memberHref('/dashboard/imaging', activeMember))} style={{ width: '100%', minHeight: 64, padding: '12px 16px', marginBottom: 18, borderRadius: 12, border: '1px solid #b9d8eb', background: '#eff8fc', color: '#174f69', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer' }}>
          <Images size={22} aria-hidden="true" />
          <span style={{ flex: 1 }}><strong style={{ display: 'block' }}>要處理 CT、MRI 或 X 光 DICOM？</strong><span style={{ display: 'block', fontSize: 12, marginTop: 3 }}>前往影像庫查看、分享或上傳醫學影像。</span></span>
        </button>

        <section id="document-upload" aria-labelledby="document-upload-title" style={{ background: '#fff', borderRadius: 14, padding: 20, boxShadow: 'var(--shadow-sm)', marginBottom: 20 }}>
          <h2 id="document-upload-title" style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>上傳新文件</h2>
          {uploadPolicy ? (
            <p style={{ color: '#56687a', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              伺服器允許 {uploadPolicy.allowed_extensions.map(value => value.replace('.', '').toUpperCase()).join('、')}，單一檔案最多 {uploadPolicy.max_file_mb} MB。系統會同時檢查副檔名、格式與實際內容。
            </p>
          ) : (
            <div role="alert" style={{ color: 'var(--hk-red)', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              {uploadPolicyError || '正在取得伺服器檔案限制；確認完成前暫不開放選檔。'}
            </div>
          )}
          {members.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="document-member" style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 6 }}>文件屬於哪位成員？</label>
              <select id="document-member" value={uploadMember} onChange={event => setUploadMember(event.target.value)} style={{ minHeight: 44, width: '100%', maxWidth: 320, border: '1px solid var(--gray-300)', borderRadius: 9, padding: '0 12px', background: '#fff' }}>
                <option value="">請選擇成員</option>
                {members.map(member => <option key={member.name} value={member.name}>{member.name}</option>)}
              </select>
            </div>
          )}
          <FilePicker label={uploading ? '正在安全上傳…' : '選擇文件'} accept={uploadPolicy?.allowed_extensions.join(',') || DEFAULT_DOCUMENT_POLICY.allowed_extensions.join(',')} disabled={uploading || !uploadPolicy || !canWriteMember(uploadMember)} helperText="選檔後會立即上傳；成功訊息只代表原始檔已保存，不代表內容已完成整理或醫療確認。" onChange={files => { void handleUpload(files); }} />
          {uploadError && <div role="alert" style={{ marginTop: 12, color: '#a03a30', background: '#faecea', border: '1px solid #f2d3cf', padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 700 }}>{uploadError}</div>}
        </section>

        <div role="tablist" aria-label="文件區段" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button type="button" role="tab" aria-selected={section === 'active'} className={`hk-btn ${section === 'active' ? 'hk-btn-primary' : 'hk-btn-ghost'}`} style={{ minHeight: 44 }} onClick={() => setSection('active')}><FolderOpen size={17} aria-hidden="true" /> 目前文件</button>
          <button type="button" role="tab" aria-selected={section === 'deleted'} className={`hk-btn ${section === 'deleted' ? 'hk-btn-primary' : 'hk-btn-ghost'}`} style={{ minHeight: 44 }} onClick={() => setSection('deleted')}><Trash2 size={17} aria-hidden="true" /> 最近刪除 {recentlyDeleted.length > 0 ? `(${recentlyDeleted.length})` : ''}</button>
        </div>

        {section === 'active' ? (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontSize: 12, fontWeight: 800, color: '#56687a', marginBottom: 6 }}>成員</legend>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{['全部', ...members.map(member => member.name)].map(member => <button type="button" key={member} aria-pressed={filterMember === member} className={`hk-btn ${filterMember === member ? 'hk-btn-primary' : 'hk-btn-ghost'} hk-btn-sm`} style={{ minHeight: 44 }} onClick={() => switchMember(member)}>{member}</button>)}</div>
              </fieldset>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontSize: 12, fontWeight: 800, color: '#56687a', marginBottom: 6 }}>類型</legend>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{['全部', ...Object.keys(DOC_TYPE_INFO)].map(type => <button type="button" key={type} aria-pressed={filterType === type} className={`hk-btn ${filterType === type ? 'hk-btn-primary' : 'hk-btn-ghost'} hk-btn-sm`} style={{ minHeight: 44 }} onClick={() => setFilterType(type)}>{type === '全部' ? '全部' : DOC_TYPE_INFO[type].label}</button>)}</div>
              </fieldset>
            </div>

            {loading && documents.length === 0 ? <AsyncState state="loading" title="正在載入文件與處理狀態…" /> : null}
            {loadError && documents.length === 0 ? <AsyncState state="error" title="文件清單暫時無法載入" description="這不代表沒有文件；任何既有資料都沒有被移除。" onRetry={() => { void fetchDocuments(); }} /> : null}
            {loadError && documents.length > 0 ? <div style={{ marginBottom: 14 }}><AsyncState state="partial" title="目前顯示上一次成功載入的文件" description="重新整理失敗，畫面上的資料可能不是最新狀態。" onRetry={() => { void fetchDocuments(); }} /></div> : null}
            {!loading && !loadError && activeDocuments.length === 0 ? <AsyncState state="empty" title="目前沒有符合條件的文件" description="你可以調整篩選，或依上方限制上傳第一份文件。" /> : null}

            {activeDocuments.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))', gap: 16 }}>
              {activeDocuments.map(document => {
                const info = DOC_TYPE_INFO[document.doc_type] || DOC_TYPE_INFO.other;
                const style = STATUS_STYLE[statusOf(document)] || STATUS_STYLE.uploaded;
                const Icon = info.Icon;
                return (
                  <article key={document.id} ref={document.id === selectedDocument?.id ? sharedDocumentRef : undefined} tabIndex={document.id === selectedDocument?.id ? -1 : undefined} style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: 'var(--shadow-sm)', opacity: deletingId === document.id ? .55 : 1, outline: document.id === selectedDocument?.id ? '3px solid #9ad5b1' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <span style={{ width: 44, height: 44, borderRadius: 11, color: info.color, background: `${info.color}14`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={22} aria-hidden="true" /></span>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}><span className="hk-source-badge hk-source-badge-source">{document.member_name}</span><span className="hk-source-badge hk-source-badge-source">{info.label}</span></div>
                    </div>
                    <h2 style={{ fontSize: 15, fontWeight: 800, marginTop: 12, wordBreak: 'break-word' }}>{document.file_name}</h2>
                    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: style.bg, border: `1px solid ${style.border}`, color: style.color, fontSize: 12, lineHeight: 1.55 }}><strong style={{ display: 'block' }}>{document.processing_status_label || '已上傳，等待整理'}</strong><span>{document.processing_note || '檔案已收到，但尚未完成內容整理。'}</span><span style={{ display: 'block', marginTop: 3 }}>{document.next_action || '目前不需要操作。'}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10, color: '#687989', fontSize: 12 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CalendarDays size={14} aria-hidden="true" />{formatDate(document.doc_date)}</span><span>{formatSize(document.file_size)}</span></div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--gray-100)', flexWrap: 'wrap' }}>
                      <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" style={{ minHeight: 44, flex: 1 }} onClick={() => window.open(`/api/documents/${document.id}/download`, '_blank', 'noopener')}><Eye size={16} aria-hidden="true" />查看</button>
                      <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" style={{ minHeight: 44, flex: 1 }} onClick={() => { void openShare(document); }}><Link2 size={16} aria-hidden="true" />家庭內連結</button>
                      <button type="button" aria-label={`移到最近刪除：${document.file_name}`} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ minWidth: 44, minHeight: 44, color: '#a03a30' }} disabled={!canWriteMember(document.member_name) || deletingId === document.id} onClick={() => setDeleteTarget(document)}><Trash2 size={17} aria-hidden="true" /></button>
                    </div>
                  </article>
                );
              })}
            </div>}
          </>
        ) : (
          <section aria-labelledby="recently-deleted-title">
            <h2 id="recently-deleted-title" style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>最近刪除</h2>
            <p style={{ color: '#56687a', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>本頁會保留你在這次瀏覽期間移除的文件，可立即復原。永久清理不在這裡執行。</p>
            {deletedLoadError && <div style={{ marginBottom: 12 }}><AsyncState state="error" title="最近刪除載入失敗" description={`${deletedLoadError}；這不代表沒有已刪除文件。`} onRetry={() => { void fetchDocuments(); }} /></div>}
            {!deletedLoadError && recentlyDeleted.length === 0 ? <AsyncState state="empty" title="最近沒有移除文件" description="移除的文件會保留在這裡，之後仍可復原。" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{recentlyDeleted.map(document => <div key={document.id} style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><FileText size={20} aria-hidden="true" /><div style={{ flex: '1 1 220px', minWidth: 0 }}><strong style={{ display: 'block', wordBreak: 'break-word' }}>{document.file_name}</strong><span style={{ display: 'block', color: '#687989', fontSize: 12, marginTop: 3 }}>已於 {new Date(document.deletedAt).toLocaleString('zh-TW')} 移除；原始檔仍保留。</span>{document.restoreError && <span role="alert" style={{ display: 'block', color: '#a03a30', fontSize: 12, fontWeight: 700, marginTop: 5 }}>{document.restoreError}</span>}</div><button type="button" className="hk-btn hk-btn-ghost" style={{ minHeight: 44 }} disabled={document.restoring || !canWriteMember(document.member_name)} onClick={() => { void restoreDocument(document); }}><RotateCcw size={16} aria-hidden="true" />{document.restoring ? '復原中…' : '復原'}</button></div>)}</div>
            )}
          </section>
        )}
      </div>

      <ConfirmDialog open={Boolean(deleteTarget)} onCancel={() => setDeleteTarget(null)} onConfirm={() => { void confirmDelete(); }} title="移到最近刪除？" description={deleteTarget ? `「${deleteTarget.file_name}」會從文件庫移除，但原始檔仍會保留，可以復原。` : undefined} confirmLabel={deletingId ? '移除中…' : '移到最近刪除'} danger />

      <AccessibleDialog open={Boolean(shareTarget)} onClose={() => setShareTarget(null)} title="家庭內連結" description="這不是公開分享連結。收件者必須登入同一家庭且具查看權限；家庭權限變更或文件移除後即無法開啟。">
        <label htmlFor="document-share-url" style={{ display: 'block', fontSize: 13, fontWeight: 800, marginBottom: 6 }}>連結</label>
        <input id="document-share-url" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} style={{ width: '100%', minHeight: 44, padding: '8px 10px', border: '1px solid var(--gray-300)', borderRadius: 8, marginBottom: 14 }} />
        <p style={{ fontSize: 12, color: '#687989', lineHeight: 1.6, marginBottom: 14 }}>這類家庭內連結不能單獨撤銷；若不再希望家人開啟，請調整家庭權限或將文件移到最近刪除。</p>
        <div className="hk-dialog-actions"><button type="button" className="hk-btn hk-btn-ghost" onClick={() => setShareTarget(null)}>關閉</button><button type="button" className="hk-btn hk-btn-primary" onClick={() => { void navigator.clipboard.writeText(shareUrl).then(() => showToast('家庭內連結已複製。', 'success')).catch(() => showToast('無法自動複製，請選取畫面上的連結。', 'error')); }}><Copy size={16} aria-hidden="true" />複製連結</button></div>
      </AccessibleDialog>
    </div>
  );
}
