'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { api } from '@/lib/api';
import { useToast } from '../toast-context';
import { useSync } from '@/lib/sync';
import { memberDisplayName, normalizeMemberName, uniqueMemberNames } from '@/lib/members';
import type { EvidenceDocument } from '@/lib/evidence';
import { evidenceMeta, evidenceTitle, evidenceUnavailableText } from '@/lib/evidence';

// ─── Types ────────────────────────────────────────────────────────────────────
type Status = 'active' | 'managed' | 'resolved';
type HistoryTag = 'has_symptoms' | 'no_symptoms' | 'on_medication' | 'follow_up';

type Condition = {
  id: string;
  member: string;
  name: string;
  diagnosed_date: string;
  status: Status;
  history_tags: HistoryTag[];
  note: string;
  verified: boolean;
  published: boolean;
  sourceDocumentId: string | null;
  evidenceDocument: EvidenceDocument | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_INFO: Record<Status, { label: string; color: string; bg: string }> = {
  active:   { label: '追蹤中',  color: '#f44336', bg: '#fff0f0' },
  managed:  { label: '控制穩定', color: '#ff9800', bg: '#fff9e6' },
  resolved: { label: '已痊癒',  color: '#4caf50', bg: '#f0fff4' },
};

const HISTORY_TAG_INFO: Record<HistoryTag, { label: string; icon: string; color: string; bg: string }> = {
  has_symptoms:  { label: '有症狀',  icon: '⚠️', color: '#f44336', bg: '#fff0f0' },
  no_symptoms:   { label: '無症狀',  icon: '✓',  color: '#4caf50', bg: '#f0fff4' },
  on_medication: { label: '有吃藥',  icon: '💊', color: '#2196f3', bg: '#e3f2fd' },
  follow_up:     { label: '有回診',  icon: '🏥', color: '#9c27b0', bg: '#f3e5f5' },
};

const COMMON_CONDITIONS = [
  '高血壓', '糖尿病', '高血脂', '心臟病', '慢性腎病',
  '氣喘', '慢性阻塞性肺病', '骨質疏鬆', '甲狀腺疾病', '痛風',
  '關節炎', '憂鬱症', '睡眠呼吸中止',
];

// ─── API helpers ──────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromApi(c: any): Condition {
  return {
    id: String(c.id),
    member: c.member_name ?? c.member ?? '',
    name: c.display_name ?? c.name ?? '',
    diagnosed_date: c.onset_date ?? c.diagnosed_date ?? '',
    status: c.status ?? 'active',
    history_tags: Array.isArray(c.history_tags) ? c.history_tags : [],
    note: c.note ?? '',
    verified: Boolean(c.is_verified),
    published: Boolean(c.is_published),
    sourceDocumentId: c.source_document_id ?? null,
    evidenceDocument: c.evidence_document ?? null,
  };
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
const evidenceLineStyle: React.CSSProperties = {
  marginTop: '8px',
  paddingTop: '8px',
  borderTop: '1px dashed #e2e8f0',
  fontSize: '12px',
  color: '#64748b',
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

// ─── Form State ───────────────────────────────────────────────────────────────
type FormState = { name: string; diagnosed_date: string; status: Status; history_tags: HistoryTag[]; note: string };
const FORM_DEFAULT: FormState = { name: '', diagnosed_date: '', status: 'active', history_tags: [], note: '' };

// ─── Sub-component: HistoryTagRow ─────────────────────────────────────────────
function HistoryTagRow({
  selected, onChange,
}: { selected: HistoryTag[]; onChange: (tags: HistoryTag[]) => void }) {
  const toggle = (tag: HistoryTag) => {
    if (selected.includes(tag)) onChange(selected.filter(t => t !== tag));
    else onChange([...selected, tag]);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {(Object.keys(HISTORY_TAG_INFO) as HistoryTag[]).map(tag => {
        const info = HISTORY_TAG_INFO[tag];
        const isOn = selected.includes(tag);
        return (
          <button key={tag} type="button" onClick={() => toggle(tag)} style={{
            padding: '6px 14px', borderRadius: '20px', border: '1.5px solid',
            borderColor: isOn ? info.color : '#ddd',
            background: isOn ? info.bg : '#f8f9fa',
            color: isOn ? info.color : '#666',
            fontSize: '13px', cursor: 'pointer',
            fontWeight: isOn ? '700' : '400',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            <span>{info.icon}</span>
            <span>{info.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ConditionEvidenceLine({ doc, fallbackId, verified }: { doc: EvidenceDocument | null; fallbackId: string | null; verified: boolean }) {
  if (!doc) {
    return (
      <div style={evidenceLineStyle}>
        原始文件：{fallbackId ? `已記錄 ID：${fallbackId}，但尚未建立可檢視連結` : verified ? '尚未連結原始文件，請以醫療團隊確認狀態與正式病歷為準' : '自我回報資料，尚未連結原始文件'}
      </div>
    );
  }
  if (!doc.available || !doc.download_url) {
    return (
      <div style={evidenceLineStyle}>
        原始文件：{evidenceTitle(doc)} · {evidenceUnavailableText(doc)}
      </div>
    );
  }
  return (
    <div style={evidenceLineStyle}>
      原始文件：
      <a href={doc.download_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}>
        查看 {evidenceTitle(doc)}
      </a>
      {evidenceMeta(doc) && <span style={{ color: '#94a3b8' }}> · {evidenceMeta(doc)}</span>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ConditionsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const memberNames = useMemo(() => uniqueMemberNames(members.map(m => m.name)), [members]);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const sync = useSync();
  // Refetch when the CMO publishes/updates a problem or condition so the
  // patient's disease list reflects the official record without a manual reload.
  const conditionsVersion = Math.max(
    sync.viewVersions['patient_problem_detail'] ?? 0,
    sync.viewVersions['patient_dashboard'] ?? 0,
  );
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formMember, setFormMember] = useState(activeMember || members[0]?.name || '');
  const [form, setForm] = useState<FormState>(FORM_DEFAULT);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const selectMemberFilter = (label: string) => {
    const normalized = label === '全部' ? '' : normalizeMemberName(label);
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

  useEffect(() => {
    const load = async () => {
      // One-time localStorage migration
      const legacy = localStorage.getItem('healthkeep_conditions_v1');
      if (legacy) {
        try {
          const items = JSON.parse(legacy);
          for (const item of items) {
            await api.post('/api/conditions', {
              display_name: item.name || item.display_name || '未知',
              member_name: item.member || activeMember,
              status: item.status || 'active',
              onset_date: item.onsetDate || item.onset_date || item.diagnosed_date || null,
              note: item.note || null,
            }).catch(() => {});
          }
        } catch {}
        localStorage.removeItem('healthkeep_conditions_v1');
      }

      // Fetch from backend
      try {
        const params: Record<string, string> = {};
        if (activeMember) params.member = activeMember;
        const data = await api.get('/api/conditions', Object.keys(params).length ? params : undefined);
        setConditions((data as unknown[]).map(fromApi));
      } catch {}
    };
    load();
  }, [activeMember, conditionsVersion]);

  const memberOptions = ['全部', ...memberNames];
  const filterMember = activeMember || '全部';
  const effectiveFormMember = formMember || activeMember || members[0]?.name || '';
  const filtered = conditions.filter(c => filterMember === '全部' || c.member === filterMember);
  const active = filtered.filter(c => c.status !== 'resolved');
  const resolved = filtered.filter(c => c.status === 'resolved');

  const addCondition = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!effectiveFormMember) {
      showToast('請先選擇這筆病史屬於哪位家庭成員', 'error');
      return;
    }
    try {
      const created = await api.post('/api/conditions', {
        display_name: form.name,
        member_name: effectiveFormMember,
        status: form.status,
        onset_date: form.diagnosed_date || null,
        note: form.note || null,
        history_tags: form.history_tags,
      });
      await api.post('/api/patients/me/problems/request-create', {
        display_name: form.name,
        display_layman: form.name,
        status: form.status === 'resolved' ? 'resolved' : 'following',
        is_suspected: true,
        onset_date: form.diagnosed_date || null,
        patient_note: `對象：${effectiveFormMember}。${form.note || '使用者自我回報的健康狀況，待醫療團隊確認。'}`,
      }).catch(() => null);
      setConditions(prev => [fromApi(created), ...prev]);
      setForm(FORM_DEFAULT);
      setShowForm(false);
      showToast('已新增自我回報，並送交醫療團隊確認', 'success');
    } catch {
      showToast('新增失敗，請稍後再試', 'error');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('確定要刪除這筆病史紀錄嗎？')) return;
    try {
      await api.delete(`/api/conditions/${id}`);
      setConditions(prev => prev.filter(c => c.id !== id));
    } catch {}
  };

  const updateStatus = async (id: string, status: Status) => {
    try {
      const updated = await api.patch(`/api/conditions/${id}`, { status });
      setConditions(prev => prev.map(c => c.id === id ? { ...c, ...fromApi(updated), status } : c));
    } catch {}
  };

  const updateHistoryTags = async (id: string, tags: HistoryTag[]) => {
    try {
      const updated = await api.patch(`/api/conditions/${id}`, { history_tags: tags });
      setConditions(prev => prev.map(c => c.id === id ? { ...c, ...fromApi(updated), history_tags: tags } : c));
    } catch {}
  };

  const ConditionCard = ({ c }: { c: Condition }) => {
    const st = STATUS_INFO[c.status];
    return (
      <div style={{
        background: '#fff', borderRadius: '14px', padding: '16px 18px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
        borderLeft: `4px solid ${st.color}`,
        display: 'flex', alignItems: 'flex-start', gap: '14px',
      }}>
        <div style={{ flex: 1 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: '700', color: '#111' }}>{c.name}</span>
            <span style={{
              fontSize: '11px', background: st.bg, color: st.color,
              padding: '2px 8px', borderRadius: '20px', fontWeight: '600',
            }}>{st.label}</span>
            <span style={{
              fontSize: '11px',
              background: c.verified && c.published ? '#ecfdf5' : '#fef3c7',
              color: c.verified && c.published ? '#047857' : '#92400e',
              padding: '2px 8px',
              borderRadius: '20px',
              fontWeight: '700',
            }}>
              {c.verified && c.published ? '醫療團隊已確認' : '自我回報 / 待確認'}
            </span>
            <span style={{ fontSize: '11px', background: '#f0f4f8', color: '#666', padding: '2px 8px', borderRadius: '20px' }}>
              {c.member}
            </span>
          </div>

          {/* Diagnosed date */}
          {c.diagnosed_date && (
            <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
              📅 確診：{new Date(c.diagnosed_date + 'T00:00:00').toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          )}

          {/* History tags (interactive) */}
          <div style={{ marginBottom: c.note ? '8px' : 0 }}>
            <div style={{ fontSize: '11px', color: '#bbb', fontWeight: '600', marginBottom: '6px' }}>病史狀況（點擊更新）</div>
            <HistoryTagRow
              selected={c.history_tags}
              onChange={tags => updateHistoryTags(c.id, tags)}
            />
          </div>

          {c.note && (
            <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.5, marginTop: '8px' }}>
              📝 {c.note}
            </div>
          )}

          {(c.verified || c.published || c.sourceDocumentId || c.evidenceDocument) && (
            <ConditionEvidenceLine doc={c.evidenceDocument} fallbackId={c.sourceDocumentId} verified={c.verified || c.published} />
          )}

          {/* Quick status change */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
            {(Object.keys(STATUS_INFO) as Status[]).map(s => (
              <button key={s} onClick={() => updateStatus(c.id, s)} style={{
                padding: '3px 10px', borderRadius: '20px', border: '1px solid',
                borderColor: c.status === s ? STATUS_INFO[s].color : '#ddd',
                background: c.status === s ? STATUS_INFO[s].bg : '#fff',
                color: c.status === s ? STATUS_INFO[s].color : '#999',
                fontSize: '11px', cursor: 'pointer',
                fontWeight: c.status === s ? '700' : '400',
              }}>{STATUS_INFO[s].label}</button>
            ))}
          </div>
        </div>

        <button onClick={() => remove(c.id)} style={{
          padding: '4px 8px', border: '1px solid #eee', borderRadius: '8px',
          background: '#fff', color: '#f44336', fontSize: '12px', cursor: 'pointer', flexShrink: 0,
        }}>刪除</button>
      </div>
    );
  };

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <button onClick={() => router.back()} style={{
            width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
            border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
            color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, boxShadow: 'var(--shadow-sm)',
          }}>←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>慢性病管理</h2>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>目前顯示：{scopeLabel} · 記錄家庭成員的疾病史與慢性病</p>
          </div>
          <button onClick={() => {
            setFormMember(activeMember || members[0]?.name || '');
            setShowForm(v => !v);
          }} style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '10px 20px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
          }}>+ 新增病史</button>
        </div>

        {/* No members */}
        {members.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>👨‍👩‍👧‍👦</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>請先新增家庭成員</div>
            <button onClick={() => router.push('/dashboard/settings')} style={{
              color: 'var(--primary)', border: 'none', background: 'none',
              cursor: 'pointer', fontWeight: '600', fontSize: '14px',
            }}>前往設定 →</button>
          </div>
        )}

        {/* ── Add Form ── */}
        {showForm && members.length > 0 && (
          <form onSubmit={addCondition} style={{
            background: '#fff', borderRadius: '16px', padding: '24px',
            boxShadow: '0 1px 6px rgba(0,0,0,0.07)', marginBottom: '24px',
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px' }}>新增病史紀錄</h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>這筆病史屬於誰 <span style={{ color: '#f44336' }}>*</span></label>
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
                );})}
              </div>
            </div>

            {/* Quick-add chips */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>常見慢性病（點擊快速填入）</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {COMMON_CONDITIONS.map(name => (
                  <button key={name} type="button"
                    onClick={() => setForm(f => ({ ...f, name }))}
                    style={{
                      padding: '4px 12px', borderRadius: '20px', border: '1px solid',
                      borderColor: form.name === name ? 'var(--primary)' : '#ddd',
                      background: form.name === name ? '#e7f1ff' : '#f8f9fa',
                      color: form.name === name ? 'var(--primary)' : '#666',
                      fontSize: '12px', cursor: 'pointer',
                      fontWeight: form.name === name ? '700' : '400',
                    }}>{name}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>疾病名稱 <span style={{ color: '#f44336' }}>*</span></label>
                <input value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle} placeholder="例：高血壓" required />
              </div>
              <div>
                <label style={labelStyle}>確診日期
                  <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（選填）</span>
                </label>
                <input type="date" value={form.diagnosed_date}
                  onChange={e => setForm(f => ({ ...f, diagnosed_date: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>目前狀態</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(Object.keys(STATUS_INFO) as Status[]).map(s => (
                    <button key={s} type="button"
                      onClick={() => setForm(f => ({ ...f, status: s }))}
                      style={{
                        flex: 1, padding: '8px', borderRadius: '8px', border: '1.5px solid',
                        borderColor: form.status === s ? STATUS_INFO[s].color : '#ddd',
                        background: form.status === s ? STATUS_INFO[s].bg : '#fff',
                        color: form.status === s ? STATUS_INFO[s].color : '#666',
                        fontSize: '13px', cursor: 'pointer',
                        fontWeight: form.status === s ? '700' : '400',
                      }}>{STATUS_INFO[s].label}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* History tags */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>病史狀況
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（可複選，選填）</span>
              </label>
              <HistoryTagRow
                selected={form.history_tags}
                onChange={tags => setForm(f => ({ ...f, history_tags: tags }))}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>備註
                <span style={{ color: '#aaa', fontWeight: 400, marginLeft: '4px' }}>（用藥、注意事項…）</span>
              </label>
              <textarea value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                rows={2} style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="例：每天服用 Amlodipine 5mg，需定期追蹤腎功能" />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" style={{
                background: 'var(--primary)', color: '#fff', border: 'none',
                padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer',
              }}>儲存</button>
              <button type="button" onClick={() => { setShowForm(false); setForm(FORM_DEFAULT); }} style={{
                background: '#f8f9fa', color: '#666', border: 'none',
                padding: '10px 24px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer',
              }}>取消</button>
            </div>
          </form>
        )}

        {/* Member filter */}
        {members.length > 0 && (
          <div className="desktop-only" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {memberOptions.map(m => (
              <button key={m} onClick={() => selectMemberFilter(m)} style={{
                padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                borderColor: filterMember === m ? 'var(--primary)' : '#ddd',
                background: filterMember === m ? 'var(--primary)' : '#fff',
                color: filterMember === m ? '#fff' : '#555',
                fontSize: '13px', cursor: 'pointer',
              }}>{m}</button>
            ))}
          </div>
        )}

        {/* Active conditions */}
        {members.length > 0 && active.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <span style={sectionLabel}>進行中 · {active.length} 項</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {active.map(c => <ConditionCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {/* Resolved */}
        {resolved.length > 0 && (
          <div>
            <span style={sectionLabel}>已痊癒 · {resolved.length} 項</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {resolved.map(c => <ConditionCard key={c.id} c={c} />)}
            </div>
          </div>
        )}

        {/* Empty state */}
        {members.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 32px', background: '#fff', borderRadius: '20px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🏥</div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#111', marginBottom: '10px' }}>{scopeLabel}目前沒有病史紀錄</h3>
            <p style={{ fontSize: '14px', color: '#888', lineHeight: 1.7, maxWidth: '320px', margin: '0 auto 24px' }}>
              統一記錄高血壓、糖尿病等慢性病，<br />並追蹤每位家庭成員的健康狀況
            </p>
            <button onClick={() => {
              setFormMember(activeMember || members[0]?.name || '');
              setShowForm(true);
            }} style={{
              background: 'var(--primary)', color: '#fff', border: 'none',
              padding: '12px 28px', borderRadius: '12px', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
            }}>+ 新增第一筆病史</button>
          </div>
        )}
      </div>
    </div>
  );
}
