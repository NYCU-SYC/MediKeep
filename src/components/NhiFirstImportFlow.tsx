'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import {
  completeNhiImportWithManifest,
  completeNhiOnboarding,
  createNhiImportWithManifest,
  getNhiUploadPolicy,
  getNhiImportJob,
  NhiOnboardingState,
  NhiUploadManifest,
  NhiUploadPolicy,
  uploadNhiImportTarget,
} from '@/lib/nhiImports';

type Member = { name: string };

type Props = {
  memberName: string;
  members: Member[];
  onMemberChange: (memberName: string) => void;
  onBack: () => void;
  nextPath?: string;
  onComplete?: (state: NhiOnboardingState) => void;
  completeOnboarding?: boolean;
};

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function selectionError(files: File[], policy: NhiUploadPolicy): string {
  if (files.length === 0) return '請選擇健保存摺 HTML，或包含 HTML 的單一 ZIP。';
  if (files.length > policy.max_files) return `一次最多選擇 ${policy.max_files} 個檔案。`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > policy.max_total_bytes) return `檔案總大小不可超過 ${formatSize(policy.max_total_bytes)}。`;
  const allowed = new Set(policy.allowed_extensions.map(value => value.replace(/^\./, '').toLowerCase()));
  const suffixes = files.map(file => extension(file.name));
  if (suffixes.some(suffix => !allowed.has(suffix))) {
    return 'v1 僅接受 .html、.htm，或單一 .zip；不接受 PDF、影像與 Office 文件。';
  }
  const zipCount = suffixes.filter((suffix) => suffix === 'zip').length;
  if (policy.zip_must_be_single && zipCount > 0 && (zipCount !== 1 || files.length !== 1)) return 'ZIP 必須單獨上傳，不能與 HTML 混合。';
  const names = files.map((file) => file.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) return '檔名不可重複，請先重新命名後再選擇。';
  return '';
}

