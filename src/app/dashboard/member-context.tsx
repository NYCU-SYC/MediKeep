'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ALL_MEMBERS, normalizeMemberName } from '@/lib/members';

export type FamilyMember = {
  id: string;
  name: string;
  relation: string;
  age: number | null;
  gender: string | null;
  color: string;
  sort_order: number;
};

export type UserAccessSnapshot = {
  health_data_scope: 'family' | 'member' | 'none' | string | null;
  family_member_id?: string | null;
  family_member_name?: string | null;
  allowed_member_names?: string[] | null;
  permissions?: {
    can_view_family_health_data?: boolean;
    can_edit_patient_reported_data?: boolean;
    can_manage_family_members?: boolean;
    can_manage_join_code?: boolean;
  } | null;
};

type MemberContextType = {
  activeMember: string;
  setActiveMember: (m: string) => void;
  members: FamilyMember[];
  setMembers: React.Dispatch<React.SetStateAction<FamilyMember[]>>;
  membersLoading: boolean;
  setMembersLoading: React.Dispatch<React.SetStateAction<boolean>>;
  // True when the members fetch failed (network / server error). Lets the UI
  // distinguish "load failed, retry" from the genuine "no members yet" empty
  // state instead of silently showing the onboarding empty state on error.
  membersError: boolean;
  setMembersError: React.Dispatch<React.SetStateAction<boolean>>;
  userAccess: UserAccessSnapshot | null;
  setUserAccess: React.Dispatch<React.SetStateAction<UserAccessSnapshot | null>>;
  canWriteMember: (member?: string | null) => boolean;
  writeAccessReason: (member?: string | null) => string | null;
};

const MemberContext = createContext<MemberContextType>({
  activeMember: '',
  setActiveMember: () => {},
  members: [],
  setMembers: () => {},
  membersLoading: true,
  setMembersLoading: () => {},
  membersError: false,
  setMembersError: () => {},
  userAccess: null,
  setUserAccess: () => {},
  // Fail closed until the authenticated access snapshot has been loaded.
  // The API remains the authority, but the UI must not invite a write that is
  // likely to end in a 403 while identity and member scope are still unknown.
  canWriteMember: () => false,
  writeAccessReason: () => '正在確認這個帳號可編輯的健康資料範圍。',
});

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const [activeMemberState, setActiveMemberState] = useState(() => {
    if (typeof window === 'undefined') return ALL_MEMBERS;
    try {
      return normalizeMemberName(window.localStorage.getItem('healthkeep_active_member_v1'));
    } catch {
      return ALL_MEMBERS;
    }
  });
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(false);
  const [userAccess, setUserAccess] = useState<UserAccessSnapshot | null>(null);

  const setActiveMember = useCallback((member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMemberState(normalized);
    try {
      if (normalized) window.localStorage.setItem('healthkeep_active_member_v1', normalized);
      else window.localStorage.removeItem('healthkeep_active_member_v1');
    } catch {
      // localStorage is best-effort only.
    }
  }, []);

  const value = useMemo(() => ({
    activeMember: activeMemberState, setActiveMember,
    members, setMembers,
    membersLoading, setMembersLoading,
    membersError, setMembersError,
    userAccess,
    setUserAccess,
    canWriteMember: (member?: string | null) => {
      if (!userAccess) return false;
      if (userAccess.permissions?.can_edit_patient_reported_data === false) return false;
      const scope = userAccess.health_data_scope;
      if (scope === 'none') return false;
      if (scope === 'family') return true;
      if (scope === 'member') {
        const selected = normalizeMemberName(member);
        const allowed = (userAccess.allowed_member_names ?? []).map(normalizeMemberName).filter(Boolean);
        const bound = normalizeMemberName(userAccess.family_member_name);
        return Boolean(selected && (allowed.includes(selected) || (!allowed.length && bound === selected)));
      }
      return false;
    },
    writeAccessReason: (member?: string | null) => {
      if (!userAccess) return '正在確認這個帳號可編輯的健康資料範圍，確認完成前仍可先查看資料。';
      if (userAccess.permissions?.can_edit_patient_reported_data === false || userAccess.health_data_scope === 'none') {
        return '目前登入身份可查看同家庭資料，但尚未開放使用者回報資料的新增或修改權限。';
      }
      if (userAccess.health_data_scope === 'member') {
        const allowed = userAccess.allowed_member_names?.filter(Boolean) ?? [];
        const label = allowed.length ? allowed.join('、') : userAccess.family_member_name || '指定成員';
        const normalizedAllowed = allowed.map(normalizeMemberName);
        if (!member || !normalizedAllowed.includes(normalizeMemberName(member))) return `此身份只能編輯${label}的使用者回報資料，請先選擇可編輯的成員。`;
      }
      return null;
    },
  }), [activeMemberState, members, membersLoading, membersError, setActiveMember, userAccess]);

  return (
    <MemberContext.Provider value={value}>
      {children}
    </MemberContext.Provider>
  );
}

export function useActiveMember() {
  return useContext(MemberContext);
}
