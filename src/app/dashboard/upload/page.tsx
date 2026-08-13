'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { useToast } from '../toast-context';
import { api } from '@/lib/api';
import { memberHref, normalizeMemberName } from '@/lib/members';
import NhiFirstImportFlow from '@/components/NhiFirstImportFlow';
import { Activity, ArrowLeft, CheckCircle2, Droplets, FileText, FileUp, Footprints, Gauge, HeartPulse, Moon, Plus, Save, Scale, Stethoscope, X } from 'lucide-react';
import { DOCUMENT_UPLOAD_ACCEPT, DocumentUploadError, uploadDocument, validateDocumentBeforeUpload } from '@/lib/document-upload';
import { ReadOnlyNotice, TaskLinkCard } from '../_components/Shared';

type Tab = 'manual' | 'event' | 'file';
type RecordType = 'blood_pressure' | 'heart_rate' | 'glucose' | 'body_composition' | 'steps' | 'sleep' | 'other';

const RECORD_TYPES: {
  value: RecordType; label: string; icon: string;
  fields: { key: 'value1' | 'value2'; label: string; unit: string; placeholder: string }[];
}[] = [
  { value: 'blood_pressure',   label: '血壓',   icon: 'blood_pressure', fields: [{ key: 'value1', label: '收縮壓', unit: 'mmHg', placeholder: '120' }, { key: 'value2', label: '舒張壓', unit: 'mmHg', placeholder: '80' }] },
  { value: 'heart_rate',       label: '心跳',   icon: 'heart_rate', fields: [{ key: 'value1', label: '心跳率', unit: 'bpm',  placeholder: '72'   }] },
  { value: 'glucose',          label: '血糖',   icon: 'glucose', fields: [{ key: 'value1', label: '血糖值', unit: 'mg/dL', placeholder: '95'  }] },
  { value: 'body_composition', label: '身體組成', icon: 'body_composition', fields: [{ key: 'value1', label: '體重',  unit: 'kg',   placeholder: '70.0' }] },
  { value: 'steps',            label: '步數',   icon: 'steps', fields: [{ key: 'value1', label: '步數',  unit: '步',   placeholder: '8000' }] },
  { value: 'sleep',            label: '睡眠',   icon: 'sleep', fields: [{ key: 'value1', label: '睡眠時間', unit: '小時', placeholder: '7.5' }] },
  { value: 'other',            label: '其他',   icon: 'other', fields: [{ key: 'value1', label: '數值',  unit: '',     placeholder: '0'    }] },
];

const DOC_TYPES = [
  { value: 'lab_report',   label: '檢驗報告' },
  { value: 'prescription', label: '處方箋' },
  { value: 'discharge',    label: '出院摘要' },
  { value: 'image',        label: '影像報告' },
  { value: 'nhia_card',    label: '健保快易通' },
  { value: 'other',        label: '其他文件' },
];

function RecordTypeIcon({ type, size = 20 }: { type: string; size?: number }) {
  const props = { size, 'aria-hidden': true as const };
  if (type === 'blood_pressure' || type === 'heart_rate') return <HeartPulse {...props} />;
  if (type === 'glucose') return <Droplets {...props} />;
  if (['body_composition', 'weight', 'body_fat'].includes(type)) return <Scale {...props} />;
  if (type === 'steps') return <Footprints {...props} />;
  if (type === 'sleep') return <Moon {...props} />;
  if (type === 'bmi') return <Gauge {...props} />;
  return <Activity {...props} />;
}

