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

type MemberContextType = {
  activeMember: string;
  setActiveMember: (m: string) => void;
  members: FamilyMember[];
  setMembers: React.Dispatch<React.SetStateAction<FamilyMember[]>>;
  membersLoading: boolean;
  setMembersLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

const MemberContext = createContext<MemberContextType>({
  activeMember: '',
  setActiveMember: () => {},
  members: [],
  setMembers: () => {},
  membersLoading: true,
  setMembersLoading: () => {},
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
  }), [activeMemberState, members, membersLoading, setActiveMember]);

  return (
    <MemberContext.Provider value={value}>
      {children}
    </MemberContext.Provider>
  );
}

export function useActiveMember() {
  return useContext(MemberContext);
}