async function validateMagic(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const suffix = extension(file.name);
  if (suffix === 'zip') {
    const valid = bytes.length >= 4
      && bytes[0] === 0x50
      && bytes[1] === 0x4b
      && ((bytes[2] === 0x03 && bytes[3] === 0x04)
        || (bytes[2] === 0x05 && bytes[3] === 0x06)
        || (bytes[2] === 0x07 && bytes[3] === 0x08));
    if (!valid) throw new Error(`${file.name} 不是有效的 ZIP 檔案。`);
    return;
  }
  // HTML element names are ASCII in both UTF-8 and CP950, so a byte-wise
  // Latin-1 view is enough for a client-side preflight. The server validates
  // the actual encoding and content again before accepting the upload.
  const preview = new TextDecoder('windows-1252').decode(bytes).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (!preview.startsWith('<!doctype html') && !preview.includes('<html') && !preview.includes('<table')) {
    throw new Error(`${file.name} 的內容不像健保存摺 HTML。`);
  }
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function idempotencyKey(files: File[], memberName: string): Promise<string> {
  const parts = await Promise.all(files.map(async (file) => `${file.name}:${file.size}:${await sha256Hex(file)}`));
  const data = new TextEncoder().encode(`${memberName}\n${parts.sort().join('\n')}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return `nhi-${hex}`;
}

function apiErrorJobId(error: unknown): string {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object') return '';
  const details = error.details as Record<string, unknown>;
  const value = details.job_id ?? details.import_job_id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export default function NhiFirstImportFlow({ memberName, members, onMemberChange, onBack, nextPath = '/dashboard', onComplete, completeOnboarding = false }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [noFileConfirmed, setNoFileConfirmed] = useState(false);
  const [uploadPolicy, setUploadPolicy] = useState<NhiUploadPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState('');

  const loadUploadPolicy = async () => {
    setPolicyLoading(true);
    setPolicyError('');
    try {
      setUploadPolicy(await getNhiUploadPolicy());
    } catch {
      setUploadPolicy(null);
      setPolicyError('目前無法確認伺服器的檔案限制，因此尚未選擇或上傳任何檔案。');
    } finally {
      setPolicyLoading(false);
    }
  };

  useEffect(() => { void loadUploadPolicy(); }, []);

  const chooseFiles = (next: File[]) => {
    if (!uploadPolicy) {
      setFiles([]);
      setError('請先等候伺服器確認檔案限制。');
      return;
    }
    const problem = selectionError(next, uploadPolicy);
    setFiles(problem ? [] : next);
    setConfirmed(false);
    setNoFileConfirmed(false);
    setError(problem);
    setStatus('');
  };

  const startImport = async () => {
    if (!uploadPolicy) { setError('尚未取得伺服器檔案限制，未上傳任何資料。'); return; }
    const problem = selectionError(files, uploadPolicy);
    if (problem) { setError(problem); return; }
    if (!memberName) { setError('請先選擇這份資料所屬的家庭成員。'); return; }
    if (!confirmed) { setError('請先確認資料所屬成員。'); return; }
    setBusy(true);
    setError('');
    let createdJobId = '';
    try {
      setStatus('正在檢查檔案格式…');
      for (const file of files) await validateMagic(file);
      const key = await idempotencyKey(files, memberName);
      const manifest: NhiUploadManifest[] = await Promise.all(files.map(async (file) => ({
        name: file.name,
        size: file.size,
        sha256: await sha256Hex(file),
        content_type: file.type || (extension(file.name) === 'zip' ? 'application/zip' : 'text/html'),
      })));
      setStatus('正在建立安全上傳工作…');
      const job = await createNhiImportWithManifest(memberName, manifest, key);
      const jobId = job.id;
      createdJobId = jobId;
      if (job.state === 'awaiting_upload') {
        const targets = job.upload_targets ?? [];
        if (targets.length !== files.length) {
          throw new Error('伺服器回傳的安全上傳目標與所選檔案不一致，請重新選擇後再試。');
        }
        const filesByName = new Map(files.map((file) => [file.name.toLocaleLowerCase(), file]));
        for (let index = 0; index < targets.length; index += 1) {
          const target = targets[index];
          if (target.status && target.status !== 'awaiting_upload') continue;
          const fileForTarget = target.name
            ? filesByName.get(target.name.toLocaleLowerCase())
            : files[index];
          if (!fileForTarget || !target.upload_url) {
            throw new Error('找不到對應的安全上傳目標，請重新開始匯入。');
          }
          setStatus(`正在安全上傳 ${index + 1} / ${targets.length}：${fileForTarget.name}`);
          await uploadNhiImportTarget(target, fileForTarget);
        }
        setStatus('檔案已上傳，正在驗證雜湊並排入整理佇列…');
        await completeNhiImportWithManifest(jobId, manifest);
      }
      // The same server transaction that validates and queues the job marks
      // onboarding as `import_queued`.  Do not send a second client-authored
      // completion state: the browser must never claim that an upload was
      // accepted independently of the durable job.
      router.push(`/dashboard/nhi/import/${encodeURIComponent(jobId)}`);
    } catch (caught) {
      // The completion request may reach the API even when its response is
      // interrupted. Recover the durable job before reporting a false upload
      // failure, so users do not re-upload an already queued bundle.
      if (createdJobId) {
        try {
          const recovered = await getNhiImportJob(createdJobId);
          if (recovered.state && recovered.state !== 'awaiting_upload') {
            router.push(`/dashboard/nhi/import/${encodeURIComponent(createdJobId)}`);
            return;
          }
        } catch {
          // Keep the original actionable error if recovery is unavailable.
        }
      }
      setStatus('');
      const duplicateJobId = apiErrorJobId(caught);
      if (duplicateJobId) {
        router.push(`/dashboard/nhi/import/${encodeURIComponent(duplicateJobId)}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : '健保資料上傳失敗，請稍後重試。');
    } finally {
      setBusy(false);
    }
  };

  const completeNoFile = async () => {
    if (!noFileConfirmed) {
      setError('請先勾選確認目前沒有可匯入的檔案。');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('正在完成首次匯入設定…');
    try {
      const state = await completeNhiOnboarding({ completion_method: 'no_file', import_state: 'no_file' });
      onComplete?.(state);
      if (!onComplete) router.replace(nextPath);
    } catch (caught) {
      setStatus('');
      setError(caught instanceof Error ? caught.message : '目前無法完成設定，請稍後重試。');
    } finally {
      setBusy(false);
    }
  };

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <main className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={onBack} disabled={busy}>返回</button>
        <div className="hk-card" style={{ marginTop: 14 }}>
          <div className="hk-badge hk-b-blue" style={{ marginBottom: 8 }}>第一次匯入</div>
          <h1 style={{ margin: 0, fontSize: 26, color: 'var(--hk-ink)' }}>匯入健保存摺資料</h1>
          <p style={{ margin: '9px 0 0', color: 'var(--hk-ink-2)', lineHeight: 1.65, fontSize: 14 }}>
            選擇官方健保存摺 HTML，或包含這些 HTML 的單一 ZIP。匯入後會先在私有環境中以規則整理成健康時間軸；所有結果仍會標示為尚未醫療確認。
          </p>
        </div>

        <div aria-label="匯入步驟" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, margin: '14px 0' }}>
          {[
            ['1', '選擇檔案', files.length ? `已選 ${files.length} 個` : 'HTML 多選或單一 ZIP'],
            ['2', '確認資料所屬', confirmed ? '已確認' : memberName || '尚未選擇'],
            ['3', '開始匯入', busy ? '安全上傳中' : '前往整理進度'],
          ].map(([number, title, detail]) => (
            <div key={number} className="hk-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--hk-ink-3)', fontWeight: 800 }}>步驟 {number}</div>
              <div style={{ marginTop: 4, fontWeight: 850, color: 'var(--hk-ink)' }}>{title}</div>
              <div style={{ marginTop: 3, fontSize: 12, color: 'var(--hk-ink-2)' }}>{detail}</div>
            </div>
          ))}
        </div>

        <section className="hk-card" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>1. 選擇檔案</h2>
          {policyLoading && <div role="status" style={{ marginBottom: 10, color: 'var(--hk-ink-2)', fontSize: 13 }}>正在確認伺服器檔案限制…</div>}
          {policyError && (
            <div role="alert" style={{ marginBottom: 10, color: 'var(--hk-red)', fontSize: 13 }}>
              {policyError}
              <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => void loadUploadPolicy()} style={{ marginLeft: 8 }}>重新確認</button>
            </div>
          )}
          <button
            type="button"
            className="hk-btn hk-btn-ghost"
            style={{ width: '100%', minHeight: 126, borderStyle: 'dashed', borderWidth: 2, background: dragging ? '#e7f3f5' : '#f8fbfc' }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFiles(Array.from(event.dataTransfer.files));
            }}
            disabled={busy || noFileConfirmed || !uploadPolicy}
          >
            <span>
              <strong style={{ display: 'block', fontSize: 15 }}>拖曳檔案到這裡，或點擊選擇</strong>
              <span style={{ display: 'block', marginTop: 6, color: 'var(--hk-ink-3)', fontSize: 12 }}>
                {uploadPolicy
                  ? `最多 ${uploadPolicy.max_files} 個 HTML；或單一 ZIP。總大小上限 ${formatSize(uploadPolicy.max_total_bytes)}。`
                  : '取得伺服器限制後即可選擇檔案。'}
              </span>
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={uploadPolicy?.accept ?? ''}
            hidden
            disabled={busy || noFileConfirmed || !uploadPolicy}
            onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
          />
          {files.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--hk-ink-2)', fontSize: 13 }}>
                <strong>{files.length} 個檔案</strong><span>{formatSize(totalSize)}</span>
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {files.map((file, index) => (
                  <div key={`${file.name}-${file.size}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', border: '1px solid var(--hk-line)', borderRadius: 8 }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{file.name}</span>
                <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => chooseFiles(files.filter((_, fileIndex) => fileIndex !== index))} disabled={busy}>移除</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="hk-card" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>2. 確認資料所屬</h2>
          {members.length === 0 ? (
            <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #efdfae', background: '#fdf6e3', color: '#8a5b11', fontSize: 13, lineHeight: 1.55 }}>
              尚未建立可選擇的本人資料。請重新整理頁面；若仍未出現，請先回到首頁重新登入。
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {members.map((member) => (
              <button
                key={member.name}
                type="button"
                className={`hk-btn hk-btn-sm ${memberName === member.name ? 'hk-btn-primary' : 'hk-btn-ghost'}`}
                aria-pressed={memberName === member.name}
                onClick={() => { onMemberChange(member.name); setConfirmed(false); }}
                disabled={busy}
              >
                {member.name}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: busy || !memberName || files.length === 0 ? 'not-allowed' : 'pointer', lineHeight: 1.55, color: 'var(--hk-ink-2)', fontSize: 14 }}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || !memberName || files.length === 0} aria-describedby="nhi-owner-confirmation-help" style={{ marginTop: 4 }} />
            <span>我確認這些健保存摺資料屬於「{memberName || '尚未選擇'}」，並了解自動整理不等於正式醫療診斷。</span>
          </label>
          <div id="nhi-owner-confirmation-help" style={{ marginTop: 6, paddingLeft: 26, color: 'var(--hk-ink-3)', fontSize: 12 }}>
            {!memberName ? '請先選擇上方的家庭成員。' : files.length === 0 ? '請先完成步驟 1 選擇檔案。' : '可以勾選確認並開始匯入。'}
          </div>
        </section>

        <section className="hk-card" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>3. 開始匯入</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.6 }}>
            上傳完成後會開啟可恢復的進度頁。您可以離開、重新登入或換裝置，再用相同工作編號查看。
          </p>
          <button type="button" className="hk-btn hk-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void startImport()} disabled={busy || files.length === 0 || !confirmed || !memberName}>
            {busy ? '正在安全上傳…' : '開始匯入並查看進度'}
          </button>
          <div aria-live="polite" role={error ? 'alert' : 'status'} style={{ minHeight: 22, marginTop: 10, color: error ? 'var(--hk-red)' : 'var(--hk-ink-2)', fontSize: 13 }}>
            {error || status}
          </div>
        </section>

        {completeOnboarding ? <section className="hk-card" style={{ marginBottom: 14, border: '1px solid #d9e4e8' }} aria-labelledby="nhi-no-file-heading">
          <h2 id="nhi-no-file-heading" style={{ margin: '0 0 8px', fontSize: 17 }}>目前沒有可匯入的檔案</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.65 }}>
            只有在你確認目前沒有可匯入的健保存摺檔案時，才使用這條路徑。這不代表 HealthKeep 已經有你的健保資料；之後仍可從健保資料頁補匯入。
          </p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--hk-ink-2)', fontSize: 14, lineHeight: 1.55 }}>
            <input
              type="checkbox"
              checked={noFileConfirmed}
              onChange={(event) => {
                setNoFileConfirmed(event.target.checked);
                if (event.target.checked) {
                  setFiles([]);
                  setConfirmed(false);
                  setError('');
                }
              }}
              disabled={busy}
              aria-describedby="nhi-no-file-help"
              style={{ marginTop: 4, width: 18, height: 18 }}
            />
            <span>我目前沒有可匯入的檔案，了解之後仍可補匯入。</span>
          </label>
          <div id="nhi-no-file-help" style={{ marginTop: 8, color: 'var(--hk-ink-3)', fontSize: 12 }}>
            完成後會直接回到下一步，不會產生匯入工作。
          </div>
          <button type="button" className="hk-btn hk-btn-ghost" style={{ marginTop: 12, minHeight: 44 }} onClick={() => void completeNoFile()} disabled={busy || !noFileConfirmed}>
            {busy ? '正在完成設定…' : '完成設定並繼續'}
          </button>
        </section> : null}
      </div>
    </main>
  );
}
