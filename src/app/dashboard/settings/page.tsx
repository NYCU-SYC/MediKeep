'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { ApiError, api, setPatientSessionToken } from '@/lib/api';
import { useToast } from '../toast-context';
import type { FamilyMember } from '../member-context';
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

type FamilyInfo = {
  family_name?: string | null;
  join_code?: string | null;
  join_code_expires_at?: string | null;
  join_code_status?: 'active' | 'expired' | 'disabled' | string;
  role?: 'owner' | 'member' | string | null;
  member_count?: number;
  permissions?: {
    can_view_family_health_data?: boolean;
    can_edit_patient_reported_data?: boolean;
    can_manage_family_members?: boolean;
    can_manage_member_access?: boolean;
    can_manage_join_code?: boolean;
    can_rename_family?: boolean;
    can_leave_family?: boolean;
    can_reset_empty_family?: boolean;
  };
  health_data_scope?: 'family' | 'member' | 'none' | string | null;
  family_member_id?: string | null;
  family_member_name?: string | null;
  allowed_member_names?: string[] | null;
  permission_note?: string | null;
};

type FamilyAccessMember = {
  id: string;
  name: string;
  relation?: string | null;
  color?: string | null;
};

type FamilyAccessIdentity = {
  id: string;
  display_name?: string | null;
  role?: string | null;
  health_data_scope: 'family' | 'member' | 'none' | string;
  family_member_id?: string | null;
  family_member_name?: string | null;
  last_login_at?: string | null;
  is_current?: boolean;
};

type FamilyAccessInfo = {
  members: FamilyAccessMember[];
  identities: FamilyAccessIdentity[];
};

const REQUEST_STATUS_COPY: Record<string, { label: string; bg: string; fg: string; next: string }> = {
  draft: { label: '草稿', bg: '#eef2f5', fg: '#56687a', next: '可補充後送出。' },
  pending_review: { label: '已送交醫療團隊確認', bg: '#fdf6e3', fg: '#92400e', next: '醫療團隊會確認後回覆。' },
  needs_clarification: { label: '醫療團隊需要你補充', bg: '#fdf1e0', fg: '#b06a10', next: '請補充說明，或先撤回。' },
  accepted: { label: '已確認', bg: '#e7f4ec', fg: '#2e8b57', next: '資料已由醫療團隊確認。' },
  modified_and_accepted: { label: '已由醫療團隊修正後確認', bg: '#e7f4ec', fg: '#2e8b57', next: '醫療團隊已依最終內容整理。' },
  needs_secondary_review: { label: '醫療團隊整理中', bg: '#eef2ff', fg: '#3730a3', next: '資料已初步處理，仍需再次確認後發布。' },
  rejected: { label: '未採用', bg: '#faecea', fg: '#a03a30', next: '本次內容未納入正式健康檔案。' },
  withdrawn: { label: '已撤回', bg: '#eef2f5', fg: '#6b7c8c', next: '你已撤回這次異動。' },
};

function summarizePayload(payload?: Record<string, unknown> | null) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const entries = Object.entries(source).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length === 0) return '未填寫補充內容';
  return entries.slice(0, 4).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ');
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function parseOptionalAge(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : null;
}

