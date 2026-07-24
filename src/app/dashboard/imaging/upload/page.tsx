'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveMember } from '../../member-context';
import { useToast } from '../../toast-context';

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadMode = 'folder' | 'zip' | 'files';

type ImportSummary = {
  studies_created: number;
  series_created: number;
  instances_imported: number;
  files_skipped: number;
};

type FailedBatch = {
  index: number;
  files: File[];
  error: string;
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

/** Parse FastAPI / proxy error responses and return a human-readable string. */
async function parseApiError(r: Response): Promise<string> {
  // Read text first — r.json() and r.text() both consume the body stream,
  // so calling r.json() first means r.text() returns empty if JSON.parse fails.
  const text = await r.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    if (typeof json.detail === 'string') return json.detail;
    // FastAPI 422 validation errors: detail is an array of {loc, msg, type}
    if (Array.isArray(json.detail)) {
      return json.detail.map((e: { msg?: string; loc?: string[] }) =>
        `${e.loc?.slice(-1)[0] ?? 'field'}: ${e.msg ?? e}`
      ).join('；');
    }
    return JSON.stringify(json).slice(0, 300);
  } catch {
    const snippet = text.replace(/<[^>]*>/g, '').trim().slice(0, 200);
    return snippet || `伺服器錯誤（HTTP ${r.status}）`;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DicomUploadPage() {
  const router = useRouter();
  const { activeMember, members } = useActiveMember();
  const { showToast } = useToast();

  const [mode, setMode] = useState<UploadMode>('folder');
  const [member, setMember] = useState(activeMember || members[0]?.name || '');
  const [note, setNote] = useState('');
  const [dragOver, setDragOver] = useState(false);

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
  // ZIP-specific: staged progress message
  const [zipStage, setZipStage] = useState<'uploading' | 'extracting' | 'importing'>('uploading');
  const zipStageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    // Filter for .dcm files and files without extension (standard DICOM)
    const list = Array.from(files).filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.dcm') || name.endsWith('.dicom') || !name.includes('.');
    });
    setSelectedFiles(list);
    setPhase('idle');
    setSummary(null);
  };

  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setSelectedFiles(Array.from(files));
    setPhase('idle');
    setSummary(null);
  };

  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setSelectedZip(f); setPhase('idle'); setSummary(null); }
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
      // Check if it's a zip
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        setMode('zip');
        setSelectedZip(files[0]);
      } else {
        setMode('files');
        setSelectedFiles(files.filter(f => {
          const n = f.name.toLowerCase();
          return n.endsWith('.dcm') || n.endsWith('.dicom') || !n.includes('.');
        }));
      }
      setPhase('idle');
      setSummary(null);
    });
  }, []);

  // ── Upload logic ────────────────────────────────────────────────────────────

  const uploadZip = async (): Promise<ImportSummary & { studies: unknown[] }> => {
    if (!selectedZip) throw new Error('未選擇 ZIP 檔案');
    const formData = new FormData();
    formData.append('file', selectedZip);
    formData.append('member_name', member);
    if (note.trim()) formData.append('note', note.trim());

    const r = await fetch('/api/dicom/upload-zip', {
      method: 'POST', credentials: 'include', body: formData,
    });
    if (!r.ok) throw new Error(await parseApiError(r));
    return r.json();
  };

  const uploadBatch = async (batch: File[]): Promise<ImportSummary> => {
    const formData = new FormData();
    batch.forEach(f => formData.append('files', f));
    formData.append('member_name', member);
    if (note.trim()) formData.append('note', note.trim());

    const r = await fetch('/api/dicom/upload', {
      method: 'POST', credentials: 'include', body: formData,
    });
    if (!r.ok) throw new Error(await parseApiError(r));
    return r.json();
  };

  const handleUpload = async () => {
    if (!member) { showToast('請先選擇家庭成員', 'error'); return; }

    setUploading(true);
    setPhase('uploading');
    setErrorMsg('');
    setUploadedCount(0);
    setFailedBatches([]);

    try {
      if (mode === 'zip') {
        if (!selectedZip) return;
        setTotalCount(1);
        setZipStage('uploading');

        // Simulate server-side stage progression so the user sees feedback
        // Stage timing is based on typical ZIP sizes:
        //   uploading  → first 40 % of estimated time
        //   extracting → next 20 %
        //   importing  → remaining (can take longest for many files)
        const sizeMB = selectedZip.size / (1024 * 1024);
        const estSeconds = Math.max(10, sizeMB * 0.8);   // rough estimate
        if (zipStageTimer.current) clearTimeout(zipStageTimer.current);
        zipStageTimer.current = setTimeout(
          () => setZipStage('extracting'),
          estSeconds * 400,   // 40% mark
        );
        setTimeout(
          () => setZipStage('importing'),
          estSeconds * 600,   // 60% mark
        );

        const result = await uploadZip();
        if (zipStageTimer.current) clearTimeout(zipStageTimer.current);
        setSummary({
          studies_created: result.studies_created,
          series_created: result.series_created,
          instances_imported: result.instances_imported,
          files_skipped: result.files_skipped,
        });
        setUploadedCount(1);
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
          } catch (batchErr: unknown) {
            const errMsg = batchErr instanceof Error ? batchErr.message : '批次上傳失敗';
            newFailed.push({ index: i + 1, files: batch, error: errMsg, retrying: false });
          }
          setUploadedCount(prev => prev + batch.length);
        }
        setSummary(aggSummary);
        setFailedBatches(newFailed);
        if (newFailed.length > 0) {
          showToast(`${newFailed.length} 個批次上傳失敗，可個別重試`, 'error');
        }
      }
      setPhase('done');
      if (failedBatches.length === 0) showToast('影像匯入完成', 'success');
    } catch (err: unknown) {
      setPhase('error');
      const msg = err instanceof Error ? err.message : '上傳過程發生錯誤';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  const retryBatch = async (fb: FailedBatch) => {
    setFailedBatches(prev => prev.map(b => b.index === fb.index ? { ...b, retrying: true } : b));
    try {
      const result = await uploadBatch(fb.files);
      setSummary(prev => prev ? {
        studies_created: Math.max(prev.studies_created, result.studies_created),
        series_created: prev.series_created + result.series_created,
        instances_imported: prev.instances_imported + result.instances_imported,
        files_skipped: prev.files_skipped + result.files_skipped,
      } : result);
      setFailedBatches(prev => prev.filter(b => b.index !== fb.index));
      showToast(`批次 ${fb.index} 重試成功`, 'success');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '重試失敗';
      setFailedBatches(prev => prev.map(b => b.index === fb.index ? { ...b, error: errMsg, retrying: false } : b));
      showToast(`批次 ${fb.index} 重試失敗`, 'error');
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

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
          <button onClick={() => router.back()} style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: '800', color: '#111', lineHeight: 1.1 }}>
              上傳醫學影像
            </h2>
            <p style={{ fontSize: '13px', color: '#888', marginTop: '3px' }}>
              支援 DICOM 資料夾、ZIP 壓縮檔、多個 .dcm 檔案
            </p>
          </div>
        </div>

        {/* Done summary */}
        {phase === 'done' && summary && (
          <div style={{
            background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '14px',
            padding: '24px 28px', marginBottom: '20px',
          }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>✅</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#2e7d32', marginBottom: '12px' }}>
              匯入完成！
            </div>
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
                  {failedBatches.length} 個批次上傳失敗
                </div>
                {failedBatches.map(fb => (
                  <div key={fb.index} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: '#ffebee', borderRadius: '8px', padding: '10px 14px', marginBottom: '6px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#c62828' }}>
                        批次 {fb.index}（{fb.files.length} 個檔案）
                      </div>
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{fb.error}</div>
                    </div>
                    <button
                      onClick={() => retryBatch(fb)}
                      disabled={fb.retrying}
                      style={{
                        padding: '6px 14px', borderRadius: '6px',
                        background: '#c62828', color: '#fff', border: 'none',
                        fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                        opacity: fb.retrying ? 0.6 : 1, flexShrink: 0,
                      }}
                    >
                      {fb.retrying ? '重試中...' : '重試'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => router.push('/dashboard/imaging')} style={{
                flex: 1, padding: '12px', borderRadius: '10px',
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
                padding: '12px 20px', borderRadius: '10px',
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
            <span>❌</span>
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
                  <button key={m.name} onClick={() => setMember(m.name)} style={{
                    padding: '8px 20px', borderRadius: '8px', border: '1px solid',
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
                  { key: 'folder' as UploadMode, label: '📁 資料夾', desc: '桌機最佳' },
                  { key: 'zip'    as UploadMode, label: '📦 ZIP 壓縮檔', desc: '手機推薦' },
                  { key: 'files'  as UploadMode, label: '📄 多個 .dcm', desc: '備援' },
                ] as const).map(t => (
                  <button key={t.key} onClick={() => {
                    setMode(t.key);
                    setSelectedFiles([]); setSelectedZip(null);
                    setPhase('idle'); setSummary(null);
                  }} style={{
                    flex: 1, padding: '9px 6px', borderRadius: '8px', border: 'none',
                    background: mode === t.key ? '#fff' : 'transparent',
                    color: mode === t.key ? 'var(--primary)' : '#888',
                    fontWeight: mode === t.key ? '700' : '500', fontSize: '13px',
                    cursor: 'pointer', boxShadow: mode === t.key ? 'var(--shadow-sm)' : 'none',
                    transition: 'all 0.15s',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                  }}>
                    <span>{t.label}</span>
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{t.desc}</span>
                  </button>
                ))}
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => {
                  if (mode === 'folder')  folderInputRef.current?.click();
                  else if (mode === 'zip') zipInputRef.current?.click();
                  else filesInputRef.current?.click();
                }}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--primary)' : hasSelection ? '#4caf50' : 'var(--gray-300)'}`,
                  borderRadius: '12px', padding: '36px 24px', textAlign: 'center',
                  background: dragOver ? '#e7f1ff' : hasSelection ? '#f0fff4' : '#fafafa',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {hasSelection ? (
                  <>
                    <div style={{ fontSize: '36px', marginBottom: '8px' }}>
                      {mode === 'zip' ? '📦' : '🩻'}
                    </div>
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
                    <div style={{ fontSize: '44px', marginBottom: '12px' }}>
                      {mode === 'folder' ? '📁' : mode === 'zip' ? '📦' : '🩻'}
                    </div>
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
                onChange={handleFolderSelect}
              />
              <input
                ref={filesInputRef} type="file" style={{ display: 'none' }}
                multiple accept=".dcm,.dicom,application/dicom"
                onChange={handleFilesSelect}
              />
              <input
                ref={zipInputRef} type="file" style={{ display: 'none' }}
                accept=".zip,application/zip"
                onChange={handleZipSelect}
              />
            </div>

            {/* Note */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: 'var(--shadow-sm)', marginBottom: '16px' }}>
              <label style={labelStyle}>備註（選填）</label>
              <textarea
                placeholder="例：2025/01 胸部 CT 檢查…"
                value={note} onChange={e => setNote(e.target.value)}
                rows={2} style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {/* Upload button + progress */}
            {uploading ? (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
                {mode === 'zip' ? (
                  <>
                    {/* ZIP stages */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                      {(
                        [
                          { key: 'uploading',   icon: '📤', label: '上傳 ZIP 至伺服器' },
                          { key: 'extracting',  icon: '📂', label: '解壓縮中' },
                          { key: 'importing',   icon: '🩻', label: '匯入 DICOM 資料庫' },
                        ] as const
                      ).map(({ key, icon, label }) => {
                        const stageIdx = { uploading: 0, extracting: 1, importing: 2 };
                        const current = stageIdx[zipStage];
                        const mine = stageIdx[key];
                        const done = mine < current;
                        const active = mine === current;
                        return (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{
                              width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: done ? '#e8f5e9' : active ? '#e7f1ff' : '#f5f5f5',
                              fontSize: '14px',
                            }}>
                              {done ? '✓' : icon}
                            </div>
                            <span style={{
                              fontSize: '13px',
                              fontWeight: active ? '700' : '400',
                              color: done ? '#4caf50' : active ? 'var(--primary)' : '#bbb',
                            }}>
                              {label}
                              {active && (
                                <span style={{ marginLeft: '6px', animation: 'ellipsis 1.5s steps(4, end) infinite' }}>…</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ background: '#f0f4f8', borderRadius: '8px', height: '6px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', background: 'var(--primary)', borderRadius: '8px',
                        width: zipStage === 'uploading' ? '33%' : zipStage === 'extracting' ? '60%' : '85%',
                        transition: 'width 1s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px', textAlign: 'center' }}>
                      大型 ZIP 可能需要數分鐘，請耐心等候
                    </div>
                  </>
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
                    <span style={{ flexShrink: 0 }}>⚠️</span>
                    <span>
                      此 ZIP 超過 200 MB（{formatBytes(selectedZip.size)}），匯入可能需要數分鐘。
                      上傳期間請勿關閉此頁面。
                    </span>
                  </div>
                )}
                <button
                  onClick={handleUpload}
                  disabled={!hasSelection || !member}
                  style={{
                    width: '100%', padding: '15px 24px', borderRadius: '12px',
                    background: 'var(--primary)', color: '#fff', border: 'none',
                    fontSize: '16px', fontWeight: '700', cursor: 'pointer',
                    opacity: (!hasSelection || !member) ? 0.4 : 1,
                    transition: 'opacity 0.2s',
                  }}
                >
                  {mode === 'zip'
                    ? '📤 上傳並解析 ZIP'
                    : `📤 上傳 ${selectedFiles.length > 0 ? `${selectedFiles.length} 個` : ''} DICOM 檔案`}
                </button>
              </>
            )}

            <p style={{ textAlign: 'center', fontSize: '12px', color: '#bbb', marginTop: '10px' }}>
              系統將自動依 Study / Series 分組，您不需要手動整理
            </p>
          </>
        )}
      </div>
    </div>
  );
}
