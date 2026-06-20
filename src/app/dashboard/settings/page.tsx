'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { api } from '@/lib/api';
import { useToast } from '../toast-context';
import type { PatientChangeRequest } from '@/lib/healthkeepTypes';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px',
  border: '1px solid var(--gray-300)', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: '13px', fontWeight: '600', color: '#555', marginBottom: '6px', display: 'block',
};
const sectionCard: React.CSSProperties = {
  background: '#fff', borderRadius: '16px', padding: '28px', boxShadow: 'var(--shadow-sm)', marginBottom: '20px',
};
const sectionTitle: React.CSSProperties = {
  fontSize: '16px', fontWeight: '800', color: '#111', marginBottom: '20px',
  paddingBottom: '12px', borderBottom: '1px solid var(--gray-100)',
};

const COLORS = ['#f44336', '#e91e63', '#9c27b0', '#2196f3', '#4caf50', '#ff9800', '#00bcd4', '#795548'];

const NOTIFY_OPTIONS = [
  { key: 'appt_before_1d', label: '回診前 1 天提醒' },
  { key: 'appt_before_3d', label: '回診前 3 天提醒' },
  { key: 'abnormal_trend', label: '指標異常趨勢警示' },
  { key: 'weekly_summary', label: '每週健康摘要' },
  { key: 'med_refill',     label: '藥物即將用完提醒' },
];

const REQUEST_STATUS_COPY: Record<string, { label: string; bg: string; fg: string; next: string }> = {
  draft: { label: '草稿', bg: '#f1f5f9', fg: '#475569', next: '可補充後送出。' },
  pending_review: { label: '已送交醫療團隊確認', bg: '#fef3c7', fg: '#92400e', next: '醫療團隊會確認後回覆。' },
  needs_clarification: { label: '醫療團隊需要你補充', bg: '#fff7ed', fg: '#c2410c', next: '請補充說明，或先撤回。' },
  accepted: { label: '已確認', bg: '#ecfdf5', fg: '#047857', next: '資料已由醫療團隊確認。' },
  modified_and_accepted: { label: '已由醫療團隊修正後確認', bg: '#ecfdf5', fg: '#047857', next: '醫療團隊已依最終內容整理。' },
  needs_secondary_review: { label: '醫療團隊整理中', bg: '#eef2ff', fg: '#3730a3', next: '資料已初步處理，仍需再次確認後發布。' },
  rejected: { label: '未採用', bg: '#fff1f2', fg: '#be123c', next: '本次內容未納入正式健康檔案。' },
  withdrawn: { label: '已撤回', bg: '#f1f5f9', fg: '#64748b', next: '你已撤回這次異動。' },
};

function summarizePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length === 0) return '未填寫補充內容';
  return entries.slice(0, 4).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ');
}

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { members, setMembers } = useActiveMember();
  const [changeRequests, setChangeRequests] = useState<PatientChangeRequest[]>([]);

  // ── Family info ──────────────────────────────────────────────────────────────
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [savingFamily, setSavingFamily] = useState(false);
  const [familySaved, setFamilySaved] = useState(false);

  useEffect(() => {
    fetch('/api/auth/family', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.join_code)    setJoinCode(d.join_code);
        if (d?.family_name)  setFamilyName(d.family_name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/api/patients/me/change-requests')
      .then(data => setChangeRequests(Array.isArray(data) ? data as PatientChangeRequest[] : []))
      .catch(() => setChangeRequests([]));
  }, []);

  const withdrawRequest = async (id: string) => {
    try {
      const updated = await api.post(`/api/patients/me/change-requests/${id}/withdraw`) as PatientChangeRequest;
      setChangeRequests(prev => prev.map(req => req.id === id ? updated : req));
      showToast('已撤回異動請求', 'info');
    } catch {
      showToast('撤回失敗，可能已被醫療團隊處理', 'error');
    }
  };

  const supplementRequest = async (req: PatientChangeRequest) => {
    const note = window.prompt('請補充醫療團隊需要確認的內容', '');
    if (note === null) return;
    try {
      await api.patch(`/api/patients/me/change-requests/${req.id}`, {
        proposed_payload: req.proposed_payload,
        patient_note: [req.patient_note, note.trim()].filter(Boolean).join('\n補充：'),
      });
      const updated = await api.post(`/api/patients/me/change-requests/${req.id}/submit`) as PatientChangeRequest;
      setChangeRequests(prev => prev.map(item => item.id === updated.id ? updated : item));
      showToast('已補充並重新送交醫療團隊確認', 'success');
    } catch {
      showToast('補充失敗，請稍後再試', 'error');
    }
  };

  const saveFamilyName = async () => {
    if (!familyName.trim()) return;
    setSavingFamily(true);
    try {
      await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ family_name: familyName.trim() }),
      });
      setFamilySaved(true);
      setTimeout(() => setFamilySaved(false), 2000);
    } finally {
      setSavingFamily(false);
    }
  };

  const copyCode = () => {
    if (!joinCode) return;
    navigator.clipboard.writeText(joinCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  // ── Member management ────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', relation: '', age: '', gender: '男', color: COLORS[0] });
  const [addingMember, setAddingMember] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<{ id: string; name: string; relation: string; age: string; gender: string; color: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const addMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAddingMember(true);
    try {
      const resp = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newMember.name.trim(),
          relation: newMember.relation.trim(),
          age: newMember.age ? parseInt(newMember.age) : null,
          gender: newMember.gender,
          color: newMember.color,
          sort_order: members.length,
        }),
      });
      if (resp.ok) {
        const created = await resp.json();
        setMembers(prev => [...prev, created]);
        setNewMember({ name: '', relation: '', age: '', gender: '男', color: COLORS[members.length % COLORS.length] });
        setShowAddForm(false);
      }
    } finally {
      setAddingMember(false);
    }
  };

  const removeMember = async (id: string, name: string) => {
    if (!confirm(`確定要移除「${name}」嗎？\n該成員的所有健康紀錄不會被刪除。`)) return;
    setDeletingId(id);
    try {
      const resp = await fetch(`/api/members/${id}`, { method: 'DELETE', credentials: 'include' });
      if (resp.ok || resp.status === 204) {
        setMembers(prev => prev.filter(m => m.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingMember) return;
    setSavingEdit(true);
    try {
      const resp = await fetch(`/api/members/${editingMember.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editingMember.name.trim(),
          relation: editingMember.relation.trim(),
          age: editingMember.age ? parseInt(editingMember.age) : null,
          gender: editingMember.gender,
          color: editingMember.color,
        }),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setMembers(prev => prev.map(m => m.id === updated.id ? updated : m));
        setEditingMember(null);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Notifications (local UI state) ───────────────────────────────────────────
  const [notifs] = useState<Record<string, boolean>>({
    appt_before_1d: true, appt_before_3d: true, abnormal_trend: true, weekly_summary: false, med_refill: true,
  });

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
        <button onClick={() => router.back()} style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#fff', border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-sm)' }}>←</button>
        <div>
          <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>設定</h2>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>管理家庭成員與通知偏好</p>
        </div>
      </div>

      {/* Family name */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>家庭基本資料</h3>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>家庭名稱</label>
            <input
              type="text"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              placeholder="例：林家、我的家庭"
              style={inputStyle}
            />
            <p style={{ fontSize: '12px', color: '#999', marginTop: '6px' }}>顯示在側邊欄頂部</p>
          </div>
          <div>
            <button
              onClick={saveFamilyName}
              disabled={savingFamily || !familyName.trim()}
              style={{
                padding: '10px 20px', borderRadius: '8px', border: 'none',
                background: familySaved ? '#4caf50' : 'var(--primary)', color: '#fff',
                fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                opacity: savingFamily ? 0.6 : 1, marginBottom: '22px',
              }}
            >
              {familySaved ? '✓ 已儲存' : savingFamily ? '儲存中...' : '儲存'}
            </button>
          </div>
        </div>
      </div>

      {/* Join code */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>家庭加入代碼</h3>
        <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px', lineHeight: 1.6 }}>
          將此代碼分享給家人，他們登入後選擇「加入已有家庭」並輸入代碼，即可共用同一份健康紀錄。
        </p>
        {joinCode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              flex: 1, background: '#f0f7ff', border: '2px dashed #90caf9',
              borderRadius: '12px', padding: '14px 20px', textAlign: 'center',
              fontSize: '24px', fontWeight: '800', letterSpacing: '6px',
              color: '#1565c0', fontFamily: 'monospace',
            }}>
              {joinCode}
            </div>
            <button onClick={copyCode} style={{
              padding: '12px 20px', borderRadius: '10px', border: '1px solid var(--gray-200)',
              background: codeCopied ? '#4caf50' : '#fff',
              color: codeCopied ? '#fff' : '#555',
              fontSize: '13px', fontWeight: '600', cursor: 'pointer',
              transition: 'all 0.2s', flexShrink: 0,
            }}>
              {codeCopied ? '✓ 已複製' : '複製'}
            </button>
          </div>
        ) : (
          <div style={{ color: '#aaa', fontSize: '13px' }}>載入中...</div>
        )}
        <p style={{ fontSize: '11px', color: '#bbb', marginTop: '10px' }}>
          您的 LINE 帳號已加密去識別化儲存，此代碼不含任何個人身分資訊
        </p>
      </div>

      {/* Family members */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>家庭成員</h3>

        {members.length === 0 && !showAddForm && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa', fontSize: '14px' }}>
            尚未新增任何成員
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {members.map(m => (
            editingMember?.id === m.id ? (
              <form key={m.id} onSubmit={saveEdit} style={{ background: '#f0f7ff', borderRadius: '10px', padding: '16px', border: '1px solid #90caf9' }}>
                <div className="grid-2col" style={{ marginBottom: '12px' }}>
                  <div>
                    <label style={labelStyle}>稱謂</label>
                    <input type="text" value={editingMember.name} required style={inputStyle}
                      onChange={e => setEditingMember(f => f && ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>關係</label>
                    <input type="text" value={editingMember.relation} required style={inputStyle}
                      onChange={e => setEditingMember(f => f && ({ ...f, relation: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>年齡（選填）</label>
                    <input type="number" min="0" max="120" value={editingMember.age} style={inputStyle}
                      onChange={e => setEditingMember(f => f && ({ ...f, age: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>性別</label>
                    <select value={editingMember.gender} style={{ ...inputStyle, background: '#fff' }}
                      onChange={e => setEditingMember(f => f && ({ ...f, gender: e.target.value }))}>
                      <option value="男">男</option>
                      <option value="女">女</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={labelStyle}>顏色</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {COLORS.map(c => (
                      <div key={c} onClick={() => setEditingMember(f => f && ({ ...f, color: c }))} style={{
                        width: '26px', height: '26px', borderRadius: '13px', background: c,
                        cursor: 'pointer',
                        border: editingMember.color === c ? '3px solid #333' : '3px solid transparent',
                      }} />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" disabled={savingEdit} style={{
                    background: 'var(--primary)', color: '#fff', border: 'none',
                    padding: '8px 20px', borderRadius: '8px', fontWeight: '700',
                    cursor: 'pointer', fontSize: '14px', opacity: savingEdit ? 0.6 : 1,
                  }}>
                    {savingEdit ? '儲存中...' : '儲存'}
                  </button>
                  <button type="button" onClick={() => setEditingMember(null)} style={{
                    background: '#fff', color: '#666', border: '1px solid var(--gray-200)',
                    padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
                  }}>
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '12px 16px', background: '#f8f9fa', borderRadius: '10px',
                opacity: deletingId === m.id ? 0.4 : 1, transition: 'opacity 0.2s',
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '20px',
                  background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '15px', fontWeight: '800', color: '#fff', flexShrink: 0,
                }}>
                  {m.name.slice(0, 2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#111' }}>
                    {m.name} · {m.relation}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    {m.age ? `${m.age} 歲` : ''}
                    {m.age && m.gender ? ' · ' : ''}
                    {m.gender ?? ''}
                  </div>
                </div>
                <button
                  onClick={() => setEditingMember({ id: m.id, name: m.name, relation: m.relation, age: m.age ? String(m.age) : '', gender: m.gender ?? '男', color: m.color })}
                  disabled={!!deletingId}
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid var(--gray-200)',
                    background: '#fff', color: 'var(--primary)',
                    fontSize: '12px', cursor: 'pointer', marginRight: '4px',
                  }}
                >
                  編輯
                </button>
                <button
                  onClick={() => removeMember(m.id, m.name)}
                  disabled={deletingId === m.id}
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid var(--gray-200)',
                    background: '#fff', color: '#f44336',
                    fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  移除
                </button>
              </div>
            )
          ))}
        </div>

        {/* Add form */}
        {showAddForm ? (
          <form onSubmit={addMember} style={{ background: '#f8f9fa', borderRadius: '10px', padding: '16px', marginBottom: '8px' }}>
            <div className="grid-2col" style={{ marginBottom: '12px' }}>
              <div>
                <label style={labelStyle}>稱謂</label>
                <input type="text" placeholder="例：奶奶" value={newMember.name}
                  onChange={e => setNewMember(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>關係</label>
                <input type="text" placeholder="例：祖母" value={newMember.relation}
                  onChange={e => setNewMember(f => ({ ...f, relation: e.target.value }))}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>年齡（選填）</label>
                <input type="number" placeholder="65" min="0" max="120" value={newMember.age}
                  onChange={e => setNewMember(f => ({ ...f, age: e.target.value }))}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>性別</label>
                <select value={newMember.gender}
                  onChange={e => setNewMember(f => ({ ...f, gender: e.target.value }))}
                  style={{ ...inputStyle, background: '#fff' }}>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>顏色</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setNewMember(f => ({ ...f, color: c }))} style={{
                    width: '26px', height: '26px', borderRadius: '13px', background: c,
                    cursor: 'pointer',
                    border: newMember.color === c ? '3px solid #333' : '3px solid transparent',
                  }} />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" disabled={addingMember} style={{
                background: 'var(--primary)', color: '#fff', border: 'none',
                padding: '8px 20px', borderRadius: '8px', fontWeight: '700',
                cursor: 'pointer', fontSize: '14px', opacity: addingMember ? 0.6 : 1,
              }}>
                {addingMember ? '新增中...' : '新增'}
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} style={{
                background: '#fff', color: '#666', border: '1px solid var(--gray-200)',
                padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
              }}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowAddForm(true)} style={{
            width: '100%', padding: '12px', borderRadius: '10px',
            border: '1px dashed var(--gray-300)',
            background: '#fff', color: 'var(--primary)',
            fontSize: '14px', fontWeight: '700', cursor: 'pointer',
          }}>
            + 新增家庭成員
          </button>
        )}
      </div>

      {/* Notifications */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>我的資料修改紀錄</h3>
        {changeRequests.length === 0 ? (
          <div style={{ padding: '24px 0', color: '#94a3b8', fontSize: '14px', textAlign: 'center' }}>
            尚無資料異動紀錄。當您回報資料有誤或要求修改狀態時，會顯示在這裡。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>
            {changeRequests.slice(0, 12).map(req => {
              const isPending = ['draft', 'pending_review', 'needs_clarification'].includes(req.status);
              const tone = REQUEST_STATUS_COPY[req.status] ?? REQUEST_STATUS_COPY.pending_review;
              return (
                <div key={req.id} style={{
                  border: '1px solid var(--gray-200)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  background: '#fff',
                  display: 'grid',
                  gridTemplateColumns: '12px minmax(0,1fr) auto',
                  gap: '12px',
                  alignItems: 'start',
                }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: tone.fg, marginTop: '5px' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '14px', color: '#111' }}>
                        {req.target_type} · {req.action}
                      </strong>
                      <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px', background: tone.bg, color: tone.fg }}>
                        {tone.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', lineHeight: 1.5 }}>
                      送出時間：{new Date(req.created_at).toLocaleString('zh-TW')}
                      {req.reviewed_at ? ` · 回覆時間：${new Date(req.reviewed_at).toLocaleString('zh-TW')}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', color: '#334155', marginTop: '6px', lineHeight: 1.6 }}>
                      提出內容：{summarizePayload(req.proposed_payload)}
                    </div>
                    {req.patient_note && (
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px', lineHeight: 1.6 }}>
                        你的說明：{req.patient_note}
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: tone.fg, marginTop: '6px', fontWeight: 700 }}>
                      下一步：{tone.next}
                    </div>
                    {req.reviewer_note && (
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '6px', padding: '8px', background: '#f8fafc', borderRadius: '8px' }}>
                        醫療團隊回覆：{req.reviewer_note}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {req.status === 'needs_clarification' && (
                    <button type="button" onClick={() => supplementRequest(req)} style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '1px solid #fed7aa',
                      background: '#fff7ed',
                      color: '#c2410c',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}>
                      補充說明
                    </button>
                  )}
                  {isPending && (
                    <button type="button" onClick={() => withdrawRequest(req.id)} style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '1px solid #fecdd3',
                      background: '#fff',
                      color: '#be123c',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}>
                      撤回
                    </button>
                  )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div style={sectionCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', ...sectionTitle }}>
          LINE 通知設定
          <span style={{
            fontSize: '10px', fontWeight: '700', color: '#ff9800',
            background: '#fff8e1', border: '1px solid #ffe082',
            padding: '2px 8px', borderRadius: '20px',
          }}>
            即將推出
          </span>
        </div>
        <p style={{ fontSize: '12px', color: '#aaa', marginBottom: '16px', marginTop: '-10px' }}>
          LINE 推播通知功能正在開發中，設定將於功能上線後生效。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', opacity: 0.45 }}>
          {NOTIFY_OPTIONS.map((opt, i) => (
            <div key={opt.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 0',
              borderBottom: i < NOTIFY_OPTIONS.length - 1 ? '1px solid var(--gray-100)' : 'none',
            }}>
              <span style={{ fontSize: '14px', color: '#333' }}>{opt.label}</span>
              <div style={{
                width: '46px', height: '26px', borderRadius: '13px',
                background: notifs[opt.key] ? 'var(--primary)' : '#ccc',
                position: 'relative', cursor: 'not-allowed', flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute', top: '3px',
                  left: notifs[opt.key] ? '23px' : '3px',
                  width: '20px', height: '20px', borderRadius: '10px', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Account */}
      <div style={sectionCard}>
        <h3 style={{ ...sectionTitle, color: '#f44336' }}>帳號操作</h3>
        <button
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            router.replace('/');
          }}
          style={{
            padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--gray-200)',
            background: '#fff', color: '#666', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
          }}
        >
          🚪 登出
        </button>
      </div>

      <div style={{ paddingBottom: '32px' }} />
      </div>
    </div>
  );
}
