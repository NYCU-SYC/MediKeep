'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { ApiError, api } from '@/lib/api';
import { useSync } from '@/lib/sync';
import { useToast } from '../toast-context';
import { memberDisplayName, normalizeMemberName, uniqueMemberNames } from '@/lib/members';
import type { EvidenceDocument } from '@/lib/evidence';
import { evidenceMeta, evidenceTitle, evidenceUnavailableText } from '@/lib/evidence';
import {
  medicationUsageNeedsSafetyNotice,
  PATIENT_MEDICATION_USAGE_LABELS as USAGE_LABELS,
  PATIENT_MEDICATION_USAGE_OPTIONS as USAGE_OPTIONS,
} from '@/lib/patientStatus';

// ─── Types ────────────────────────────────────────────────────────────────────
type TreatmentType = 'fixed' | 'chronic' | 'prn';

type Medication = {
  id: string;
  member: string;
  category: string;
  name: string;
  generic_name: string;
  dose: string;
  frequency: string;
  treatment_type: TreatmentType;
  start_date: string;
  end_date: string;
  note: string;
  active: boolean;
  color: string;
  verified: boolean;                 // CMO-verified official clinical row
  published: boolean;                // released to the patient-facing medication list
  usageStatus: string | null;        // patient-reported usage overlay (immediate, no approval)
  sourceDocumentId: string | null;
  evidenceDocument: EvidenceDocument | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const MED_COLORS = ['#f44336', '#e91e63', '#9c27b0', '#2196f3', '#4caf50', '#ff9800', '#00bcd4', '#607d8b'];

const MED_CATEGORIES = [
  '降血壓藥', '降血糖藥', '降血脂藥', '抗血栓藥',
  '胃藥', '止痛/消炎藥', '抗生素', '氣喘/過敏藥',
  '甲狀腺藥', '骨質疏鬆藥', '安眠/鎮靜藥', '抗憂鬱藥',
  '心臟用藥', '維生素/保健品', '其他',
];

const FREQ_PRESETS = [
  '一天一次', '一天兩次', '一天三次',
  '早晚各一次', '三餐飯前', '三餐飯後',
  '睡前一次', '每週一次', '需要時服用',
];

const DURATION_PRESETS = [
  { key: '7d',     label: '7 天' },
  { key: '14d',    label: '14 天' },
  { key: '1m',     label: '1 個月' },
  { key: '3m',     label: '3 個月' },
  { key: 'custom', label: '自訂' },
];

const TREATMENT_OPTIONS: { key: TreatmentType; label: string; desc: string; icon: string }[] = [
  { key: 'fixed',   label: '固定療程', desc: '有明確結束日',      icon: '📅' },
  { key: 'chronic', label: '慢性處方', desc: '長期用藥，無結束日', icon: '♾️' },
  { key: 'prn',     label: '需要時服用', desc: '症狀出現才服用',   icon: '🆘' },
];

// ─── API helpers ──────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromApi(m: any): Medication {
  return {
    id: String(m.id),
    member: m.member_name ?? m.member ?? '',
    category: m.category ?? '',
    name: m.drug_name ?? m.name ?? '',
    generic_name: m.generic_name ?? '',
    dose: m.dose ?? '',
    frequency: m.frequency ?? '',
    treatment_type: (m.treatment_type ?? (m.intent === 'prn' ? 'prn' : m.intent === 'fixed' ? 'fixed' : 'chronic')) as TreatmentType,
    start_date: m.started_on ?? m.start_date ?? '',
    end_date: m.end_date ?? '',
    note: m.note ?? '',
    active: m.is_active !== undefined ? Boolean(m.is_active) : Boolean(m.active !== false),
    color: m.color ?? MED_COLORS[3],
    verified: Boolean(m.is_verified),
    published: Boolean(m.is_published),
    usageStatus: m.patient_reported_usage_status ?? null,
    sourceDocumentId: m.source_document_id ?? null,
    evidenceDocument: m.evidence_document ?? null,
  };
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function getTaipeiDate(): string {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function calcEndDate(startDate: string, preset: string): string {
  if (!startDate || preset === 'custom' || !preset) return '';
  const d = new Date(startDate + 'T00:00:00');
  if (preset === '7d')  d.setDate(d.getDate() + 7);
  else if (preset === '14d') d.setDate(d.getDate() + 14);
  else if (preset === '1m')  d.setMonth(d.getMonth() + 1);
  else if (preset === '3m')  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isOfficialMedication(m: Medication) {
  return m.verified || m.published;
}

function medicationErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.message) return err.message;
  return fallback;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px',
  border: '1px solid #ddd', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '6px', display: 'block',
};
const sectionLabel: React.CSSProperties = {
  fontSize: '12px', fontWeight: '700', color: '#aaa', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: '10px', display: 'block',
};
const medEvidenceStyle: React.CSSProperties = {
  marginTop: '6px',
  fontSize: '12px',
  color: '#6b7c8c',
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

// ─── Form State ───────────────────────────────────────────────────────────────
type FormState = {
  category: string;
  name: string;
  generic_name: string;
  dose: string;
  frequency: string;
  freq_is_custom: boolean;
  treatment_type: TreatmentType;
  duration_preset: string;
  start_date: string;
  end_date: string;
  note: string;
  color: string;
};

function getDefaultForm(): FormState {
  const today = getTaipeiDate();
  return {
    category: '', name: '', generic_name: '', dose: '',
    frequency: '一天一次', freq_is_custom: false,
    treatment_type: 'fixed', duration_preset: '7d',
    start_date: today, end_date: calcEndDate(today, '7d'),
    note: '', color: MED_COLORS[3],
  };
}

function formFromMedication(medication: Medication): FormState {
  return {
    category: medication.category,
    name: medication.name,
    generic_name: medication.generic_name,
    dose: medication.dose,
    frequency: medication.frequency,
    freq_is_custom: Boolean(medication.frequency) && !FREQ_PRESETS.includes(medication.frequency),
    treatment_type: medication.treatment_type,
    duration_preset: medication.treatment_type === 'fixed' ? 'custom' : '',
    start_date: medication.start_date || getTaipeiDate(),
    end_date: medication.end_date,
    note: medication.note,
    color: medication.color,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MedicationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const memberNames = useMemo(() => uniqueMemberNames(members.map(m => m.name)), [members]);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const [meds, setMeds] = useState<Medication[]>([]);
  // Start filtered to the globally-selected member, sync on header chip changes
  const [filterMember, setFilterMember] = useState(() => activeMember || '全部');
  const [formMember, setFormMember] = useState(() => activeMember || memberNames[0] || '');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState>(getDefaultForm);
  const [medActionBusy, setMedActionBusy] = useState('');
  const sync = useSync();
  const { showToast } = useToast();
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const selectMemberFilter = (label: string) => {
    const normalized = label === '全部' ? '' : normalizeMemberName(label);
    setFilterMember(label);
    setActiveMember(normalized);
    const params = new URLSearchParams(searchParams.toString());
    if (normalized) {
      params.set('member', normalized);
    } else {
      params.delete('member');
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // Authoritative reload from the server (single source of truth).
  const reloadMeds = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (activeMember) params.member = activeMember;
      const data = await api.get('/api/medications', Object.keys(params).length ? params : undefined);
      setMeds((data as unknown[]).map(fromApi));
    } catch {}
  }, [activeMember]);

  useEffect(() => {
    const load = async () => {
      // One-time localStorage migration from v1
      const legacyV1 = localStorage.getItem('healthkeep_medications_v1');
      if (legacyV1) {
        try {
          const freqMap: Record<string, string> = {
            daily: '一天一次', twice: '一天兩次', three: '一天三次',
            weekly: '每週一次', asneeded: '需要時服用',
          };
          const items = JSON.parse(legacyV1) as Array<Record<string, unknown>>;
          const failed: Array<Record<string, unknown>> = [];
          for (const item of items) {
            try {
              await api.post('/api/medications', {
                drug_name: item.name || item.drug_name || '未知',
                dose: item.dose || item.dosage || null,
                frequency: freqMap[String(item.frequency)] ?? item.frequency ?? null,
                intent: item.frequency === 'asneeded' ? 'prn' : item.end_date ? 'fixed' : 'chronic',
                started_on: item.start_date || null,
                is_active: item.active !== false,
                note: item.note || null,
                member_name: item.member || activeMember,
              });
            } catch {
              failed.push(item);
            }
          }
          if (failed.length > 0) {
            localStorage.setItem('healthkeep_medications_v1', JSON.stringify(failed));
            showToast(`有 ${failed.length} 筆舊用藥尚未同步，資料已保留，稍後會再試`, 'error');
          } else {
            localStorage.removeItem('healthkeep_medications_v1');
          }
        } catch {}
      }

      // One-time localStorage migration from v2
      const legacyV2 = localStorage.getItem('healthkeep_medications_v2');
      if (legacyV2) {
        try {
          const items = JSON.parse(legacyV2) as Array<Record<string, unknown>>;
          const failed: Array<Record<string, unknown>> = [];
          for (const item of items) {
            try {
              await api.post('/api/medications', {
                drug_name: item.name || item.drug_name || '未知',
                dose: item.dose || item.dosage || null,
                frequency: item.frequency || null,
                intent: item.treatment_type || item.intent || 'chronic',
                started_on: item.start_date || item.started_on || null,
                is_active: item.active !== undefined ? item.active : true,
                note: item.note || null,
                member_name: item.member || activeMember,
                category: item.category || null,
                generic_name: item.generic_name || null,
                end_date: item.end_date || null,
                color: item.color || null,
              });
            } catch {
              failed.push(item);
            }
          }
          if (failed.length > 0) {
            localStorage.setItem('healthkeep_medications_v2', JSON.stringify(failed));
            showToast(`有 ${failed.length} 筆舊用藥尚未同步，資料已保留，稍後會再試`, 'error');
          } else {
            localStorage.removeItem('healthkeep_medications_v2');
          }
        } catch {}
      }

      // Fetch from backend
      try {
        const params: Record<string, string> = {};
        if (activeMember) params.member = activeMember;
        const data = await api.get('/api/medications', Object.keys(params).length ? params : undefined);
        setMeds((data as unknown[]).map(fromApi));
      } catch {}
    };
    load();
  }, [activeMember, showToast]);

  // Cross-view sync: refetch when a medication row changes on the server
  // (e.g. the CMO accepts a "stopped" request and publishes it).
  useEffect(() => {
    reloadMeds();
  }, [sync.viewVersions.patient_medications, reloadMeds]);

  // Sync local filter with global member selection
  useEffect(() => { setFilterMember(activeMember || '全部'); }, [activeMember]);
  useEffect(() => {
    setFormMember(current => {
      if (activeMember && current !== activeMember) return activeMember;
      if (!activeMember && !current && memberNames[0]) return memberNames[0];
      return current;
    });
  }, [activeMember, memberNames]);

  const memberOptions = ['全部', ...memberNames];
  const effectiveFormMember = formMember || activeMember || memberNames[0] || '';
  const filtered = meds.filter(m => filterMember === '全部' || m.member === filterMember);
  const active = filtered.filter(m => m.active);
  const inactive = filtered.filter(m => !m.active);

  // Update end_date when start_date or duration_preset changes
  const patchWithCalc = (patch: Partial<FormState>) => {
    setForm(f => {
      const next = { ...f, ...patch };
      if (next.treatment_type === 'fixed' && next.duration_preset !== 'custom') {
        next.end_date = calcEndDate(next.start_date, next.duration_preset);
      }
      return next;
    });
  };

  const saveMed = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!effectiveFormMember) {
      showToast('請先選擇這筆藥物屬於哪位家庭成員', 'error');
      return;
    }
    setMedActionBusy('save');
    try {
      const payload = {
        drug_name: form.name,
        member_name: effectiveFormMember,
        category: form.category || null,
        generic_name: form.generic_name || null,
        dose: form.dose || null,
        frequency: form.frequency || null,
        intent: form.treatment_type,
        treatment_type: form.treatment_type,
        started_on: form.treatment_type !== 'prn' ? form.start_date : null,
        end_date: form.treatment_type === 'fixed' ? form.end_date : null,
        ...(!editingId ? { is_active: true } : {}),
        note: form.note || null,
        color: form.color,
      };
      const saved = editingId
        ? await api.patch(`/api/medications/${editingId}`, payload)
        : await api.post('/api/medications', payload);
      const mapped = fromApi(saved);
      setMeds(prev => (
        editingId
          ? prev.map(medication => medication.id === editingId ? mapped : medication)
          : [mapped, ...prev]
      ));
      setForm(getDefaultForm());
      setShowForm(false);
      showToast(editingId ? '用藥紀錄已更新，立即生效' : '已儲存用藥紀錄', 'success');
      setEditingId(null);
    } catch (err) {
      showToast(medicationErrorMessage(err, '儲存失敗，請稍後再試'), 'error');
    } finally {
      setMedActionBusy('');
    }
  };

  const openCreate = () => {
    setFormMember(activeMember || memberNames[0] || '');
    setEditingId(null);
    setForm(getDefaultForm());
    setShowForm(true);
  };

  const openEdit = (medication: Medication) => {
    if (isOfficialMedication(medication)) {
      showToast('正式處方內容需由醫療團隊更新；你仍可直接調整目前實際用藥狀況。', 'error');
      return;
    }
    setFormMember(medication.member);
    setEditingId(medication.id);
    setForm(formFromMedication(medication));
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActive = async (id: string) => {
    const med = meds.find(m => m.id === id);
    if (!med) return;
    if (isOfficialMedication(med)) {
      showToast('這是醫療團隊確認的官方用藥紀錄；請用「實際狀況」回報目前是否仍在吃。', 'error');
      return;
    }
    setMedActionBusy(`toggle-${id}`);
    try {
      const updated = await api.patch(`/api/medications/${id}`, { is_active: !med.active });
      setMeds(prev => prev.map(m => m.id === id ? { ...m, ...fromApi(updated), active: !med.active } : m));
      showToast(!med.active ? '已標記為用藥中' : '已標記為已停藥', 'success');
    } catch (err) {
      showToast(medicationErrorMessage(err, '更新失敗，請稍後再試'), 'error');
    } finally {
      setMedActionBusy('');
    }
  };

  const remove = async (id: string) => {
    const med = meds.find(m => m.id === id);
    if (!med) return;
    if (isOfficialMedication(med)) {
      showToast('這是醫療團隊確認的官方用藥紀錄，不能直接刪除；請改用實際用藥狀況回報。', 'error');
      return;
    }
    if (!confirm('確定要刪除此藥物紀錄嗎？')) return;
    setMedActionBusy(`delete-${id}`);
    try {
      await api.delete(`/api/medications/${id}`);
      setMeds(prev => prev.filter(m => m.id !== id));
      showToast('已刪除用藥紀錄', 'success');
    } catch (err) {
      showToast(medicationErrorMessage(err, '刪除失敗，請稍後再試'), 'error');
    } finally {
      setMedActionBusy('');
    }
  };

  // ── Patient-reported usage state (two-layer model) ───────────────────────────
  // The user owns "am I actually taking this?" — this takes effect IMMEDIATELY and
  // never waits for CMO approval. The official regimen (m.active) only changes when
  // the medical team reconciles. Optimistic update + toast undo + server sync.
  const setUsageState = async (m: Medication, usage: string) => {
    const previous = m.usageStatus;
    if (usage === previous) return;
    if (
      medicationUsageNeedsSafetyNotice(usage)
      && !confirm('這項回報會立即儲存，但不等於醫師已確認停藥。如有呼吸困難、意識改變或其他嚴重症狀，請立即就醫。要繼續儲存嗎？')
    ) {
      return;
    }
    setMeds(prev => prev.map(x => x.id === m.id ? { ...x, usageStatus: usage } : x));
    try {
      const res = await api.post(`/api/patients/me/medications/${m.id}/usage-state`, {
        usage_status: usage,
      }) as { medication?: { patient_reported_usage_status?: string } };
      const applied = res.medication?.patient_reported_usage_status ?? usage;
      setMeds(prev => prev.map(x => x.id === m.id ? { ...x, usageStatus: applied } : x));
      showToast(`已更新：你目前標記「${USAGE_LABELS[applied] ?? applied}」`, 'success',
        previous ? { label: '改回', durationMs: 8000, onClick: () => setUsageState({ ...m, usageStatus: applied }, previous) } : undefined);
      sync.refreshNow();
    } catch {
      setMeds(prev => prev.map(x => x.id === m.id ? { ...x, usageStatus: previous } : x));
      showToast('更新失敗，請稍後再試', 'error');
    }
  };

  const MedCard = ({ m }: { m: Medication }) => {
    const official = isOfficialMedication(m);
    const toggleBusy = medActionBusy === `toggle-${m.id}`;
    const deleteBusy = medActionBusy === `delete-${m.id}`;
    return (
    <div style={{
      background: '#fff', borderRadius: '14px', padding: '16px 18px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
      display: 'flex', alignItems: 'flex-start', gap: '14px',
      opacity: m.active ? 1 : 0.6,
      borderLeft: `4px solid ${m.color}`,
    }}>
      <div style={{ flex: 1 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '20px' }}>💊</span>
          <span style={{ fontSize: '15px', fontWeight: '700', color: '#111' }}>{m.name}</span>
          {m.dose && (
            <span style={{ fontSize: '12px', background: m.color + '20', color: m.color, padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>
              {m.dose}
            </span>
          )}
          {m.category && (
            <span style={{ fontSize: '11px', background: '#f0f4f8', color: '#555', padding: '2px 8px', borderRadius: '20px' }}>
              {m.category}
            </span>
          )}
          <span style={{
            fontSize: '11px',
            background: m.verified && m.published ? '#e7f4ec' : '#fdf6e3',
            color: m.verified && m.published ? '#2e8b57' : '#92400e',
            padding: '2px 8px',
            borderRadius: '20px',
            fontWeight: 700,
          }}>
            {m.verified && m.published ? '醫療團隊已確認' : '自我回報 / 待確認'}
          </span>
          <span style={{ fontSize: '11px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>
            {m.member}
          </span>
        </div>
        {/* Generic name */}
        {m.generic_name && (
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
            學名：{m.generic_name}
          </div>
        )}
        {/* Frequency + dates */}
        <div style={{ fontSize: '12px', color: '#777', marginBottom: '4px' }}>
          🕐 {m.frequency}
          {m.treatment_type === 'fixed' && m.start_date && (
            <> · 起：{fmtDate(m.start_date)}</>
          )}
          {m.treatment_type === 'fixed' && m.end_date && (
            <> → 至：{fmtDate(m.end_date)}</>
          )}
          {m.treatment_type === 'chronic' && (
            <span style={{ marginLeft: '6px', background: '#e8f5e9', color: '#388e3c', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>慢性處方</span>
          )}
          {m.treatment_type === 'prn' && (
            <span style={{ marginLeft: '6px', background: '#fff3e0', color: '#e65100', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>需要時服用</span>
          )}
        </div>
        {m.note && <div style={{ fontSize: '12px', color: '#999' }}>📝 {m.note}</div>}
        {(m.sourceDocumentId || m.evidenceDocument) && (
          <MedicationEvidenceLine doc={m.evidenceDocument} fallbackId={m.sourceDocumentId} />
        )}
        {/* Two-layer overlay: your reality vs the medical team's record */}
        {m.usageStatus && (
          <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: m.usageStatus === 'taking' ? '#388e3c' : '#e65100' }}>
              你目前標記：{USAGE_LABELS[m.usageStatus] ?? m.usageStatus}
            </span>
            {m.verified && m.usageStatus !== 'taking' && m.active && (
              <span style={{ fontSize: '11px', color: '#93a3af' }}>
                醫療整理紀錄：仍列為使用中 · 已同步給醫療團隊整理
              </span>
            )}
          </div>
        )}
        {official && (
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#6b7c8c', lineHeight: 1.45 }}>
            官方用藥紀錄需由醫療團隊更新；你可以在右側下拉回報目前實際是否仍在使用。
          </div>
        )}
      </div>
      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={() => toggleActive(m.id)}
          disabled={official || toggleBusy || Boolean(medActionBusy && !toggleBusy)}
          title={official ? '官方用藥狀態不可直接改；請用下方實際狀況回報。' : '切換自建用藥紀錄狀態'}
          style={{
          padding: '5px 10px', borderRadius: '8px', border: '1px solid #ddd',
          background: official ? '#f6f9fa' : m.active ? '#e8f5e9' : '#fff',
          color: official ? '#93a3af' : m.active ? '#4caf50' : '#999',
          fontSize: '11px', cursor: official || medActionBusy ? 'not-allowed' : 'pointer', fontWeight: '600',
          opacity: official || toggleBusy ? 0.72 : 1,
        }}>{toggleBusy ? '儲存中…' : m.active ? '用藥中' : '已停藥'}</button>
        {!official && (
          <button
            onClick={() => openEdit(m)}
            disabled={Boolean(medActionBusy)}
            style={{
              padding: '5px 10px', borderRadius: '8px', border: '1px solid #c8d4dc',
              background: '#fff', color: '#45596a', fontSize: '11px',
              cursor: medActionBusy ? 'not-allowed' : 'pointer',
            }}
          >
            修改內容
          </button>
        )}
        {/* Patient-reported usage — takes effect immediately, no CMO approval */}
        <select
          value={m.usageStatus ?? ''}
          onChange={(e) => { if (e.target.value) setUsageState(m, e.target.value); }}
          title="更新你目前的實際用藥狀況（立即生效）"
          style={{
            padding: '5px 8px', borderRadius: '8px', border: '1px solid #ffe0b2',
            background: '#fff8f0', color: '#e65100', fontSize: '11px', cursor: 'pointer', fontWeight: 600,
          }}
        >
          <option value="" disabled>更新實際狀況…</option>
          {USAGE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button
          onClick={() => remove(m.id)}
          disabled={official || deleteBusy || Boolean(medActionBusy && !deleteBusy)}
          title={official ? '官方用藥紀錄不可直接刪除。' : '刪除自建用藥紀錄'}
          style={{
          padding: '5px 10px', borderRadius: '8px', border: '1px solid #eee',
          background: official ? '#f6f9fa' : '#fff', color: official ? '#93a3af' : '#f44336',
          fontSize: '11px', cursor: official || medActionBusy ? 'not-allowed' : 'pointer',
          opacity: official || deleteBusy ? 0.72 : 1,
        }}>{deleteBusy ? '刪除中…' : official ? '不可刪除' : '刪除'}</button>
      </div>
    </div>
    );
  };

  function MedicationEvidenceLine({ doc, fallbackId }: { doc: EvidenceDocument | null; fallbackId: string | null }) {
    if (!doc) {
      return (
        <div style={medEvidenceStyle}>
          原始文件：{fallbackId ? `已記錄 ID：${fallbackId}，但尚未建立可檢視連結` : '尚未連結原始文件'}
        </div>
      );
    }
    if (!doc.available || !doc.download_url) {
      return (
        <div style={medEvidenceStyle}>
          原始文件：{evidenceTitle(doc)} · {evidenceUnavailableText(doc)}
        </div>
      );
    }
    return (
      <div style={medEvidenceStyle}>
        原始文件：
        <a href={doc.download_url} target="_blank" rel="noreferrer" style={{ color: '#3e6b7e', fontWeight: 700, textDecoration: 'none', wordBreak: 'break-word' }}>
          查看 {evidenceTitle(doc)}
        </a>
        {evidenceMeta(doc) && <span style={{ color: '#93a3af' }}> · {evidenceMeta(doc)}</span>}
      </div>
    );
  }

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
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>藥物管理</h2>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>目前顯示：{scopeLabel} · 記錄家庭成員的用藥與處方</p>
          </div>
          <button onClick={showForm && !editingId ? () => setShowForm(false) : openCreate} style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '10px 20px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
          }}>{showForm && !editingId ? '收合新增表單' : '+ 新增藥物'}</button>
        </div>

        {/* No members */}
        {members.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>👨‍👩‍👧‍👦</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>請先新增家庭成員</div>
            <button onClick={() => router.push('/dashboard/settings')} style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              前往設定 →
            </button>
          </div>
        )}

        {/* ── Add Form ── */}
        {showForm && members.length > 0 && (
          <form onSubmit={saveMed} style={{
            background: '#fff', borderRadius: '16px', padding: '24px',
            boxShadow: '0 1px 6px rgba(0,0,0,0.07)', marginBottom: '24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', margin: 0 }}>{editingId ? '修改我的用藥紀錄' : '新增用藥紀錄'}</h3>
              <span className="hk-badge hk-b-green">立即生效</span>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>這筆藥物屬於誰 <span style={{ color: '#f44336' }}>*</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {memberNames.map(name => {
                  const memberMeta = members.find(m => m.name === name);
                  const selected = effectiveFormMember === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setFormMember(name)}
                      style={{
                        padding: '7px 14px', borderRadius: '999px', border: '1px solid',
                        borderColor: selected ? (memberMeta?.color || 'var(--primary)') : '#ddd',
                        background: selected ? (memberMeta?.color || 'var(--primary)') : '#fff',
                        color: selected ? '#fff' : '#555',
                        fontSize: '13px', fontWeight: selected ? 800 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {name}{memberMeta?.relation ? ` · ${memberMeta.relation}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 1. 藥物種類 chips */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>
                藥物種類
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '6px' }}>（選填，點擊快速分類）</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {MED_CATEGORIES.map(cat => (
                  <button key={cat} type="button"
                    onClick={() => setForm(f => ({ ...f, category: f.category === cat ? '' : cat }))}
                    style={{
                      padding: '4px 12px', borderRadius: '20px', border: '1px solid',
                      borderColor: form.category === cat ? 'var(--primary)' : '#ddd',
                      background: form.category === cat ? '#e7f1ff' : '#f8f9fa',
                      color: form.category === cat ? 'var(--primary)' : '#666',
                      fontSize: '12px', cursor: 'pointer',
                      fontWeight: form.category === cat ? '700' : '400',
                    }}>{cat}</button>
                ))}
              </div>
            </div>

            {/* 2. 藥名 + 學名 + 劑量 + 顏色 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              <div>
                <label style={labelStyle}>藥名 / 品名 <span style={{ color: '#f44336' }}>*</span></label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle} placeholder="例：Norvasc、脈優" required />
              </div>
              <div>
                <label style={labelStyle}>學名 / 成分名
                  <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
                </label>
                <input value={form.generic_name} onChange={e => setForm(f => ({ ...f, generic_name: e.target.value }))}
                  style={inputStyle} placeholder="例：Amlodipine" />
              </div>
              <div>
                <label style={labelStyle}>劑量
                  <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
                </label>
                <input value={form.dose} onChange={e => setForm(f => ({ ...f, dose: e.target.value }))}
                  style={inputStyle} placeholder="例：5mg、半顆" />
              </div>
              <div>
                <label style={labelStyle}>標籤顏色</label>
                <div style={{ display: 'flex', gap: '6px', paddingTop: '6px', flexWrap: 'wrap' }}>
                  {MED_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} style={{
                      width: '28px', height: '28px', borderRadius: '8px', background: c, cursor: 'pointer',
                      border: form.color === c ? '3px solid #222' : '2px solid transparent',
                    }} />
                  ))}
                </div>
              </div>
            </div>

            {/* 3. 服藥頻次 */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>服藥頻次</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {FREQ_PRESETS.map(f => (
                  <button key={f} type="button"
                    onClick={() => setForm(prev => ({ ...prev, frequency: f, freq_is_custom: false }))}
                    style={{
                      padding: '5px 12px', borderRadius: '20px', border: '1px solid',
                      borderColor: !form.freq_is_custom && form.frequency === f ? 'var(--primary)' : '#ddd',
                      background: !form.freq_is_custom && form.frequency === f ? '#e7f1ff' : '#f8f9fa',
                      color: !form.freq_is_custom && form.frequency === f ? 'var(--primary)' : '#666',
                      fontSize: '12px', cursor: 'pointer',
                      fontWeight: !form.freq_is_custom && form.frequency === f ? '700' : '400',
                    }}>{f}</button>
                ))}
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, freq_is_custom: true, frequency: '' }))}
                  style={{
                    padding: '5px 12px', borderRadius: '20px', border: '1px solid',
                    borderColor: form.freq_is_custom ? 'var(--primary)' : '#ddd',
                    background: form.freq_is_custom ? '#e7f1ff' : '#f8f9fa',
                    color: form.freq_is_custom ? 'var(--primary)' : '#666',
                    fontSize: '12px', cursor: 'pointer',
                    fontWeight: form.freq_is_custom ? '700' : '400',
                  }}>自訂...</button>
              </div>
              {form.freq_is_custom && (
                <input value={form.frequency}
                  onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                  style={inputStyle} placeholder="例：每天早上餐後一顆" autoFocus required={form.freq_is_custom} />
              )}
            </div>

            {/* 4. 用藥方式 (treatment type) */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>用藥方式</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {TREATMENT_OPTIONS.map(opt => (
                  <button key={opt.key} type="button"
                    onClick={() => patchWithCalc({ treatment_type: opt.key })}
                    style={{
                      padding: '12px 8px', borderRadius: '12px', border: '1.5px solid',
                      borderColor: form.treatment_type === opt.key ? 'var(--primary)' : '#ddd',
                      background: form.treatment_type === opt.key ? '#e7f1ff' : '#fafafa',
                      color: form.treatment_type === opt.key ? 'var(--primary)' : '#555',
                      cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
                    }}>
                    <div style={{ fontSize: '22px', marginBottom: '4px' }}>{opt.icon}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700' }}>{opt.label}</div>
                    <div style={{ fontSize: '11px', color: form.treatment_type === opt.key ? '#5b9ef5' : '#aaa', marginTop: '2px' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 5. Date fields – conditional on treatment type */}
            {form.treatment_type !== 'prn' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>開始日期</label>
                <input type="date" value={form.start_date}
                  onChange={e => patchWithCalc({ start_date: e.target.value })}
                  style={inputStyle} />
              </div>
            )}

            {form.treatment_type === 'fixed' && (
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>療程長度</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {DURATION_PRESETS.map(d => (
                    <button key={d.key} type="button"
                      onClick={() => patchWithCalc({ duration_preset: d.key })}
                      style={{
                        padding: '6px 16px', borderRadius: '20px', border: '1px solid',
                        borderColor: form.duration_preset === d.key ? 'var(--primary)' : '#ddd',
                        background: form.duration_preset === d.key ? '#e7f1ff' : '#f8f9fa',
                        color: form.duration_preset === d.key ? 'var(--primary)' : '#666',
                        fontSize: '13px', cursor: 'pointer',
                        fontWeight: form.duration_preset === d.key ? '700' : '400',
                      }}>{d.label}</button>
                  ))}
                </div>
                {form.duration_preset !== 'custom' && form.end_date && (
                  <div style={{
                    fontSize: '13px', color: '#4caf50', fontWeight: '600',
                    background: '#f0fff4', borderRadius: '8px', padding: '8px 12px',
                    display: 'inline-block',
                  }}>
                    預估結束日：{fmtDate(form.end_date)}
                  </div>
                )}
                {form.duration_preset === 'custom' && (
                  <div style={{ marginTop: '8px' }}>
                    <label style={labelStyle}>結束日期</label>
                    <input type="date" value={form.end_date}
                      onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                      style={inputStyle} />
                  </div>
                )}
              </div>
            )}

            {form.treatment_type === 'chronic' && (
              <div style={{ background: '#e8f5e9', borderRadius: '10px', padding: '10px 14px', marginBottom: '20px', fontSize: '13px', color: '#388e3c' }}>
                ♾️ 慢性處方：長期用藥，系統不設結束日。需停藥時，請將此藥標記為「已停藥」。
              </div>
            )}

            {form.treatment_type === 'prn' && (
              <div style={{ background: '#fff3e0', borderRadius: '10px', padding: '10px 14px', marginBottom: '20px', fontSize: '13px', color: '#e65100' }}>
                🆘 需要時服用：不設固定日期，有症狀時才服用，不需要每天追蹤。
              </div>
            )}

            {/* 6. 備註 */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>備註
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（注意事項、副作用、醫師叮囑…）</span>
              </label>
              <textarea value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                rows={2} style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="例：飯後服用，需避免與葡萄柚汁同服" />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={medActionBusy === 'save'} style={{
                background: 'var(--primary)', color: '#fff', border: 'none',
                padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: medActionBusy === 'save' ? 'wait' : 'pointer',
                opacity: medActionBusy === 'save' ? 0.72 : 1,
              }}>{medActionBusy === 'save' ? '儲存中…' : editingId ? '儲存修改' : '儲存'}</button>
              <button type="button" disabled={medActionBusy === 'save'} onClick={() => { setShowForm(false); setEditingId(null); setForm(getDefaultForm()); }} style={{
                background: '#f8f9fa', color: '#666', border: 'none',
                padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: medActionBusy === 'save' ? 'not-allowed' : 'pointer',
                opacity: medActionBusy === 'save' ? 0.72 : 1,
              }}>取消</button>
            </div>
          </form>
        )}

        {/* Member filter */}
        {members.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <div className="desktop-only" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {memberOptions.map(m => (
                <button key={m} onClick={() => selectMemberFilter(m)} style={{
                  padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                  borderColor: filterMember === m ? 'var(--primary)' : '#ddd',
                  background: filterMember === m ? 'var(--primary)' : '#fff',
                  color: filterMember === m ? '#fff' : '#555', fontSize: '13px', cursor: 'pointer',
                }}>{m}</button>
              ))}
            </div>
            {inactive.length > 0 && (
              <button onClick={() => setShowInactive(v => !v)} style={{
                padding: '6px 14px', borderRadius: '20px', border: '1px solid #ddd',
                background: showInactive ? '#f0f4f8' : '#fff', color: '#666', fontSize: '13px', cursor: 'pointer',
              }}>{showInactive ? '隱藏已停藥' : `顯示已停藥（${inactive.length}）`}</button>
            )}
          </div>
        )}

        {/* Active meds */}
        {active.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <span style={sectionLabel}>用藥中 · {active.length} 項</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {active.map(m => <MedCard key={m.id} m={m} />)}
            </div>
          </div>
        )}

        {/* Inactive meds */}
        {showInactive && inactive.length > 0 && (
          <div>
            <span style={sectionLabel}>已停藥 · {inactive.length} 項</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {inactive.map(m => <MedCard key={m.id} m={m} />)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {members.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 32px', background: '#fff', borderRadius: '20px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>💊</div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#111', marginBottom: '10px' }}>{scopeLabel}目前沒有用藥紀錄</h3>
            <p style={{ fontSize: '14px', color: '#888', lineHeight: 1.7, maxWidth: '320px', margin: '0 auto 24px' }}>
              記錄每位成員的藥物、劑量與服用頻率，<br />回診時一目瞭然，不再漏填
            </p>
            <button onClick={() => { setFormMember(activeMember || memberNames[0] || ''); setShowForm(true); }} style={{
              background: 'var(--primary)', color: '#fff', border: 'none',
              padding: '12px 28px', borderRadius: '12px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
            }}>+ 新增第一筆用藥</button>
          </div>
        )}
      </div>
    </div>
  );
}