function formatInviteExpiry(value?: string | null) {
  if (!value) return '永不自動過期';
  return new Date(value).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function inviteStatusCopy(status?: string | null) {
  if (status === 'expired') return { label: '已過期', bg: '#fdf1e0', fg: '#b06a10' };
  if (status === 'disabled') return { label: '已停用', bg: '#eef2f5', fg: '#6b7c8c' };
  return { label: '可加入', bg: '#e7f4ec', fg: '#2e8b57' };
}

export default function SettingsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { activeMember, members, setMembers, setActiveMember, setMembersError } = useActiveMember();
  const [changeRequests, setChangeRequests] = useState<PatientChangeRequest[]>([]);

  // ── Family info ──────────────────────────────────────────────────────────────
  const [familyName, setFamilyName] = useState('');
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [familyInfo, setFamilyInfo] = useState<FamilyInfo | null>(null);
  const [familyInfoLoading, setFamilyInfoLoading] = useState(true);
  const [familyInfoError, setFamilyInfoError] = useState('');
  const [inviteExpiryDays, setInviteExpiryDays] = useState('30');
  const [familyActionBusy, setFamilyActionBusy] = useState<'save' | 'code' | 'disable' | 'leave' | null>(null);
  const [familyActionError, setFamilyActionError] = useState('');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [savingFamily, setSavingFamily] = useState(false);
  const [familySaved, setFamilySaved] = useState(false);
  const [familyAccess, setFamilyAccess] = useState<FamilyAccessInfo | null>(null);
  const [familyAccessLoading, setFamilyAccessLoading] = useState(false);
  const [familyAccessError, setFamilyAccessError] = useState('');
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null);

  const applyFamilyInfo = useCallback((info: FamilyInfo | null) => {
    setFamilyInfo(info);
    setJoinCode(info?.join_code || null);
    if (info?.family_name) setFamilyName(info.family_name);
  }, []);

  useEffect(() => {
    setFamilyInfoLoading(true);
    setFamilyInfoError('');
    api.get('/api/auth/family')
      .then(d => {
        applyFamilyInfo(d as FamilyInfo | null);
      })
      .catch(error => {
        setFamilyInfoError(requestErrorMessage(error, '無法載入家庭身份與權限設定。請重新登入或稍後再試。'));
        applyFamilyInfo(null);
      })
      .finally(() => setFamilyInfoLoading(false));
  }, [applyFamilyInfo]);

  const loadFamilyAccess = useCallback(async () => {
    setFamilyAccessLoading(true);
    setFamilyAccessError('');
    try {
      const data = await api.get('/api/auth/family/access') as FamilyAccessInfo;
      setFamilyAccess(data);
    } catch (error) {
      const message = requestErrorMessage(error, '無法載入家庭健康資料授權設定');
      setFamilyAccessError(message);
      setFamilyAccess(null);
    } finally {
      setFamilyAccessLoading(false);
    }
  }, []);

  useEffect(() => {
    if (familyInfo?.permissions?.can_manage_member_access === true) {
      void loadFamilyAccess();
      return;
    }
    setFamilyAccess(null);
  }, [familyInfo?.permissions?.can_manage_member_access, loadFamilyAccess]);

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
    setFamilyActionError('');
    try {
      const info = await api.patch('/api/auth/family', { family_name: familyName.trim() }) as FamilyInfo;
      applyFamilyInfo(info);
      setFamilySaved(true);
      setTimeout(() => setFamilySaved(false), 2000);
      showToast('家庭名稱已儲存', 'success');
    } catch (error) {
      showToast(requestErrorMessage(error, '家庭名稱儲存失敗，請稍後再試'), 'error');
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
  const rotateJoinCode = async () => {
    setFamilyActionBusy('code');
    setFamilyActionError('');
    try {
      const info = await api.post('/api/auth/family/join-code', { expiry_days: Number(inviteExpiryDays) }) as FamilyInfo;
      applyFamilyInfo(info);
      setCodeCopied(false);
      showToast('已產生新的家庭加入代碼，舊代碼立即失效。', 'success');
    } catch (error) {
      const message = requestErrorMessage(error, '無法產生新的家庭加入代碼，請稍後再試');
      setFamilyActionError(message);
      showToast(message, 'error');
    } finally {
      setFamilyActionBusy(null);
    }
  };

  const disableJoinCode = async () => {
    setFamilyActionBusy('disable');
    setFamilyActionError('');
    try {
      const info = await api.post('/api/auth/family/join-code', { disable: true }) as FamilyInfo;
      applyFamilyInfo(info);
      setCodeCopied(false);
      showToast('已停用目前家庭加入代碼。', 'info');
    } catch (error) {
      const message = requestErrorMessage(error, '無法停用家庭加入代碼，請稍後再試');
      setFamilyActionError(message);
      showToast(message, 'error');
    } finally {
      setFamilyActionBusy(null);
    }
  };

  const updateIdentityAccess = async (identity: FamilyAccessIdentity, scope: 'family' | 'member' | 'none', memberId?: string | null) => {
    if (scope === 'member' && !memberId) {
      setFamilyAccessError('選擇「只能編輯特定成員」時，必須綁定一位家庭成員。');
      return;
    }
    setSavingAccessId(identity.id);
    setFamilyAccessError('');
    try {
      const updated = await api.patch(`/api/auth/family/access/${identity.id}`, {
        health_data_scope: scope,
        family_member_id: scope === 'member' ? memberId : null,
      }) as FamilyAccessInfo;
      setFamilyAccess(updated);
      showToast('家庭健康資料編輯權限已更新', 'success');
    } catch (error) {
      const message = requestErrorMessage(error, '家庭健康資料編輯權限更新失敗');
      setFamilyAccessError(message);
      showToast(message, 'error');
    } finally {
      setSavingAccessId(null);
    }
  };

  const leaveFamily = async () => {
    setFamilyActionBusy('leave');
    setFamilyActionError('');
    try {
      const result = await api.post('/api/auth/family/leave') as { session_token?: string | null; message?: string | null };
      if (result?.session_token) setPatientSessionToken(result.session_token);
      setMembers([]);
      setActiveMember('');
      showToast(result?.message || '已離開原家庭，請重新建立或加入正確家庭。', 'info');
      router.replace('/setup');
    } catch (error) {
      const message = requestErrorMessage(error, '無法離開家庭，請稍後再試');
      setFamilyActionError(message);
      showToast(message, 'error');
    } finally {
      setFamilyActionBusy(null);
      setLeaveConfirmOpen(false);
    }
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', relation: '', age: '', gender: '男', color: COLORS[0] });
  const [addingMember, setAddingMember] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<{ id: string; name: string; relation: string; age: string; gender: string; color: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [memberFormError, setMemberFormError] = useState('');

  const reloadMembers = async () => {
    const raw = await api.get('/api/members');
    const latest = Array.isArray(raw) ? raw as FamilyMember[] : [];
    setMembers(latest);
    setMembersError(false);
    return latest;
  };

  const addMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMemberFormError('');
    if (!canManageFamilyMembers) {
      setMemberFormError('只有家庭 owner 可以新增家庭成員。');
      return;
    }
    const name = newMember.name.trim();
    const relation = newMember.relation.trim();
    const age = parseOptionalAge(newMember.age);
    if (!name || !relation) {
      setMemberFormError('請填寫稱謂與關係。');
      return;
    }
    if (newMember.age.trim() && age === null) {
      setMemberFormError('年齡請輸入 0 到 120 的整數。');
      return;
    }
    setAddingMember(true);
    try {
      const created = await api.post('/api/members', {
        name,
        relation,
        age,
        gender: newMember.gender,
        color: newMember.color,
        sort_order: members.length,
      }) as FamilyMember;
      let latest: FamilyMember[] = [];
      try {
        latest = await reloadMembers();
      } catch {
        setMembers(prev => prev.some(member => member.id === created.id) ? prev : [...prev, created]);
      }
      setActiveMember(created.name);
      setNewMember({
        name: '',
        relation: '',
        age: '',
        gender: '男',
        color: COLORS[(latest.length || members.length + 1) % COLORS.length],
      });
      setShowAddForm(false);
      showToast(`已新增 ${created.name}`, 'success');
    } catch (error) {
      const message = requestErrorMessage(error, '新增家庭成員失敗，請重新登入或稍後再試。');
      setMemberFormError(message);
      showToast(message, 'error');
    } finally {
      setAddingMember(false);
    }
  };

  const removeMember = async (id: string, name: string) => {
    if (!canManageFamilyMembers) {
      setMemberFormError('只有家庭 owner 可以移除家庭成員。');
      return;
    }
    if (!confirm(`確定要移除「${name}」嗎？\n該成員的所有健康紀錄不會被刪除。`)) return;
    setDeletingId(id);
    setMemberFormError('');
    try {
      await api.delete(`/api/members/${id}`);
      setMembers(prev => prev.filter(m => m.id !== id));
      if (activeMember === name) setActiveMember('');
      showToast(`已移除 ${name}`, 'info');
    } catch (error) {
      const message = requestErrorMessage(error, '移除成員失敗，請稍後再試。');
      setMemberFormError(message);
      showToast(message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const saveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingMember) return;
    setMemberFormError('');
    if (!canManageFamilyMembers) {
      setMemberFormError('只有家庭 owner 可以編輯家庭成員。');
      return;
    }
    const name = editingMember.name.trim();
    const relation = editingMember.relation.trim();
    const age = parseOptionalAge(editingMember.age);
    if (!name || !relation) {
      setMemberFormError('請填寫稱謂與關係。');
      return;
    }
    if (editingMember.age.trim() && age === null) {
      setMemberFormError('年齡請輸入 0 到 120 的整數。');
      return;
    }
    setSavingEdit(true);
    try {
      const previousName = members.find(member => member.id === editingMember.id)?.name;
      const updated = await api.put(`/api/members/${editingMember.id}`, {
        name,
        relation,
        age,
        gender: editingMember.gender,
        color: editingMember.color,
      }) as FamilyMember;
      try {
        await reloadMembers();
      } catch {
        setMembers(prev => prev.map(m => m.id === updated.id ? updated : m));
      }
      if (previousName && activeMember === previousName) setActiveMember(updated.name);
      setEditingMember(null);
      showToast(`已更新 ${updated.name}`, 'success');
    } catch (error) {
      const message = requestErrorMessage(error, '儲存成員資料失敗，請稍後再試。');
      setMemberFormError(message);
      showToast(message, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setPatientSessionToken(null);
      router.replace('/');
    }
  };

  // ── Notifications (local UI state) ───────────────────────────────────────────
  const [notifs] = useState<Record<string, boolean>>({
    appt_before_1d: true, appt_before_3d: true, abnormal_trend: true, weekly_summary: false, med_refill: true,
  });

  const currentFamilyRole = familyInfo?.role;
  const canRenameFamily = familyInfo?.permissions?.can_rename_family === true;
  const canManageJoinCode = familyInfo?.permissions?.can_manage_join_code === true;
  const canManageFamilyMembers = familyInfo?.permissions?.can_manage_family_members === true;
  const canManageMemberAccess = familyInfo?.permissions?.can_manage_member_access === true;
  const isJoinedFamilyMember = currentFamilyRole === 'member';
  const canLeaveFamily = familyInfo?.permissions?.can_leave_family === true || isJoinedFamilyMember;
  const canResetEmptyFamily = familyInfo?.permissions?.can_reset_empty_family === true;
  const isFamilyOwner = currentFamilyRole === 'owner';
  const inviteStatus = canManageJoinCode
    ? inviteStatusCopy(familyInfo?.join_code_status)
    : { label: '僅 owner 可查看', bg: '#eef2f5', fg: '#6b7c8c' };
  const canViewFamilyHealthData = familyInfo?.permissions?.can_view_family_health_data === true;
  const editScopeText = familyInfo?.health_data_scope === 'family'
    ? '可新增或修改全家庭的使用者回報資料'
    : familyInfo?.health_data_scope === 'member'
      ? `只能新增或修改${familyInfo.family_member_name ? `「${familyInfo.family_member_name}」` : '已綁定成員'}的使用者回報資料`
      : '僅可查看，不能新增或修改使用者回報資料';
  const identityTitle = familyInfoLoading
    ? '載入中...'
    : familyInfo
      ? isFamilyOwner ? 'Owner' : isJoinedFamilyMember ? 'Joined member' : '身份未確認'
      : '尚未取得家庭身份';
  const identityDescription = familyInfoLoading
    ? '正在載入家庭身份與權限設定。'
    : familyInfoError
      ? '無法確認目前身份；請重新登入或稍後再試。'
      : isFamilyOwner
        ? '可管理家庭名稱、成員與加入代碼。'
        : isJoinedFamilyMember && canViewFamilyHealthData
          ? '可查看全家健康資料；家庭成員、加入代碼與權限設定仍由 owner 管理。'
          : isJoinedFamilyMember
            ? '尚未被 owner 開放健康資料；可以離開錯誤家庭後重新輸入正確加入碼。'
            : '家庭資料已載入，但沒有回傳可判斷的身份角色；請重新登入後再試。';

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>

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
              disabled={savingFamily || !familyName.trim() || !canRenameFamily}
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
        {!canManageJoinCode ? (
          <div style={{
            border: '1px solid #e3e9ee',
            background: '#f6f9fa',
            borderRadius: '12px',
            padding: '14px 16px',
            color: '#56687a',
            fontSize: '13px',
            lineHeight: 1.7,
          }}>
            只有家庭 owner 可以查看、複製或重新產生家庭加入代碼。若你加入錯誤家庭，可以在下方離開家庭後重新輸入正確加入碼。
          </div>
        ) : joinCode ? (
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
          <div style={{
            border: '1px solid #e3e9ee',
            background: '#f6f9fa',
            borderRadius: '12px',
            padding: '14px 16px',
            color: '#6b7c8c',
            fontSize: '13px',
          }}>
            目前沒有啟用中的家庭加入代碼。可在下方產生新的加入代碼，並設定有效期限。
          </div>
        )}
        <p style={{ fontSize: '11px', color: '#bbb', marginTop: '10px' }}>
          您的 LINE 帳號已加密去識別化儲存，此代碼不含任何個人身分資訊
        </p>
      </div>

      {/* Family access and permissions */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>家庭存取與權限</h3>
        {(familyActionError || familyInfoError) && (
          <div role="alert" style={{
            border: '1px solid #f2d3cf',
            background: '#faecea',
            color: '#8f342b',
            borderRadius: '10px',
            padding: '10px 12px',
            fontSize: '13px',
            fontWeight: 700,
            marginBottom: '14px',
          }}>
            {familyActionError || familyInfoError}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px', marginBottom: '16px' }}>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '14px', background: '#f6f9fa' }}>
            <div style={{ fontSize: '12px', color: '#6b7c8c', fontWeight: 800, marginBottom: 6 }}>目前身份</div>
            <div style={{ fontSize: '18px', fontWeight: 900, color: '#22313f' }}>{identityTitle}</div>
            <div style={{ fontSize: '12px', color: '#6b7c8c', lineHeight: 1.5, marginTop: 6 }}>
              {identityDescription}
            </div>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '14px', background: '#fff' }}>
            <div style={{ fontSize: '12px', color: '#6b7c8c', fontWeight: 800, marginBottom: 6 }}>加入碼狀態</div>
            <span style={{ display: 'inline-block', fontSize: '12px', fontWeight: 900, borderRadius: '999px', padding: '4px 10px', background: inviteStatus.bg, color: inviteStatus.fg }}>
              {inviteStatus.label}
            </span>
            <div style={{ fontSize: '12px', color: '#6b7c8c', lineHeight: 1.6, marginTop: 8 }}>
              到期時間：{formatInviteExpiry(familyInfo?.join_code_expires_at)}
            </div>
          </div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '14px', background: '#fff' }}>
            <div style={{ fontSize: '12px', color: '#6b7c8c', fontWeight: 800, marginBottom: 6 }}>資料權限</div>
            <div style={{ fontSize: '12px', color: '#45596a', lineHeight: 1.7 }}>
              查看家庭健康資料：{canViewFamilyHealthData ? '同家庭成員皆可' : '權限狀態異常'}<br />
              新增/修改回報資料：{editScopeText}<br />
              新增/編輯家庭成員：{familyInfo?.permissions?.can_manage_family_members ? 'Owner only' : '不可操作'}<br />
              管理加入碼：{familyInfo?.permissions?.can_manage_join_code ? 'Owner only' : '不可操作'}
            </div>
          </div>
        </div>

        <div style={{ border: '1px solid #d5e7ec', background: '#e7f3f5', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 900, color: '#1e3a8a', marginBottom: 8 }}>健康資料編輯範圍</div>
          {canManageMemberAccess ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {familyAccessLoading && (
                <div style={{ color: '#6b7c8c', fontSize: '13px', padding: '10px 0' }}>載入授權設定中...</div>
              )}
              {familyAccessError && (
                <div role="alert" style={{
                  border: '1px solid #f2d3cf',
                  background: '#faecea',
                  color: '#8f342b',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  fontSize: '13px',
                  fontWeight: 700,
                }}>
                  {familyAccessError}
                </div>
              )}
              {familyAccess?.identities.map(identity => {
                const lockedOwner = identity.role === 'owner';
                const currentScope = (identity.health_data_scope || 'none') as 'family' | 'member' | 'none';
                return (
                  <div key={identity.id} style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                    gap: '10px',
                    alignItems: 'center',
                    border: '1px solid #cfe3e8',
                    borderRadius: '10px',
                    background: '#fff',
                    padding: '12px',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 900, color: '#22313f' }}>
                        {identity.display_name || '未命名登入身份'} {identity.is_current ? '（目前登入）' : ''}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7c8c', marginTop: 4 }}>
                        {lockedOwner ? 'Owner 固定可管理全家庭' : identity.family_member_name ? `綁定：${identity.family_member_name}` : '尚未綁定家庭成員'}
                      </div>
                    </div>
                    <select
                      value={lockedOwner ? 'family' : currentScope}
                      disabled={lockedOwner || savingAccessId === identity.id}
                      onChange={event => {
                        const scope = event.target.value as 'family' | 'member' | 'none';
                        const fallbackMemberId = identity.family_member_id || familyAccess?.members[0]?.id || null;
                        void updateIdentityAccess(identity, scope, scope === 'member' ? fallbackMemberId : null);
                      }}
                      style={{ ...inputStyle, background: lockedOwner ? '#f6f9fa' : '#fff' }}
                    >
                      <option value="none">僅查看，不可新增或修改</option>
                      <option value="member" disabled={(familyAccess?.members ?? []).length === 0}>只能編輯特定成員</option>
                      <option value="family">可編輯全家庭回報資料</option>
                    </select>
                    <select
                      value={identity.family_member_id || ''}
                      disabled={lockedOwner || currentScope !== 'member' || savingAccessId === identity.id}
                      onChange={event => void updateIdentityAccess(identity, 'member', event.target.value)}
                      style={{ ...inputStyle, background: currentScope === 'member' && !lockedOwner ? '#fff' : '#f6f9fa' }}
                    >
                      <option value="">選擇家庭成員</option>
                      {(familyAccess?.members ?? []).map(member => (
                        <option key={member.id} value={member.id}>{member.name} {member.relation ? `／${member.relation}` : ''}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <p style={{ fontSize: '12px', color: '#56687a', lineHeight: 1.65, margin: '4px 0 0' }}>
                同一家庭的成員都可查看全家健康資料。新加入者預設只能查看；Owner 可另外開放全家庭編輯，或只允許編輯一位家庭成員的使用者回報資料。CMO 未發布內容仍不會出現在病人端或家庭端。
              </p>
            </div>
          ) : (
            <div style={{ border: '1px solid #cfe3e8', borderRadius: '10px', background: '#fff', padding: '12px', fontSize: '13px', color: '#45596a', lineHeight: 1.7 }}>
              查看範圍：全家庭。編輯範圍：{editScopeText}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #d5e7ec', background: '#e7f3f5', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 900, color: '#1e3a8a', marginBottom: 8 }}>邀請碼管理</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px', alignItems: 'end' }}>
            <label>
              <span style={labelStyle}>新加入碼有效期限</span>
              <select
                value={inviteExpiryDays}
                disabled={!canManageJoinCode || familyActionBusy !== null}
                onChange={event => setInviteExpiryDays(event.target.value)}
                style={{ ...inputStyle, background: '#fff' }}
              >
                <option value="7">7 天</option>
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="180">180 天</option>
                <option value="365">365 天</option>
                <option value="0">永不自動過期</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={!canManageJoinCode || familyActionBusy !== null}
                onClick={() => void rotateJoinCode()}
                style={{ padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 800, cursor: canManageJoinCode ? 'pointer' : 'not-allowed', opacity: !canManageJoinCode || familyActionBusy ? 0.55 : 1 }}
              >
                {familyActionBusy === 'code' ? '產生中...' : '產生新加入碼'}
              </button>
              <button
                type="button"
                disabled={!canManageJoinCode || !joinCode || familyActionBusy !== null}
                onClick={() => void disableJoinCode()}
                style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #f2d3cf', background: '#fff', color: '#b91c1c', fontWeight: 800, cursor: canManageJoinCode ? 'pointer' : 'not-allowed', opacity: !canManageJoinCode || !joinCode || familyActionBusy ? 0.55 : 1 }}
              >
                {familyActionBusy === 'disable' ? '停用中...' : '停用目前加入碼'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#56687a', lineHeight: 1.65, margin: '10px 0 0' }}>
            產生新加入碼會立刻讓舊碼失效。若擔心加入到錯誤家庭，請先用加入頁的確認卡核對家庭名稱與成員數。
          </p>
        </div>

        <div style={{ border: '1px solid #faecea', background: '#fff7f7', borderRadius: '12px', padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <div style={{ fontSize: '13px', fontWeight: 900, color: '#8f342b', marginBottom: 6 }}>
                {canResetEmptyFamily ? '撤銷新建家庭' : '離開家庭'}
              </div>
              <p style={{ fontSize: '12px', color: '#7f1d1d', lineHeight: 1.55, margin: 0 }}>
                {canResetEmptyFamily
                  ? '撤銷這個空家庭，回到加入或建立家庭。'
                  : '離開後會回到加入家庭流程；原家庭資料不會被刪除。'}
              </p>
            </div>
            <button
              type="button"
              disabled={!canLeaveFamily || familyActionBusy !== null}
              onClick={() => setLeaveConfirmOpen(true)}
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #f2d3cf',
                background: '#fff',
                color: '#b91c1c',
                fontWeight: 900,
                cursor: canLeaveFamily && !familyActionBusy ? 'pointer' : 'not-allowed',
                opacity: !canLeaveFamily || familyActionBusy ? 0.55 : 1,
                flexShrink: 0,
              }}
            >
              {canResetEmptyFamily ? '撤銷' : '離開'}
            </button>
          </div>

          {leaveConfirmOpen && canLeaveFamily && (
            <div style={{
              marginTop: '12px',
              border: '1px solid #f2d3cf',
              background: '#fff',
              borderRadius: '10px',
              padding: '12px',
            }}>
              <div style={{ fontSize: '13px', color: '#7f1d1d', fontWeight: 800, marginBottom: 8 }}>
                {canResetEmptyFamily ? '確認撤銷這個空家庭？' : '確認離開目前家庭？'}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={familyActionBusy !== null}
                  onClick={() => void leaveFamily()}
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#b91c1c',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: familyActionBusy ? 'not-allowed' : 'pointer',
                    opacity: familyActionBusy ? 0.65 : 1,
                  }}
                >
                  {familyActionBusy === 'leave' ? '處理中...' : canResetEmptyFamily ? '確認撤銷' : '確認離開'}
                </button>
                <button
                  type="button"
                  disabled={familyActionBusy !== null}
                  onClick={() => setLeaveConfirmOpen(false)}
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: '1px solid #c8d4dc',
                    background: '#fff',
                    color: '#45596a',
                    fontWeight: 800,
                    cursor: familyActionBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {!canLeaveFamily && (
            <div style={{ fontSize: '12px', color: '#6b7c8c', marginTop: '8px' }}>
              {familyInfoLoading || familyInfoError
                ? '需先成功載入家庭身份後，才能確認是否可以離開或撤銷家庭。'
                : isFamilyOwner
                ? 'Owner 只有在家庭沒有正式健康資料、也沒有其他登入身份時才能撤銷。正式家庭請改用停用/輪替加入碼來阻止錯誤加入。'
                : '目前身份不能離開家庭；請重新登入後再試，或聯絡家庭 owner 協助確認。'}
            </div>
          )}
        </div>
      </div>

      {/* Family members */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>家庭成員</h3>
        {!canManageFamilyMembers && (
          <div style={{ background: '#f6f9fa', border: '1px solid var(--gray-200)', borderRadius: '10px', color: '#56687a', fontSize: '13px', lineHeight: 1.6, marginBottom: '14px', padding: '10px 12px' }}>
            {canViewFamilyHealthData
              ? '目前身份可以查看已授權的健康資料，但不能新增、編輯或移除家庭成員。需要調整成員時，請由家庭 owner 操作。'
              : '目前身份尚未被 owner 開放健康資料，也不能新增、編輯或移除家庭成員。若加入錯誤家庭，可先離開後重新輸入正確加入碼。'}
          </div>
        )}

        {memberFormError && (
          <div
            role="alert"
            style={{
              background: '#faecea',
              border: '1px solid #fecdd3',
              borderRadius: '10px',
              color: '#a03a30',
              fontSize: '13px',
              fontWeight: 700,
              lineHeight: 1.5,
              marginBottom: '14px',
              padding: '10px 12px',
            }}
          >
            {memberFormError}
          </div>
        )}

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
                  disabled={!!deletingId || !canManageFamilyMembers}
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid var(--gray-200)',
                    background: '#fff', color: 'var(--primary)',
                    fontSize: '12px', cursor: canManageFamilyMembers ? 'pointer' : 'not-allowed', marginRight: '4px',
                    opacity: canManageFamilyMembers ? 1 : 0.55,
                  }}
                >
                  編輯
                </button>
                <button
                  onClick={() => removeMember(m.id, m.name)}
                  disabled={deletingId === m.id || !canManageFamilyMembers}
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid var(--gray-200)',
                    background: '#fff', color: '#f44336',
                    fontSize: '12px', cursor: canManageFamilyMembers ? 'pointer' : 'not-allowed',
                    opacity: canManageFamilyMembers ? 1 : 0.55,
                  }}
                >
                  移除
                </button>
              </div>
            )
          ))}
        </div>

        {/* Add form */}
        {showAddForm && canManageFamilyMembers ? (
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
          <button disabled={!canManageFamilyMembers} onClick={() => canManageFamilyMembers && setShowAddForm(true)} style={{
            width: '100%', padding: '12px', borderRadius: '10px',
            border: '1px dashed var(--gray-300)',
            background: '#fff', color: 'var(--primary)',
            fontSize: '14px', fontWeight: '700', cursor: canManageFamilyMembers ? 'pointer' : 'not-allowed',
            opacity: canManageFamilyMembers ? 1 : 0.55,
          }}>
            + 新增家庭成員
          </button>
        )}
      </div>

      {/* Notifications */}
      <div style={sectionCard}>
        <h3 style={sectionTitle}>我的資料修改紀錄</h3>
        {changeRequests.length === 0 ? (
          <div style={{ padding: '24px 0', color: '#93a3af', fontSize: '14px', textAlign: 'center' }}>
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
                    <div style={{ fontSize: '12px', color: '#6b7c8c', marginTop: '4px', lineHeight: 1.5 }}>
                      送出時間：{new Date(req.created_at).toLocaleString('zh-TW')}
                      {req.reviewed_at ? ` · 回覆時間：${new Date(req.reviewed_at).toLocaleString('zh-TW')}` : ''}
                    </div>
                    <div style={{ fontSize: '12px', color: '#45596a', marginTop: '6px', lineHeight: 1.6 }}>
                      提出內容：{summarizePayload(req.proposed_payload)}
                    </div>
                    {req.patient_note && (
                      <div style={{ fontSize: '12px', color: '#56687a', marginTop: '6px', lineHeight: 1.6 }}>
                        你的說明：{req.patient_note}
                      </div>
                    )}
                    <div style={{ fontSize: '12px', color: tone.fg, marginTop: '6px', fontWeight: 700 }}>
                      下一步：{tone.next}
                    </div>
                    {req.reviewer_note && (
                      <div style={{ fontSize: '12px', color: '#56687a', marginTop: '6px', padding: '8px', background: '#f6f9fa', borderRadius: '8px' }}>
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
                      background: '#fdf1e0',
                      color: '#b06a10',
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
                      color: '#a03a30',
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
          onClick={logout}
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
