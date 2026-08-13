'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Check, FileStack, Folder, Images, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { useActiveMember } from '../../member-context';
import { useToast } from '../../toast-context';
import { memberHref } from '@/lib/members';
import { PageHeader, ReadOnlyNotice } from '../../_components/Shared';
import { api, getPatientSessionToken } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadMode = 'folder' | 'zip' | 'files';

type ImportSummary = {
  studies_created: number;
  series_created: number;
  instances_imported: number;
  files_skipped: number;
};

type UploadFailure = {
  index: number;
  filename: string;
  code: string;
  message: string;
  retryable: boolean;
  save_state: string;
};

type DicomUploadPolicy = {
  max_files: number;
  max_file_bytes: number;
  max_total_bytes: number;
  max_zip_bytes: number;
  max_zip_entries: number;
  max_zip_expanded_bytes: number;
  max_zip_compression_ratio: number;
  dicom_extensions: string[];
  zip_extensions: string[];
  dicom_content_types: string[];
  zip_content_types: string[];
};

type UploadResult = ImportSummary & {
  studies?: unknown[];
  files_received?: number;
  files_succeeded?: number;
  partial_success?: boolean;
  retryable?: boolean;
  save_state?: string;
  next_action?: string;
  failed_items?: UploadFailure[];
  policy?: DicomUploadPolicy;
};

type FailedBatch = {
  index: number;
  label: string;
  files: File[];
  error: string;
  retryable: boolean;
  retrying: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 20; // files per upload request

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px',
  border: '1px solid var(--gray-300)', fontSize: '14px',
  fontFamily: 'inherit', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: '600', color: '#555',
  marginBottom: '6px', display: 'block',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadAuthHeaders(): HeadersInit | undefined {
  const token = getPatientSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function isDicomUploadPolicy(value: unknown): value is DicomUploadPolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Partial<DicomUploadPolicy>;
  return Number.isFinite(policy.max_files)
    && Number.isFinite(policy.max_file_bytes)
    && Number.isFinite(policy.max_total_bytes)
    && Number.isFinite(policy.max_zip_bytes)
    && Number.isFinite(policy.max_zip_expanded_bytes)
    && Array.isArray(policy.dicom_extensions)
    && Array.isArray(policy.zip_extensions);
}

function dicomDeclarationAllowed(file: File, policy: DicomUploadPolicy): boolean {
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const extension = dot >= 0 ? lower.slice(dot) : '(no extension)';
  return policy.dicom_extensions.includes(extension);
}

function validateDicomSelection(files: File[], policy: DicomUploadPolicy): string | null {
  if (files.length === 0) return '沒有選到可上傳的 DICOM 檔案。';
  const unsupported = files.find(file => !dicomDeclarationAllowed(file, policy));
  if (unsupported) return `「${unsupported.name}」的副檔名不符合伺服器允許的 DICOM 格式。`;
  const oversized = files.find(file => file.size > policy.max_file_bytes);
  if (oversized) return `「${oversized.name}」超過單檔 ${formatBytes(policy.max_file_bytes)} 的限制，尚未保存。`;
  return null;
}

class DicomUploadRequestError extends Error {
  retryable: boolean;
  failedItems: UploadFailure[];

  constructor(message: string, retryable = false, failedItems: UploadFailure[] = []) {
    super(message);
    this.name = 'DicomUploadRequestError';
    this.retryable = retryable;
    this.failedItems = failedItems;
  }
}

/** Parse FastAPI / proxy error responses without losing retry and partial-result metadata. */
async function parseApiError(r: Response): Promise<DicomUploadRequestError> {
  // Read text first — r.json() and r.text() both consume the body stream,
  // so calling r.json() first means r.text() returns empty if JSON.parse fails.
  const text = await r.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    const detail = json.error ?? json.detail;
    const failedItems = (detail?.partial_success?.failed_items ?? detail?.failed_items ?? []) as UploadFailure[];
    const retryable = detail?.retryable === true;
    if (typeof detail?.message === 'string') return new DicomUploadRequestError(detail.message, retryable, failedItems);
    if (typeof detail === 'string') return new DicomUploadRequestError(detail, false, []);
    // FastAPI 422 validation errors: detail is an array of {loc, msg, type}
    if (Array.isArray(json.detail)) {
      return new DicomUploadRequestError(json.detail.map((e: { msg?: string; loc?: string[] }) =>
        `${e.loc?.slice(-1)[0] ?? 'field'}: ${e.msg ?? e}`
      ).join('；'));
    }
    return new DicomUploadRequestError(JSON.stringify(json).slice(0, 300));
  } catch {
    const snippet = text.replace(/<[^>]*>/g, '').trim().slice(0, 200);
    return new DicomUploadRequestError(snippet || `伺服器錯誤（HTTP ${r.status}）`, r.status >= 500);
  }
}