function createOperationId(prefix: string): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${id}`;
}

const COMMON_HOSPITALS = ['台大醫院', '臺北榮總', '林口長庚', '馬偕醫院', '北醫附醫', '亞東醫院', '成大醫院', '中國醫附醫', '高醫附醫', '花蓮慈濟'];

// Guess the document type + date from the file name so the uploader doesn't have
// to set them by hand. Pure heuristic — the user can still override both.
function inferDocMetaFromFilename(name: string): { docType?: string; docDate?: string } {
  const lower = name.toLowerCase();
  let docType: string | undefined;
  if (/健保|快易通|nhi/.test(lower)) docType = 'nhia_card';
  else if (/處方|藥|prescription|\brx\b/.test(lower)) docType = 'prescription';
  else if (/出院|住院|discharge/.test(lower)) docType = 'discharge';
  else if (/\.(jpe?g|png|dcm|tiff?|bmp)$/.test(lower) || /影像|超音波|x-?ray|\bct\b|\bmri\b|echo|ultrasound/.test(lower)) docType = 'image';
  else if (/檢驗|檢查|報告|抽血|生化|lab|blood|hba1c|cbc|urine/.test(lower)) docType = 'lab_report';

  let docDate: string | undefined;
  const match = name.match(/(20\d{2})[-_./]?(0[1-9]|1[0-2])[-_./]?(0[1-9]|[12]\d|3[01])/);
  if (match) docDate = `${match[1]}-${match[2]}-${match[3]}`;

  return { docType, docDate };
}

const UPLOAD_FLOW_STEPS = [
  { title: '1. 已收到', body: '檔案進入文件庫，狀態會先顯示為「已收到」。' },
  { title: '2. 整理中', body: '系統擷取（OCR）讀取文字與醫療欄位，結果仍是草稿。' },
  { title: '3. 醫療團隊確認', body: '醫療團隊會確認、修正，或請你補充資料。' },
  { title: '4. 已完成摘要', body: '確認後才會連到白話摘要與健康檔案。' },
];

// 上傳後即時整理進度（對應改版 §6 狀態鏈）。映射文件 processing_status。
type UploadedDoc = { id?: string; file_name?: string; processing_status?: string | null; status?: string | null };
type RecentDoc = UploadedDoc & { doc_type?: string | null; doc_date?: string | null; created_at?: string | null; processing_status_label?: string | null };
const DOC_FLOW = [
  { title: '已收到', body: '檔案已進入文件庫' },
  { title: '整理中', body: '系統擷取（OCR）與初步整理，仍是草稿' },
  { title: '等待醫療團隊確認', body: '醫療團隊確認、修改或請你補充資料' },
  { title: '已完成摘要', body: '完成後會連到白話摘要與健康檔案' },
];
// active = 目前進行中的步驟索引；i < active 視為已完成；active >= 長度代表全部完成。
function docFlowState(status?: string | null): { active: number; error: boolean } {
  switch (status) {
    case 'confirmed': return { active: DOC_FLOW.length, error: false };
    case 'published': return { active: DOC_FLOW.length, error: false };
    case 'reviewed': return { active: 3, error: false };
    case 'needs_review': return { active: 2, error: false };
    case 'extracting': return { active: 1, error: false };
    case 'failed':
    case 'rejected': return { active: 1, error: true };
    default: return { active: 1, error: false }; // uploaded / queued / unknown
  }
}
function uploadStatusBadge(doc?: UploadedDoc | null): { t: string; c: string; text: string } {
  const fs = docFlowState(doc?.processing_status || doc?.status);
  if (fs.error) return { t: '需補件 / 重傳', c: 'hk-b-red', text: '醫療團隊需要補件或重傳。' };
  if (fs.active >= DOC_FLOW.length) return { t: '已完成摘要', c: 'hk-b-green', text: '醫療團隊已完成整理，可查看健康摘要。' };
  if (fs.active >= 2) return { t: '等待醫療團隊確認', c: 'hk-b-amber', text: '已排入醫療團隊的待確認清單。' };
  return { t: '整理中', c: 'hk-b-amber', text: '系統正在整理，尚未進入正式摘要。' };
}
function UploadStatusTimeline({ status }: { status?: string | null }) {
  const { active, error } = docFlowState(status);
  return (
    <div style={{ marginTop: 4 }}>
      {DOC_FLOW.map((s, i) => {
        const done = i < active;
        const isActive = i === active && active < DOC_FLOW.length;
        const err = error && isActive;
        const dotColor = err ? 'var(--hk-red)' : done ? 'var(--hk-green)' : isActive ? 'var(--hk-amber)' : '#c8d4dc';
        return (
          <div key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ width: 14, height: 14, borderRadius: 7, flexShrink: 0, marginTop: 5, background: done || isActive || err ? dotColor : '#fff', border: `2px solid ${dotColor}`, boxShadow: isActive ? `0 0 0 4px ${err ? '#faecea' : '#fdf6e3'}` : 'none' }} />
              {i < DOC_FLOW.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 16, background: done ? 'var(--hk-green)' : '#e3e9ee' }} />}
            </div>
            <div style={{ paddingBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: done || isActive ? 800 : 600, color: done ? 'var(--hk-green)' : isActive ? (err ? 'var(--hk-red)' : 'var(--hk-amber)') : 'var(--hk-ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {done && <CheckCircle2 size={15} aria-hidden="true" />}{s.title}{err ? '（需補件 / 重傳）' : isActive ? '…' : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--hk-ink-2)', marginTop: 2 }}>{s.body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Pending record (for multi-entry accumulation) ────────────────────────────
type PendingRecord = {
  tmpId: string;
  member: string;
  record_type: string;
  label: string;
  icon: string;
  value1: string;
  value2: string;
  unit: string;
  note: string;
  recorded_at: string;
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const btnPrimary: React.CSSProperties = {
  background: 'var(--primary)', color: '#fff', border: 'none',
  padding: '12px 24px', borderRadius: '10px', fontSize: '15px', fontWeight: '700',
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px',
  border: '1px solid var(--gray-300)', fontSize: '15px', outline: 'none', fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '6px', display: 'block',
};

function getTaipeiNow(): string {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(' ', 'T');
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function UploadPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members, canWriteMember, writeAccessReason } = useActiveMember();
  const { showToast } = useToast();
  const formId = useId();

  const initialType = ((): RecordType => {
    const t = searchParams.get('type');
    if (t && RECORD_TYPES.some(rt => rt.value === t)) return t as RecordType;
    return 'blood_pressure';
  })();

  const initialTab = ((): Tab => {
    if (searchParams.get('tab') === 'manual' || searchParams.has('type')) return 'manual';
    if (searchParams.get('tab') === 'event') return 'event';
    return 'file';
  })();

  const [tab, setTab] = useState<Tab>(initialTab);

  // ── Manual entry state ──────────────────────────────────────────────────────
  const requestedMemberParam = searchParams.get('member');
  const requestedMember = requestedMemberParam === null ? '' : normalizeMemberName(requestedMemberParam);
  const initialSelectedMember = requestedMember || activeMember || (members.length === 1 ? members[0]?.name || '' : '');
  const [member, setMember] = useState(initialSelectedMember);
  const [recordType, setRecordType] = useState<RecordType>(initialType);
  const [value1, setValue1] = useState('');
  const [value2, setValue2] = useState('');
  const [note, setNote] = useState('');
  const [recordedAt, setRecordedAt] = useState(getTaipeiNow);

  // Pending (accumulated) records
  const [pendingRecords, setPendingRecords] = useState<PendingRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState('');

  // Companion / extended fields
  const [pulse, setPulse] = useState('');        // optional heart rate alongside blood pressure
  const [bodyFat, setBodyFat] = useState('');    // body fat % for body_composition
  const [heightCm, setHeightCm] = useState(''); // height for BMI auto-calc (persisted in localStorage)

  // ── File upload state ───────────────────────────────────────────────────────
  const [fileMember, setFileMember] = useState(initialSelectedMember);
  const [docType, setDocType] = useState('lab_report');
  const [fileNote, setFileNote] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<UploadedDoc | null>(null); // 上傳後顯示整理進度
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>([]);
  const [recentDocsError, setRecentDocsError] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadOperationId, setUploadOperationId] = useState(() => createOperationId('document-upload'));
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(requestedMember);
    setMember(requestedMember);
    setFileMember(requestedMember);
  }, [requestedMember, requestedMemberParam, setActiveMember]);

  useEffect(() => {
    if (requestedMemberParam !== null) return;
    const target = activeMember || (members.length === 1 ? members[0]?.name || '' : '');
    setMember(target);
    setFileMember(target);
  }, [activeMember, members, requestedMemberParam]);

  const selectTargetMember = useCallback((nextMember: string) => {
    const normalized = normalizeMemberName(nextMember);
    setMember(normalized);
    setFileMember(normalized);
    setActiveMember(normalized);

    const params = new URLSearchParams(searchParams.toString());
    if (normalized) {
      params.set('member', normalized);
    } else {
      params.delete('member');
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, setActiveMember]);

  // Restore saved height from localStorage whenever the target member changes
  useEffect(() => {
    if (!member) return;
    try {
      const stored = localStorage.getItem('healthkeep_heights_v1');
      if (stored) {
        const heights: Record<string, string> = JSON.parse(stored);
        setHeightCm(heights[member] || '');
      }
    } catch { /* ignore */ }
  }, [member]);

  const handleHeightChange = (h: string) => {
    setHeightCm(h);
    if (!member) return;
    try {
      const stored = localStorage.getItem('healthkeep_heights_v1') || '{}';
      const heights: Record<string, string> = JSON.parse(stored);
      heights[member] = h;
      localStorage.setItem('healthkeep_heights_v1', JSON.stringify(heights));
    } catch { /* ignore */ }
  };

  const currentType = RECORD_TYPES.find(t => t.value === recordType)!;

  // ── Add to pending list ─────────────────────────────────────────────────────
  const addToPending = () => {
    setAddError('');
    if (!member) { setAddError('請先選擇要記錄的家庭成員'); return; }
    if (!canWriteMember(member)) { setAddError(writeAccessReason(member) || '你目前只能查看這位成員的資料'); return; }

    if (recordType === 'body_composition') {
      if (!value1.trim()) { setAddError('請先填入體重'); return; }
      const ts = new Date(recordedAt).toISOString();
      const now = Date.now();
      const newRecords: PendingRecord[] = [
        { tmpId: `tmp_${now}_w`, member, record_type: 'weight', label: '體重', icon: 'weight',
          value1, value2: '', unit: 'kg', note: '', recorded_at: ts },
      ];
      const hVal = parseFloat(heightCm);
      const wVal = parseFloat(value1);
      if (heightCm.trim() && hVal > 0 && wVal > 0) {
        newRecords.push({
          tmpId: `tmp_${now + 1}_bmi`, member, record_type: 'bmi', label: 'BMI', icon: 'bmi',
          value1: (wVal / Math.pow(hVal / 100, 2)).toFixed(1), value2: '', unit: '', note: '', recorded_at: ts,
        });
      }
      if (bodyFat.trim()) {
        newRecords.push({
          tmpId: `tmp_${now + 2}_bf`, member, record_type: 'body_fat', label: '體脂率', icon: 'body_fat',
          value1: bodyFat, value2: '', unit: '%', note: '', recorded_at: ts,
        });
      }
      setPendingRecords(prev => [...prev, ...newRecords]);
      setValue1(''); setBodyFat('');
      return;
    }

    if (!value1.trim()) { setAddError('請先填入數值'); return; }
    const ts = new Date(recordedAt).toISOString();
    const newRecords: PendingRecord[] = [{
      tmpId: `tmp_${Date.now()}`, member, record_type: recordType,
      label: currentType.label, icon: currentType.icon,
      value1, value2, unit: currentType.fields[0]?.unit ?? '', note,
      recorded_at: ts,
    }];
    if (recordType === 'blood_pressure' && pulse.trim()) {
      newRecords.push({
        tmpId: `tmp_${Date.now()}_hr`, member, record_type: 'heart_rate',
        label: '心跳', icon: 'heart_rate', value1: pulse, value2: '', unit: 'bpm', note: '',
        recorded_at: ts,
      });
      setPulse('');
    }
    setPendingRecords(prev => [...prev, ...newRecords]);
    setValue1(''); setValue2(''); setNote('');
  };

  const removeFromPending = (tmpId: string) => {
    setPendingRecords(prev => prev.filter(r => r.tmpId !== tmpId));
  };

  // ── Submit all pending records ──────────────────────────────────────────────
  const submitAll = async () => {
    if (pendingRecords.length === 0) return;
    const readOnlyRecord = pendingRecords.find((record) => !canWriteMember(record.member));
    if (readOnlyRecord) { showToast(writeAccessReason(readOnlyRecord.member) || '你目前只能查看這位成員的資料', 'info'); return; }
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(pendingRecords.map(r =>
        api.post('/api/records', {
            member_name: r.member,
            record_type: r.record_type,
            value1: r.value1 || null,
            value2: r.value2 || null,
            unit: r.unit || null,
            note: r.note || null,
            recorded_at: r.recorded_at,
        }, { idempotencyKey: `health-record-${r.tmpId}` })
      ));
      const failedRecords = pendingRecords.filter((_, index) => results[index]?.status === 'rejected');
      const savedCount = pendingRecords.length - failedRecords.length;
      setPendingRecords(failedRecords);
      if (failedRecords.length > 0) {
        showToast(
          savedCount > 0
            ? `已儲存 ${savedCount} 筆；另有 ${failedRecords.length} 筆失敗，已保留在畫面上可重試`
            : '儲存失敗，待送紀錄已保留，請稍後重試',
          'error',
        );
        return;
      }
      showToast(`已儲存 ${savedCount} 筆自我量測紀錄`, 'success');
      router.push(memberHref('/dashboard/history', activeMember));
    } catch {
      showToast('儲存失敗，請重試', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Quick save current entry (if user just wants one record) ────────────────
  const handleQuickSave = async () => {
    if (!value1.trim()) return;
    if (!member) { showToast('請先選擇要記錄的家庭成員', 'error'); return; }
    if (!canWriteMember(member)) { showToast(writeAccessReason(member) || '你目前只能查看這位成員的資料', 'info'); return; }
    setSubmitting(true);
    const ts = new Date(recordedAt).toISOString();
    const post = (record: PendingRecord) => api.post('/api/records', {
      member_name: record.member,
      record_type: record.record_type,
      value1: record.value1 || null,
      value2: record.value2 || null,
      unit: record.unit || null,
      note: record.note || null,
      recorded_at: record.recorded_at,
    }, { idempotencyKey: `health-record-${record.tmpId}` });
    try {
      const now = Date.now();
      let quickRecords: PendingRecord[];
      if (recordType === 'body_composition') {
        quickRecords = [{
          tmpId: `quick_${now}_weight`, member, record_type: 'weight',
          label: '體重', icon: 'weight', value1, value2: '', unit: 'kg', note, recorded_at: ts,
        }];
        const hVal = parseFloat(heightCm), wVal = parseFloat(value1);
        if (heightCm.trim() && hVal > 0 && wVal > 0) {
          quickRecords.push({
            tmpId: `quick_${now}_bmi`, member, record_type: 'bmi',
            label: 'BMI', icon: 'bmi', value1: (wVal / Math.pow(hVal / 100, 2)).toFixed(1),
            value2: '', unit: '', note: '', recorded_at: ts,
          });
        }
        if (bodyFat.trim()) {
          quickRecords.push({
            tmpId: `quick_${now}_body_fat`, member, record_type: 'body_fat',
            label: '體脂率', icon: 'body_fat', value1: bodyFat,
            value2: '', unit: '%', note: '', recorded_at: ts,
          });
        }
      } else {
        quickRecords = [{
          tmpId: `quick_${now}`, member, record_type: recordType,
          label: currentType.label, icon: currentType.icon,
          value1, value2, unit: currentType.fields[0]?.unit || '', note, recorded_at: ts,
        }];
        if (recordType === 'blood_pressure' && pulse.trim()) {
          quickRecords.push({
            tmpId: `quick_${now}_heart_rate`, member, record_type: 'heart_rate',
            label: '心跳', icon: 'heart_rate', value1: pulse,
            value2: '', unit: 'bpm', note: '', recorded_at: ts,
          });
        }
      }
      const results = await Promise.allSettled(quickRecords.map(post));
      const failedRecords = quickRecords.filter((_, index) => results[index]?.status === 'rejected');
      if (failedRecords.length > 0) {
        const savedCount = results.length - failedRecords.length;
        setPendingRecords(previous => [...previous, ...failedRecords]);
        setValue1(''); setValue2(''); setBodyFat(''); setPulse(''); setNote('');
        showToast(
          savedCount > 0
            ? `已儲存 ${savedCount} 筆；另有 ${failedRecords.length} 筆失敗，已移到待送清單供重試`
            : '儲存失敗，紀錄已移到待送清單，請稍後重試',
          'error',
        );
        return;
      }
      showToast('自我量測紀錄已儲存，可在歷史紀錄查看；這不是醫療團隊確認結果', 'success');
      router.push(memberHref('/dashboard/history', activeMember));
    } catch {
      showToast('儲存失敗，請重試', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateDocumentBeforeUpload(file);
    setUploadError(validationError || '');
    if (validationError) {
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setUploadOperationId(createOperationId('document-upload'));
    // Auto-fill type + date from the file name so the uploader doesn't type them.
    const meta = inferDocMetaFromFilename(file.name);
    if (meta.docType) setDocType(meta.docType);
    if (meta.docDate) setDocDate(meta.docDate);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const loadRecentDocs = useCallback(async () => {
    setRecentDocsError(false);
    try {
      const params: Record<string, string> = { limit: '5' };
      if (fileMember) params.member = fileMember;
      const data = await api.get('/api/documents', params);
      setRecentDocs(Array.isArray(data) ? (data as RecentDoc[]).slice(0, 5) : []);
    } catch {
      setRecentDocsError(true);
    }
  }, [fileMember]);

  useEffect(() => { void loadRecentDocs(); }, [loadRecentDocs]);

  const handleFileUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedFile) return;
    if (!fileMember) { showToast('請先選擇文件所屬家庭成員', 'error'); return; }
    if (!canWriteMember(fileMember)) { showToast(writeAccessReason(fileMember) || '你目前只能查看這位成員的資料', 'info'); return; }
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('member_name', fileMember);
      formData.append('doc_type', docType);
      if (fileNote) formData.append('note', fileNote);
      if (docDate) formData.append('doc_date', new Date(docDate).toISOString());
      const doc = await uploadDocument(formData, uploadOperationId);
      showToast('文件已收到，整理中；尚未完成辨識或確認', 'success');
      // 不自動跳轉：留在頁面顯示整理進度（已收到 ≠ 已確認）。
      setUploadedDoc(doc && typeof doc === 'object' ? (doc as UploadedDoc) : { file_name: selectedFile.name });
      setSelectedFile(null);
      setUploadOperationId(createOperationId('document-upload'));
      void loadRecentDocs();
    } catch (error) {
      const message = error instanceof DocumentUploadError ? error.message : '文件上傳失敗，檔案尚未保存。請確認網路後重試。';
      setUploadError(message);
      showToast(message, 'error');
    } finally {
      setUploading(false);
    }
  };

  // 重新抓最新整理狀態（手動按鈕觸發，不自動輪詢以避免額外負載）
  const refreshUploadedStatus = useCallback(async () => {
    if (!uploadedDoc) return;
    try {
      const params: Record<string, string> = { limit: '20' };
      if (fileMember) params.member = fileMember;
      const list = await api.get('/api/documents', params);
      if (!Array.isArray(list)) return;
      const match = (uploadedDoc.id ? list.find((d: UploadedDoc) => d.id === uploadedDoc.id) : list[0]) as UploadedDoc | undefined;
      if (match) setUploadedDoc(match);
      setRecentDocs(list.slice(0, 5) as RecentDoc[]);
    } catch { /* 靜默：保留現有狀態 */ }
  }, [uploadedDoc, fileMember]);

  if (searchParams.get('mode') === 'nhi-first') {
    return (
      <NhiFirstImportFlow
        memberName={fileMember}
        members={members}
        onMemberChange={selectTargetMember}
        onBack={() => router.push(memberHref('/dashboard/nhi', fileMember))}
      />
    );
  }

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>

        {/* Back + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <button onClick={() => router.push(memberHref('/dashboard/documents', activeMember))} aria-label="返回健康文件" style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer', color: '#555',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}><ArrowLeft size={20} aria-hidden="true" /></button>
          <div>
             <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#111', lineHeight: 1.1 }}>新增紀錄</h1>
             <p style={{ fontSize: '13px', color: '#888', marginTop: '3px' }}>選擇量測、健康事件或上傳資料</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', background: '#f0f4f8', borderRadius: '12px',
          padding: '4px', marginBottom: '20px',
        }}>
          {([
            { key: 'manual' as Tab, label: '量測', icon: <Activity size={18} aria-hidden="true" /> },
            { key: 'event' as Tab, label: '健康事件', icon: <Stethoscope size={18} aria-hidden="true" /> },
            { key: 'file' as Tab, label: '上傳資料', icon: <FileUp size={18} aria-hidden="true" /> },
          ]).map(t => (
            <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: '10px 16px', borderRadius: '10px', border: 'none',
              minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              background: tab === t.key ? '#fff' : 'transparent',
              color: tab === t.key ? 'var(--primary)' : '#888',
              fontWeight: tab === t.key ? '700' : '500', fontSize: '14px', cursor: 'pointer',
              boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.15s',
            }}>{t.icon}{t.label}</button>
          ))}
        </div>

        {((tab === 'file' ? fileMember : member) && !canWriteMember(tab === 'file' ? fileMember : member)) && (
          <ReadOnlyNotice>
            {writeAccessReason(tab === 'file' ? fileMember : member) || '正在確認你的修改範圍；完成前先以唯讀顯示。'}
          </ReadOnlyNotice>
        )}

        {tab === 'file' && recentDocsError && (
          <div role="alert" style={{ background: '#faecea', border: '1px solid #f2d3cf', color: '#8f342b', borderRadius: 12, padding: 14, marginBottom: 16 }}>
            最近文件狀態載入失敗，這不代表沒有資料。<button type="button" onClick={() => void loadRecentDocs()} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginLeft: 8 }}>重新載入</button>
          </div>
        )}

        {tab === 'file' && recentDocs.length > 0 && (
          <div className="hk-card" style={{ marginBottom: 20, borderColor: '#d5e7ec', background: '#fff' }}>
            <div className="hk-ctitle">最近資料狀態
              <button type="button" onClick={() => void loadRecentDocs()} className="hk-btn hk-btn-ghost hk-btn-sm">重新整理</button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {recentDocs.slice(0, 3).map((doc, index) => {
                const badge = uploadStatusBadge(doc);
                const dateLabel = doc.doc_date || (doc.created_at ? new Date(doc.created_at).toLocaleDateString('zh-TW') : '');
                return (
                  <div key={doc.id || `${doc.file_name}-${index}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: index < Math.min(recentDocs.length, 3) - 1 ? '1px solid var(--hk-line)' : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--hk-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.file_name || '上傳文件'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--hk-ink-3)', marginTop: 2 }}>
                        {dateLabel ? `資料日期 ${dateLabel} · ` : ''}{badge.text}
                      </div>
                    </div>
                    <span className={`hk-badge ${badge.c}`}>{doc.processing_status_label || badge.t}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" onClick={() => router.push(memberHref('/dashboard/documents', fileMember))} className="hk-btn hk-btn-ghost hk-btn-sm">查看文件庫</button>
              <button type="button" onClick={() => router.push(memberHref('/dashboard/health', fileMember))} className="hk-btn hk-btn-ghost hk-btn-sm">查看健康全貌</button>
            </div>
          </div>
        )}

        {tab === 'event' && (
          <section aria-labelledby={`${formId}-event-title`} style={{ display: 'grid', gap: 14 }}>
            <div className="hk-card">
              <h2 id={`${formId}-event-title`} style={{ margin: 0, fontSize: 18, color: '#22313f' }}>要記錄哪一種健康事件？</h2>
              <p style={{ color: '#6b7c8c', fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>病況與目前用藥會由你明確確認；健保就醫資料則保留來源，等待整理後才顯示為正式內容。</p>
            </div>
            <div className="hk-task-grid">
              <TaskLinkCard href={memberHref('/dashboard/conditions', activeMember)} title="新增或更新病況" description="記錄你目前正在管理的病況或症狀。" icon="health" />
              <TaskLinkCard href={memberHref('/dashboard/medications', activeMember)} title="新增或更新用藥" description="記錄目前實際使用的藥物與服用方式。" icon="medication" />
              <TaskLinkCard href={memberHref('/dashboard/nhi', activeMember)} title="匯入就醫紀錄" description="從健保資料建立有來源的就醫時間軸。" icon="records" />
              <button type="button" className="hk-task-card" onClick={() => setTab('file')} style={{ textAlign: 'left' }}>
                <span className="hk-task-card-icon" aria-hidden="true"><FileText size={22} /></span>
                <span className="hk-task-card-content"><strong>上傳事件文件</strong><span className="hk-task-card-description">上傳檢驗、處方或出院摘要，交由系統整理。</span></span>
              </button>
            </div>
          </section>
        )}

        {/* ── Manual Entry ── */}
        {tab === 'manual' && (
          <div>
            {/* Pending records list */}
            {pendingRecords.length > 0 && (
              <div style={{
                background: '#fff', borderRadius: '16px', padding: '20px',
                boxShadow: 'var(--shadow-sm)', marginBottom: '16px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#555', marginBottom: '12px' }}>
                  暫存清單 · {pendingRecords.length} 筆
                  <span style={{ fontSize: '12px', color: '#999', fontWeight: '400', marginLeft: '6px' }}>
                    （點「儲存所有紀錄」後一次送出）
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pendingRecords.map(r => (
                    <div key={r.tmpId} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      background: '#f8f9fa', borderRadius: '10px', padding: '10px 14px',
                    }}>
                      <span style={{ color: '#3e6b7e' }}><RecordTypeIcon type={r.record_type} size={19} /></span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#111' }}>{r.label}</span>
                        <span style={{ fontSize: '13px', color: 'var(--primary)', marginLeft: '8px', fontWeight: '600' }}>
                          {r.value1}{r.value2 ? `/${r.value2}` : ''} {r.unit}
                        </span>
                        <span style={{ fontSize: '12px', color: '#999', marginLeft: '6px' }}>{r.member}</span>
                        {r.note && <span style={{ fontSize: '11px', color: '#aaa', marginLeft: '6px' }}>· {r.note}</span>}
                      </div>
                       <button type="button" aria-label={`從待送清單移除${r.label}`} onClick={() => removeFromPending(r.tmpId)} style={{
                         width: '44px', height: '44px', borderRadius: '50%', border: '1px solid #eee',
                         background: '#fff', color: '#a03a30',
                         cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                         flexShrink: 0,
                       }}><X size={18} aria-hidden="true" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Form */}
            <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', boxShadow: 'var(--shadow-sm)', marginBottom: '16px' }}>

              {/* Member select */}
               <div role="group" aria-labelledby={`${formId}-measurement-member`} style={{ marginBottom: '24px' }}>
                 <div id={`${formId}-measurement-member`} style={labelStyle}>家庭成員</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {members.map(m => (
                     <button key={m.name} type="button" aria-pressed={member === m.name} onClick={() => selectTargetMember(m.name)} style={{
                       minHeight: 44, padding: '8px 20px', borderRadius: '8px', border: '1px solid',
                      borderColor: member === m.name ? 'var(--primary)' : 'var(--gray-200)',
                      background: member === m.name ? '#e7f1ff' : '#fff',
                      color: member === m.name ? 'var(--primary)' : '#555',
                      fontWeight: member === m.name ? '700' : '500', fontSize: '14px', cursor: 'pointer',
                    }}>{m.name}</button>
                  ))}
                </div>
                {!member && members.length > 1 && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#a97614', fontWeight: 700 }}>
                    請先選擇這筆紀錄屬於哪位家庭成員。
                  </div>
                )}
              </div>

              {/* Record type */}
               <div role="group" aria-labelledby={`${formId}-measurement-type`} style={{ marginBottom: '24px' }}>
                 <div id={`${formId}-measurement-type`} style={labelStyle}>紀錄類型</div>
                <div className="grid-type-selector">
                  {RECORD_TYPES.map(rt => (
                     <button key={rt.value} type="button" aria-pressed={recordType === rt.value}
                      onClick={() => {
                        setRecordType(rt.value);
                        setValue1(''); setValue2(''); setAddError('');
                        setPulse(''); setBodyFat('');
                      }}
                      style={{
                         minHeight: 60, padding: '10px 8px', borderRadius: '10px', border: '1px solid',
                        borderColor: recordType === rt.value ? 'var(--primary)' : 'var(--gray-200)',
                        background: recordType === rt.value ? '#e7f1ff' : '#fff',
                        color: recordType === rt.value ? 'var(--primary)' : '#555',
                        fontWeight: recordType === rt.value ? '700' : '500',
                        fontSize: '13px', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                      }}>
                       <RecordTypeIcon type={rt.value} size={20} />
                      {rt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Value fields */}
              {recordType === 'body_composition' ? (
                /* ── Body composition: weight + height (localStorage) + body fat ── */
                <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                     <label htmlFor={`${formId}-weight`} style={labelStyle}>體重 <span style={{ color: '#999', fontWeight: 'normal' }}>(kg)</span></label>
                     <input id={`${formId}-weight`} type="number" step="0.1" inputMode="decimal" placeholder="70.0" value={value1}
                      onChange={e => { setValue1(e.target.value); setAddError(''); }} style={inputStyle} />
                  </div>
                  <div>
                     <label htmlFor={`${formId}-height`} style={labelStyle}>
                      身高 <span style={{ color: '#999', fontWeight: 'normal' }}>(cm) · 自動計算 BMI，下次記住</span>
                    </label>
                     <input id={`${formId}-height`} type="number" step="1" inputMode="decimal" placeholder="175" value={heightCm}
                      onChange={e => handleHeightChange(e.target.value)} style={inputStyle} />
                  </div>
                  {heightCm && value1 && parseFloat(heightCm) > 0 && parseFloat(value1) > 0 && (
                    <div style={{
                      background: '#e7f1ff', borderRadius: '8px', padding: '10px 14px',
                      fontSize: '13px', color: 'var(--primary)', fontWeight: '600',
                    }}>
                       自動計算 BMI：{(parseFloat(value1) / Math.pow(parseFloat(heightCm) / 100, 2)).toFixed(1)}
                    </div>
                  )}
                  <div>
                     <label htmlFor={`${formId}-body-fat`} style={labelStyle}>體脂率 <span style={{ color: '#999', fontWeight: 'normal' }}>(%) · 選填</span></label>
                     <input id={`${formId}-body-fat`} type="number" step="0.1" inputMode="decimal" placeholder="20.0" value={bodyFat}
                      onChange={e => setBodyFat(e.target.value)} style={inputStyle} />
                  </div>
                </div>
              ) : (
                /* ── Standard fields ── */
                <div className={currentType.fields.length > 1 ? 'grid-2col' : ''} style={{ marginBottom: '20px' }}>
                  {currentType.fields.map(field => (
                    <div key={field.key}>
                       <label htmlFor={`${formId}-${recordType}-${field.key}`} style={labelStyle}>
                        {field.label}
                        {field.unit && <span style={{ color: '#999', fontWeight: 'normal' }}> ({field.unit})</span>}
                      </label>
                      <input
                         id={`${formId}-${recordType}-${field.key}`}
                         type="number" step="0.1" inputMode="decimal"
                        placeholder={field.placeholder}
                        value={field.key === 'value1' ? value1 : value2}
                        onChange={e => {
                          setAddError('');
                          if (field.key === 'value1') setValue1(e.target.value);
                          else setValue2(e.target.value);
                        }}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Optional heart rate companion for blood pressure */}
              {recordType === 'blood_pressure' && (
                <div style={{ marginBottom: '20px' }}>
                   <label htmlFor={`${formId}-pulse`} style={labelStyle}>心跳 <span style={{ color: '#999', fontWeight: 'normal' }}>(bpm) · 選填</span></label>
                   <input id={`${formId}-pulse`} type="number" step="1" inputMode="numeric" placeholder="72" value={pulse}
                    onChange={e => setPulse(e.target.value)} style={inputStyle} />
                </div>
              )}

              {addError && (
                 <div role="alert" style={{ fontSize: '13px', color: '#a03a30', marginBottom: '12px' }}>{addError}</div>
              )}

              {/* Date/time */}
              <div style={{ marginBottom: '20px' }}>
                 <label htmlFor={`${formId}-recorded-at`} style={labelStyle}>量測時間</label>
                 <input id={`${formId}-recorded-at`} type="datetime-local" value={recordedAt}
                  onChange={e => setRecordedAt(e.target.value)} style={inputStyle} />
              </div>

              {/* Note */}
              <div>
                 <label htmlFor={`${formId}-measurement-note`} style={labelStyle}>備註（選填）</label>
                 <textarea
                   id={`${formId}-measurement-note`}
                  placeholder="例：飯前量測、運動後…"
                  value={note} onChange={e => setNote(e.target.value)}
                  rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
              <button type="button" onClick={addToPending} style={{
                flex: 1, padding: '12px 20px', borderRadius: '10px',
                border: '2px solid var(--primary)', background: '#fff',
                color: 'var(--primary)', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
              }}>
                 <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}><Plus size={17} aria-hidden="true" />加入清單</span>
              </button>
              {pendingRecords.length > 0 && (
                <button type="button" onClick={submitAll} disabled={submitting} style={{
                  ...btnPrimary, flex: 2, justifyContent: 'center',
                  opacity: submitting ? 0.7 : 1,
                }}>
                   {submitting ? '儲存中…' : <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Save size={17} aria-hidden="true" />儲存所有紀錄（{pendingRecords.length} 筆）</span>}
                </button>
              )}
            </div>

            {/* Shortcut: quick save single entry */}
            {pendingRecords.length === 0 && (
              <button type="button" onClick={handleQuickSave} disabled={submitting || !value1.trim()} style={{
                ...btnPrimary, width: '100%', justifyContent: 'center',
                opacity: (submitting || !value1.trim()) ? 0.5 : 1,
                fontSize: '15px', padding: '14px 24px',
              }}>
                 {submitting ? '儲存中…' : <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Save size={17} aria-hidden="true" />直接儲存這筆</span>}
              </button>
            )}

            {pendingRecords.length === 0 && (
              <p style={{ textAlign: 'center', fontSize: '12px', color: '#bbb', marginTop: '8px' }}>
                想一次記錄多種數據？先點「加入清單」，再一起送出
              </p>
            )}
          </div>
        )}

        {/* ── File Upload ── */}
        {tab === 'file' && (
          <form onSubmit={handleFileUpload}>
            {uploadedDoc && (() => {
              const fs = docFlowState(uploadedDoc.processing_status || uploadedDoc.status);
              const badge = uploadStatusBadge(uploadedDoc);
              return (
                <div className="hk-card" style={{ marginBottom: 20, borderColor: '#cffafe', background: 'linear-gradient(135deg,#ecfeff,#ffffff)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 15, color: 'var(--hk-ink)' }}><FileText size={18} aria-hidden="true" />{uploadedDoc.file_name || '文件'} 已收到</div>
                    <span className={`hk-badge ${badge.c}`}>{badge.t}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--hk-ink-2)', marginBottom: 10 }}>
                    {badge.text}「已收到」不等於「已確認」；整理完成後會通知你，並連到白話摘要。
                  </div>
                  <UploadStatusTimeline status={uploadedDoc.processing_status || uploadedDoc.status} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={refreshUploadedStatus} className="hk-btn hk-btn-ghost hk-btn-sm">重新整理進度</button>
                    <button type="button" onClick={() => router.push(memberHref('/dashboard/documents', fileMember))} className="hk-btn hk-btn-ghost hk-btn-sm">前往文件庫</button>
                    {fs.active >= DOC_FLOW.length && (
                      <button type="button" onClick={() => router.push(memberHref('/dashboard/health', fileMember))} className="hk-btn hk-btn-ghost hk-btn-sm">查看健康全貌</button>
                    )}
                    <button type="button" onClick={() => setUploadedDoc(null)} className="hk-btn hk-btn-primary hk-btn-sm">再上傳一份</button>
                  </div>
                </div>
              );
            })()}
            <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', boxShadow: 'var(--shadow-sm)', marginBottom: '20px' }}>
              <div style={{
                background: '#fdf1e0', border: '1px solid #fed7aa', color: '#b06a10',
                borderRadius: '12px', padding: '12px 14px', fontSize: '13px',
                lineHeight: 1.6, marginBottom: '20px',
              }}>
                上傳只代表 HealthKeep 收到原始檔案。系統擷取（OCR）與醫療團隊確認是後續處理狀態；未確認前不會視為正式病歷摘要。
                請確認照片四角完整、文字清楚且頁數齊全；模糊、重複或缺頁文件可能會被退件補傳。
                若同一份文件已在文件庫顯示為「整理中」或「已整理」，請勿重複上傳。
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px', marginBottom: '24px',
              }}>
                {UPLOAD_FLOW_STEPS.map((step, index) => (
                  <div key={step.title} style={{
                    border: '1px solid #e3e9ee', borderRadius: '12px',
                    background: index === 0 ? '#e7f3f5' : '#f6f9fa',
                    padding: '12px', minHeight: '104px',
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 900, color: index === 0 ? '#33596a' : '#45596a' }}>
                      {step.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7c8c', lineHeight: 1.55, marginTop: '6px' }}>
                      {step.body}
                    </div>
                  </div>
                ))}
              </div>

              {/* Member select */}
               <div role="group" aria-labelledby={`${formId}-file-member`} style={{ marginBottom: '24px' }}>
                 <div id={`${formId}-file-member`} style={labelStyle}>家庭成員</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {members.map(m => (
                     <button key={m.name} type="button" aria-pressed={fileMember === m.name} onClick={() => selectTargetMember(m.name)} style={{
                       minHeight: 44, padding: '8px 20px', borderRadius: '8px', border: '1px solid',
                      borderColor: fileMember === m.name ? 'var(--primary)' : 'var(--gray-200)',
                      background: fileMember === m.name ? '#e7f1ff' : '#fff',
                      color: fileMember === m.name ? 'var(--primary)' : '#555',
                      fontWeight: fileMember === m.name ? '700' : '500', fontSize: '14px', cursor: 'pointer',
                    }}>{m.name}</button>
                  ))}
                </div>
                {!fileMember && members.length > 1 && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#a97614', fontWeight: 700 }}>
                    請先選擇這份文件屬於哪位家庭成員。
                  </div>
                )}
              </div>

              {/* Doc type */}
              <div style={{ marginBottom: '24px' }}>
                 <label htmlFor={`${formId}-document-type`} style={labelStyle}>文件類型</label>
                 <select id={`${formId}-document-type`} value={docType} onChange={e => setDocType(e.target.value)}
                  style={{ ...inputStyle, background: '#fff' }}>
                  {DOC_TYPES.map(dt => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                </select>
              </div>

              {/* Drop zone */}
              <div style={{ marginBottom: '20px' }}>
                 <div id={`${formId}-document-file-label`} style={labelStyle}>選擇文件</div>
                 <button
                   type="button"
                   aria-labelledby={`${formId}-document-file-label`}
                   aria-describedby={`${formId}-document-file-help`}
                   onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                   style={{
                     width: '100%', color: 'inherit', fontFamily: 'inherit',
                    border: `2px dashed ${dragOver ? 'var(--primary)' : selectedFile ? '#4caf50' : 'var(--gray-300)'}`,
                    borderRadius: '12px', padding: '40px 20px', textAlign: 'center',
                    background: dragOver ? '#e7f1ff' : selectedFile ? '#f0fff4' : '#fafafa',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                 >
                  {selectedFile ? (
                    <>
                       <FileText aria-hidden="true" size={36} style={{ margin: '0 auto 8px', color: '#3e6b7e' }} />
                      <div style={{ fontWeight: '700', color: '#333', fontSize: '15px' }}>{selectedFile.name}</div>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                        {(selectedFile.size / 1024).toFixed(1)} KB · 點擊更換
                      </div>
                      <div style={{ fontSize: '12px', color: '#2e8b57', marginTop: '8px', fontWeight: 700 }}>
                        下一步：送入文件庫並標示為「已上傳，等待整理」
                      </div>
                    </>
                  ) : (
                    <>
                       <FileUp aria-hidden="true" size={40} style={{ margin: '0 auto 12px', color: '#3e6b7e' }} />
                      <div style={{ fontWeight: '600', color: '#555', marginBottom: '4px' }}>拖曳文件到這裡</div>
                      <div style={{ fontSize: '13px', color: '#999' }}>
                         或點擊選擇 · 支援 PDF、HTML、JPG、PNG、DOC、DOCX，單檔最多 25 MB
                      </div>
                    </>
                  )}
                 </button>
                 <div id={`${formId}-document-file-help`} style={{ fontSize: 12, color: '#6b7c8c', marginTop: 8, lineHeight: 1.6 }}>伺服器會再次檢查副檔名、宣告格式與實際內容；不符合時不會保存。</div>
                 {uploadError && <div role="alert" style={{ fontSize: 13, color: '#a03a30', marginTop: 8 }}>{uploadError}</div>}
                 <input ref={fileInputRef} id={`${formId}-document-file`} type="file"
                   accept={DOCUMENT_UPLOAD_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} />
              </div>

              {/* Doc date */}
              <div style={{ marginBottom: '20px' }}>
                 <label htmlFor={`${formId}-document-date`} style={labelStyle}>文件日期</label>
                 <input id={`${formId}-document-date`} type="date" value={docDate}
                  onChange={e => setDocDate(e.target.value)} style={inputStyle} />
              </div>

              {/* Note */}
              <div>
                 <label htmlFor={`${formId}-document-note`} style={labelStyle}>備註（選填）· 點選院所免打字</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {COMMON_HOSPITALS.map(h => (
                    <button key={h} type="button"
                      onClick={() => setFileNote(fileNote.trim() ? `${fileNote.trim()} ${h}` : h)}
                       style={{ minHeight: 44, border: '1px solid var(--gray-300)', borderRadius: '999px', background: '#fff', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#456' }}>
                       新增 {h}
                    </button>
                  ))}
                </div>
                 <textarea id={`${formId}-document-note`} placeholder="例：台大醫院 2025/01 健檢報告…"
                  value={fileNote} onChange={e => setFileNote(e.target.value)}
                  rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
            </div>

             <button type="submit" disabled={!selectedFile || uploading || !canWriteMember(fileMember)} style={{
              ...btnPrimary, width: '100%', justifyContent: 'center',
               opacity: (!selectedFile || uploading || !canWriteMember(fileMember)) ? 0.5 : 1,
              fontSize: '15px', padding: '14px 24px',
            }}>
              {uploading ? '上傳中，尚未辨識內容...' : '上傳並送入待整理'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