function failedItemsForBatch(batch: File[], failures: UploadFailure[], batchNumber: number): FailedBatch[] {
  return failures.map((failure, position) => {
    const file = batch[failure.index];
    return {
      index: batchNumber * 10_000 + failure.index + position,
      label: failure.filename || file?.name || `批次 ${batchNumber} 的檔案`,
      files: file ? [file] : [],
      error: `${failure.message}${failure.save_state === 'not_saved' ? '（尚未保存）' : ''}`,
      retryable: Boolean(file && failure.retryable),
      retrying: false,
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DicomUploadPage() {
  const router = useRouter();
  const { activeMember, members, canWriteMember, writeAccessReason } = useActiveMember();
  const { showToast } = useToast();

  const [mode, setMode] = useState<UploadMode>('folder');
  const [member, setMember] = useState(activeMember || members[0]?.name || '');
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploadPolicy, setUploadPolicy] = useState<DicomUploadPolicy | null>(null);
  const [policyError, setPolicyError] = useState('');
  const [selectionError, setSelectionError] = useState('');

  // Selected files / zip
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedZip, setSelectedZip] = useState<File | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [failedBatches, setFailedBatches] = useState<FailedBatch[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPolicyError('');
    api.get('/api/dicom/upload-policy')
      .then(value => {
        if (cancelled) return;
        if (!isDicomUploadPolicy(value)) throw new Error('invalid DICOM upload policy');
        setUploadPolicy(value);
      })
      .catch(() => {
        if (cancelled) return;
        setUploadPolicy(null);
        setPolicyError('目前無法確認影像上傳限制，為避免檔案未完整保存，暫時停用選檔與上傳。');
      });
    return () => { cancelled = true; };
  }, []);

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (!uploadPolicy) {
      setSelectionError('尚未取得伺服器限制，這些檔案尚未保存。請重試載入後再選擇。');
      return;
    }
    const list = Array.from(files);
    const validationError = validateDicomSelection(list, uploadPolicy);
    if (validationError) {
      setSelectedFiles([]);
      setSelectionError(validationError);
      return;
    }
    setSelectionError('');
    setSelectedFiles(list);
    setPhase('idle');
    setSummary(null);
  };

  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    if (!uploadPolicy) {
      setSelectionError('尚未取得伺服器限制，這些檔案尚未保存。請重試載入後再選擇。');
      return;
    }
    const list = Array.from(files);
    const validationError = validateDicomSelection(list, uploadPolicy);
    if (validationError) {
      setSelectedFiles([]);
      setSelectionError(validationError);
      return;
    }
    setSelectionError('');
    setSelectedFiles(list);
    setPhase('idle');
    setSummary(null);
  };

  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!uploadPolicy) {
      setSelectionError('尚未取得伺服器限制，ZIP 尚未保存。請重試載入後再選擇。');
      return;
    }
    if (!uploadPolicy.zip_extensions.some(extension => f.name.toLowerCase().endsWith(extension))) {
      setSelectedZip(null);
      setSelectionError('只接受伺服器列出的 ZIP 壓縮檔格式，檔案尚未保存。');
      return;
    }
    if (f.size > uploadPolicy.max_zip_bytes) {
      setSelectedZip(null);
      setSelectionError(`ZIP 超過 ${formatBytes(uploadPolicy.max_zip_bytes)} 的限制，尚未保存。`);
      return;
    }
    setSelectionError('');
    setSelectedZip(f);
    setPhase('idle');
    setSummary(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items);
    const files: File[] = [];

    // Process dropped items (may include directories via webkitGetAsEntry)
    const processEntry = (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        return new Promise(resolve => {
          (entry as FileSystemFileEntry).file(f => { files.push(f); resolve(); });
        });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        return new Promise(resolve => {
          const readAll = () => {
            reader.readEntries(async entries => {
              if (entries.length === 0) { resolve(); return; }
              await Promise.all(entries.map(processEntry));
              readAll();
            });
          };
          readAll();
        });
      }
      return Promise.resolve();
    };

    Promise.all(
      items
        .filter(i => i.kind === 'file')
        .map(i => {
          const entry = i.webkitGetAsEntry();
          if (entry) return processEntry(entry);
          const f = i.getAsFile();
          if (f) files.push(f);
          return Promise.resolve();
        })
    ).then(() => {
      if (!uploadPolicy) {
        setSelectionError('尚未取得伺服器限制，拖入的檔案尚未保存。請重試載入後再選擇。');
        return;
      }
      // Check if it's a zip
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        if (files[0].size > uploadPolicy.max_zip_bytes) {
          setSelectionError(`ZIP 超過 ${formatBytes(uploadPolicy.max_zip_bytes)} 的限制，尚未保存。`);
          return;
        }
        setMode('zip');
        setSelectedZip(files[0]);
      } else {
        const validationError = validateDicomSelection(files, uploadPolicy);
        if (validationError) {
          setSelectedFiles([]);
          setSelectionError(validationError);
          return;
        }
        setMode('files');
        setSelectedFiles(files);
      }
      setSelectionError('');
      setPhase('idle');
      setSummary(null);
    });
  }, [uploadPolicy]);

  // ── Upload logic ────────────────────────────────────────────────────────────

  const uploadZip = async (): Promise<UploadResult> => {
    if (!selectedZip) throw new Error('未選擇 ZIP 檔案');
    const formData = new FormData();
    formData.append('file', selectedZip);
    formData.append('member_name', member);
    if (note.trim()) formData.append('note', note.trim());

    const r = await fetch('/api/dicom/upload-zip', {
      method: 'POST', credentials: 'include', headers: uploadAuthHeaders(), body: formData,
    });
    if (!r.ok) throw await parseApiError(r);
    return r.json();
  };

  const uploadBatch = async (batch: File[]): Promise<UploadResult> => {
    const formData = new FormData();
    batch.forEach(f => formData.append('files', f));
    formData.append('member_name', member);
    if (note.trim()) formData.append('note', note.trim());

    const r = await fetch('/api/dicom/upload', {
      method: 'POST', credentials: 'include', headers: uploadAuthHeaders(), body: formData,
    });
    if (!r.ok) throw await parseApiError(r);
    return r.json();
  };

  const handleUpload = async () => {
    if (!member) { showToast('請先選擇家庭成員', 'error'); return; }
    if (!uploadPolicy) { showToast(policyError || '尚未取得伺服器上傳限制，檔案尚未保存。', 'error'); return; }
    if (!canWriteMember(member)) { showToast(writeAccessReason(member) || '權限仍在確認中，目前只能查看。', 'info'); return; }

    setUploading(true);
    setPhase('uploading');
    setErrorMsg('');
    setUploadedCount(0);
    setFailedBatches([]);

    try {
      if (mode === 'zip') {
        if (!selectedZip) return;
        setTotalCount(1);
        const result = await uploadZip();
        setSummary({
          studies_created: result.studies_created,
          series_created: result.series_created,
          instances_imported: result.instances_imported,
          files_skipped: result.files_skipped,
        });
        setUploadedCount(1);
        const zipFailures = result.failed_items ?? [];
        if (zipFailures.length > 0) {
          setFailedBatches(zipFailures.map((failure, index) => ({
            index: 900_000 + index,
            label: failure.filename,
            files: [],
            error: `${failure.message}（ZIP 內已成功的影像已保存；請修正這個項目後重新製作 ZIP。）`,
            retryable: false,
            retrying: false,
          })));
          showToast(`部分完成：${zipFailures.length} 個 ZIP 內項目未保存。`, 'error');
        } else {
          showToast('ZIP 內可辨識的影像已保存並完成匯入。', 'success');
        }
      } else {
        if (selectedFiles.length === 0) return;
        const batches = chunkArray(selectedFiles, BATCH_SIZE);
        setTotalCount(selectedFiles.length);

        const aggSummary: ImportSummary = {
          studies_created: 0, series_created: 0,
          instances_imported: 0, files_skipped: 0,
        };
        const newFailed: FailedBatch[] = [];

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          try {
            const result = await uploadBatch(batch);
            aggSummary.studies_created  = Math.max(aggSummary.studies_created, result.studies_created);
            aggSummary.series_created  += result.series_created;
            aggSummary.instances_imported += result.instances_imported;
            aggSummary.files_skipped   += result.files_skipped;
            if (result.failed_items?.length) {
              newFailed.push(...failedItemsForBatch(batch, result.failed_items, i + 1));
            }
          } catch (batchErr: unknown) {
            const errMsg = batchErr instanceof Error ? batchErr.message : '批次上傳失敗';
            if (batchErr instanceof DicomUploadRequestError && batchErr.failedItems.length > 0) {
              newFailed.push(...failedItemsForBatch(batch, batchErr.failedItems, i + 1));
            } else {
              newFailed.push({
                index: i + 1,
                label: `批次 ${i + 1}`,
                files: batch,
                error: `${errMsg}（這批尚未確認保存）`,
                retryable: batchErr instanceof DicomUploadRequestError ? batchErr.retryable : true,
                retrying: false,
              });
            }
          }
          setUploadedCount(prev => prev + batch.length);
        }
        setSummary(aggSummary);
        setFailedBatches(newFailed);
        if (newFailed.length > 0) {
          showToast(`部分完成：${newFailed.length} 個批次未保存，可只重試失敗項目。`, 'error');
        } else {
          showToast('全部影像已保存並完成匯入。', 'success');
        }
      }
      setPhase('done');
    } catch (err: unknown) {
      setPhase('error');
      const msg = `${err instanceof Error ? err.message : '上傳過程發生錯誤'}。無法確認是否已有部分影像匯入；請先回影像庫重新載入，再決定是否重試。`;
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  const retryBatch = async (fb: FailedBatch) => {
    if (!fb.retryable || fb.files.length === 0) return;
    setFailedBatches(prev => prev.map(b => b.index === fb.index ? { ...b, retrying: true } : b));
    try {
      const result = await uploadBatch(fb.files);
      setSummary(prev => prev ? {
        studies_created: Math.max(prev.studies_created, result.studies_created),
        series_created: prev.series_created + result.series_created,
        instances_imported: prev.instances_imported + result.instances_imported,
        files_skipped: prev.files_skipped + result.files_skipped,
      } : result);
      if (result.failed_items?.length) {
        const remaining = failedItemsForBatch(fb.files, result.failed_items, fb.index);
        setFailedBatches(prev => [...prev.filter(b => b.index !== fb.index), ...remaining]);
        showToast('仍有失敗項目尚未保存，畫面已只保留這些項目。', 'error');
      } else {
        setFailedBatches(prev => prev.filter(b => b.index !== fb.index));
        showToast(`${fb.label}重試成功`, 'success');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '重試失敗';
      if (err instanceof DicomUploadRequestError && err.failedItems.length > 0) {
        const remaining = failedItemsForBatch(fb.files, err.failedItems, fb.index);
        setFailedBatches(prev => [...prev.filter(b => b.index !== fb.index), ...remaining]);
      } else {
        setFailedBatches(prev => prev.map(b => b.index === fb.index ? { ...b, error: `${errMsg}（尚未保存）`, retryable: err instanceof DicomUploadRequestError ? err.retryable : true, retrying: false } : b));
      }
      showToast(`${fb.label}重試失敗`, 'error');
    }
  };

  // ── Derived display values ──────────────────────────────────────────────────

  const hasSelection = mode === 'zip' ? !!selectedZip : selectedFiles.length > 0;
  const totalSize = mode === 'zip'
    ? (selectedZip?.size ?? 0)
    : selectedFiles.reduce((s, f) => s + f.size, 0);
  const progressPct = totalCount > 0 ? Math.round((uploadedCount / totalCount) * 100) : 0;

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
          <button onClick={() => router.push(memberHref('/dashboard/imaging', activeMember))} aria-label="返回醫療影像" style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div style={{ flex: 1 }}><PageHeader eyebrow="醫學影像" title="上傳影像" description="支援 DICOM 資料夾、ZIP 壓縮檔或多個 DICOM 檔案；每批會保留成功項目，只重試失敗項目。" /></div>
        </div>

        {!canWriteMember(member) && <div style={{ marginBottom: 16 }}><ReadOnlyNotice>{writeAccessReason(member) || '權限仍在確認中，目前只能查看，無法上傳。'}</ReadOnlyNotice></div>}

        <div role="note" style={{ background: '#eff8fc', border: '1px solid #b9d8eb', color: '#174f69', borderRadius: 12, padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.6 }}>
          {uploadPolicy
            ? `伺服器限制：每次最多 ${uploadPolicy.max_files} 個檔案；單檔最多 ${formatBytes(uploadPolicy.max_file_bytes)}，一批總量最多 ${formatBytes(uploadPolicy.max_total_bytes)}；ZIP 最多 ${formatBytes(uploadPolicy.max_zip_bytes)}，解壓後最多 ${formatBytes(uploadPolicy.max_zip_expanded_bytes)}／${uploadPolicy.max_zip_entries} 個項目。伺服器會讀取實際 DICOM 內容，不只看副檔名。`
            : (policyError || '正在取得伺服器上傳限制；完成前暫不開放選檔。')}
        </div>
        {(policyError || selectionError) && <div role="alert" className="hk-card" style={{ borderColor: 'var(--hk-red)', color: 'var(--hk-red)', marginBottom: 16 }}>{selectionError || policyError}</div>}

        {/* Done summary */}
        {phase === 'done' && summary && (
          <div style={{
            background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '14px',
            padding: '24px 28px', marginBottom: '20px',
          }}>
            <Check size={28} aria-hidden="true" style={{ marginBottom: 12, color: '#2e7d32' }} />
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#2e7d32', marginBottom: '12px' }}>
              {failedBatches.length > 0 ? '部分影像已完成匯入' : '影像已完成匯入'}
            </div>
            <p role="status" style={{ fontSize: 13, color: '#3d5a48', lineHeight: 1.6, marginBottom: 14 }}>
              {failedBatches.length > 0 ? '成功項目已保存；下方失敗批次尚未保存，可只重試這些項目。' : '下方數量已由伺服器確認保存；可前往影像庫查看。'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '10px', marginBottom: '20px' }}>
              {[
                { label: '影像檢查', value: summary.studies_created },
                { label: '影像序列', value: summary.series_created },
                { label: '已匯入影像', value: summary.instances_imported },
                { label: '略過（非 DICOM 或重複）', value: summary.files_skipped },
              ].map(item => (
                <div key={item.label} style={{ background: '#fff', borderRadius: '10px', padding: '12px 16px' }}>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#2e7d32' }}>{item.value}</div>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{item.label}</div>
                </div>
              ))}
            </div>
            {/* Failed batches retry */}
            {failedBatches.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#c62828', marginBottom: '8px' }}>
                  {failedBatches.length} 個項目尚未保存
                </div>
                {failedBatches.map(fb => (
                  <div key={fb.index} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: '#ffebee', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#c62828' }}>
                        {fb.label}{fb.files.length > 1 ? `（${fb.files.length} 個檔案）` : ''}
                      </div>
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{fb.error}</div>
                    </div>
                    {fb.retryable && fb.files.length > 0 ? (
                      <button
                        onClick={() => retryBatch(fb)}
                        disabled={fb.retrying || !canWriteMember(member)}
                        style={{
                          minHeight: 44, padding: '6px 14px', borderRadius: '6px',
                          background: '#c62828', color: '#fff', border: 'none',
                          fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                          opacity: fb.retrying ? 0.6 : 1, flexShrink: 0,
                        }}
                      >
                        <RotateCcw size={14} aria-hidden="true" /> {fb.retrying ? '重試中…' : fb.files.length === 1 ? '只重試這個檔案' : '只重試這批'}
                      </button>
                    ) : <span className="hk-badge hk-b-amber">請更換或修正檔案</span>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => router.push(memberHref('/dashboard/imaging', activeMember))} style={{
                flex: 1, minHeight: 44, padding: '12px', borderRadius: '10px',
                background: 'var(--primary)', color: '#fff', border: 'none',
                fontWeight: '700', fontSize: '14px', cursor: 'pointer',
              }}>
                前往影像庫
              </button>
              <button onClick={() => {
                setPhase('idle'); setSummary(null);
                setSelectedFiles([]); setSelectedZip(null);
                setFailedBatches([]);
              }} style={{
                minHeight: 44, padding: '12px 20px', borderRadius: '10px',
                background: '#fff', color: '#555', border: '1px solid var(--gray-200)',
                fontWeight: '600', fontSize: '14px', cursor: 'pointer',
              }}>
                繼續上傳
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div style={{
            background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '12px',
            padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '10px',
          }}>
            <TriangleAlert size={20} aria-hidden="true" style={{ color: '#c62828', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: '700', color: '#c62828' }}>上傳失敗</div>
              <div style={{ fontSize: '13px', color: '#555', marginTop: '4px' }}>{errorMsg}</div>
            </div>
          </div>
        )}

        {/* Main form */}
        {phase !== 'done' && (
          <>
            {/* Member select */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: 'var(--shadow-sm)', marginBottom: '16px' }}>
              <label style={labelStyle}>家庭成員</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {members.map(m => (
                  <button type="button" key={m.name} aria-pressed={member === m.name} onClick={() => setMember(m.name)} style={{
                    minHeight: 44, padding: '8px 20px', borderRadius: '8px', border: '1px solid',
                    borderColor: member === m.name ? 'var(--primary)' : 'var(--gray-200)',
                    background: member === m.name ? '#e7f1ff' : '#fff',
                    color: member === m.name ? 'var(--primary)' : '#555',
                    fontWeight: member === m.name ? '700' : '500', fontSize: '14px', cursor: 'pointer',
                  }}>{m.name}</button>
                ))}
              </div>
            </div>

            {/* Upload mode tabs */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: 'var(--shadow-sm)', marginBottom: '16px' }}>
              <label style={labelStyle}>上傳方式</label>

              {/* Mode selector */}
              <div style={{ display: 'flex', background: '#f0f4f8', borderRadius: '10px', padding: '4px', marginBottom: '20px' }}>
                {([
                  { key: 'folder' as UploadMode, label: '資料夾', desc: '桌機最佳', Icon: Folder },
                  { key: 'zip'    as UploadMode, label: 'ZIP 壓縮檔', desc: '手機推薦', Icon: Archive },
                  { key: 'files'  as UploadMode, label: '多個 DICOM', desc: '個別選取', Icon: FileStack },
                ] as const).map(t => (
                  <button type="button" key={t.key} aria-pressed={mode === t.key} onClick={() => {
                    setMode(t.key);
                    setSelectedFiles([]); setSelectedZip(null);
                    setPhase('idle'); setSummary(null);
                  }} style={{
                    flex: 1, minHeight: 54, padding: '9px 6px', borderRadius: '8px', border: 'none',
                    background: mode === t.key ? '#fff' : 'transparent',
                    color: mode === t.key ? 'var(--primary)' : '#888',
                    fontWeight: mode === t.key ? '700' : '500', fontSize: '13px',
                    cursor: 'pointer', boxShadow: mode === t.key ? 'var(--shadow-sm)' : 'none',
                    transition: 'all 0.15s',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                  }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><t.Icon size={15} aria-hidden="true" />{t.label}</span>
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{t.desc}</span>
                  </button>
                ))}
              </div>

              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                aria-label={mode === 'folder' ? '選擇 DICOM 資料夾' : mode === 'zip' ? '選擇 ZIP 壓縮檔' : '選擇多個 DICOM 檔案'}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => {
                  if (!uploadPolicy) return;
                  if (mode === 'folder')  folderInputRef.current?.click();
                  else if (mode === 'zip') zipInputRef.current?.click();
                  else filesInputRef.current?.click();
                }}
                onKeyDown={event => {
                  if (!uploadPolicy) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  if (mode === 'folder') folderInputRef.current?.click();
                  else if (mode === 'zip') zipInputRef.current?.click();
                  else filesInputRef.current?.click();
                }}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--primary)' : hasSelection ? '#4caf50' : 'var(--gray-300)'}`,
                  borderRadius: '12px', padding: '36px 24px', textAlign: 'center',
                  background: dragOver ? '#e7f1ff' : hasSelection ? '#f0fff4' : '#fafafa',
                  cursor: uploadPolicy ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
                  opacity: uploadPolicy ? 1 : 0.65,
                }}
              >
                {hasSelection ? (
                  <>
                    <div style={{ marginBottom: 8 }}>{mode === 'zip' ? <Archive size={36} aria-hidden="true" /> : <Images size={36} aria-hidden="true" />}</div>
                    {mode === 'zip' && selectedZip ? (
                      <>
                        <div style={{ fontWeight: '700', color: '#2e7d32', fontSize: '15px' }}>
                          {selectedZip.name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                          {formatBytes(selectedZip.size)} · 點擊更換
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: '700', color: '#2e7d32', fontSize: '15px' }}>
                          已選取 {selectedFiles.length} 個 DICOM 檔案
                        </div>
                        <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                          共 {formatBytes(totalSize)} · 點擊更換
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 12 }}>{mode === 'folder' ? <Folder size={40} aria-hidden="true" /> : mode === 'zip' ? <Archive size={40} aria-hidden="true" /> : <Images size={40} aria-hidden="true" />}</div>
                    <div style={{ fontWeight: '700', color: '#444', marginBottom: '6px', fontSize: '15px' }}>
                      {mode === 'folder' ? '拖曳 DICOM 資料夾到這裡，或點擊選取' :
                       mode === 'zip'    ? '拖曳 ZIP 壓縮檔到這裡，或點擊選取' :
                                          '拖曳多個 .dcm 檔案到這裡，或點擊選取'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#aaa' }}>
                      {mode === 'folder' ? '支援整個 DICOM 資料夾，自動識別 Study / Series' :
                       mode === 'zip'    ? '先將 DICOM 資料夾壓縮成 .zip，再上傳' :
                                          '支援 .dcm / .dicom 格式，可選取數百個檔案'}
                    </div>
                  </>
                )}
              </div>

              {/* Hidden inputs */}
              <input
                ref={folderInputRef} type="file" style={{ display: 'none' }}
                // @ts-expect-error — webkitdirectory is non-standard but widely supported
                webkitdirectory="" mozdirectory="" multiple
                disabled={!uploadPolicy}
                onChange={handleFolderSelect}
              />
              <input
                ref={filesInputRef} type="file" style={{ display: 'none' }}
                multiple accept=".dcm,.dicom,application/dicom"
                disabled={!uploadPolicy}
                onChange={handleFilesSelect}
              />
              <input
                ref={zipInputRef} type="file" style={{ display: 'none' }}
                accept=".zip,application/zip"
                disabled={!uploadPolicy}
                onChange={handleZipSelect}
              />
            </div>

            {/* Note */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: 'var(--shadow-sm)', marginBottom: '16px' }}>
              <label htmlFor="dicom-upload-note" style={labelStyle}>備註（選填）</label>
              <textarea
                id="dicom-upload-note"
                placeholder="例：2025/01 胸部 CT 檢查…"
                value={note} onChange={e => setNote(e.target.value)}
                rows={2} style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {/* Upload button + progress */}
            {uploading ? (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
                {mode === 'zip' ? (
                  <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#33596a', fontSize: 13, fontWeight: 700 }}><Upload size={18} aria-hidden="true" />正在傳送並等待伺服器驗證、解壓縮與匯入；尚未完成前不會宣稱已保存。</div>
                ) : (
                  <>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#333', marginBottom: '12px' }}>
                      上傳中 {uploadedCount} / {totalCount} 個檔案
                    </div>
                    <div style={{ background: '#f0f4f8', borderRadius: '8px', height: '8px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', background: 'var(--primary)',
                        width: `${progressPct}%`, transition: 'width 0.3s ease', borderRadius: '8px',
                      }} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '6px', textAlign: 'right' }}>
                      {progressPct}%
                    </div>
                  </>
                )}
                <style>{`
                  @keyframes ellipsis { 0%{content:'.'} 33%{content:'..'} 66%{content:'...'} 100%{content:'.'} }
                `}</style>
              </div>
            ) : (
              <>
                {/* Large ZIP warning */}
                {mode === 'zip' && selectedZip && selectedZip.size > 200 * 1024 * 1024 && (
                  <div style={{
                    background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px',
                    padding: '10px 14px', marginBottom: '12px', fontSize: '12px', color: '#795548',
                    display: 'flex', gap: '8px', alignItems: 'flex-start',
                  }}>
                    <TriangleAlert size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span>
                      此 ZIP 超過 200 MB（{formatBytes(selectedZip.size)}），匯入可能需要數分鐘。
                      上傳期間請勿關閉此頁面。
                    </span>
                  </div>
                )}
                <button
                  onClick={handleUpload}
                  disabled={!uploadPolicy || !hasSelection || !member || !canWriteMember(member)}
                  style={{
                    width: '100%', padding: '15px 24px', borderRadius: '12px',
                    background: 'var(--primary)', color: '#fff', border: 'none',
                    fontSize: '16px', fontWeight: '700', cursor: 'pointer',
                    minHeight: 48, opacity: (!uploadPolicy || !hasSelection || !member || !canWriteMember(member)) ? 0.4 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  <Upload size={18} aria-hidden="true" style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
                  {mode === 'zip' ? '上傳並驗證 ZIP' : `上傳 ${selectedFiles.length > 0 ? `${selectedFiles.length} 個` : ''} DICOM 檔案`}
                </button>
              </>
            )}

            <p style={{ textAlign: 'center', fontSize: '12px', color: '#bbb', marginTop: '10px' }}>
              系統會依 DICOM 內已保存的檢查與序列識別資料分組，不會只用日期推測。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
