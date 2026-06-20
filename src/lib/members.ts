export const ALL_MEMBERS = '';

export type MemberLike = {
  name?: string | null;
  relation?: string | null;
  age?: number | null;
  gender?: string | null;
  color?: string | null;
};

export function normalizeMemberName(value?: string | null): string {
  const text = (value ?? '').trim();
  if (!text || text === '全部' || text === 'all') return ALL_MEMBERS;
  return text === 'self' ? '本人' : text;
}

export function memberDisplayName(value?: string | null, allLabel = '全家總覽'): string {
  const normalized = normalizeMemberName(value);
  return normalized || allLabel;
}

export function memberQueryParams(member?: string | null): Record<string, string> | undefined {
  const normalized = normalizeMemberName(member);
  return normalized ? { member: normalized } : undefined;
}

export function memberHref(path: string, member?: string | null, extra?: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  const normalized = normalizeMemberName(member);
  if (normalized) params.set('member', normalized);
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value != null && value !== '') params.set(key, value);
  });
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function memberHrefWithCurrentSearch(path: string, currentSearch: string, member?: string | null): string {
  const params = new URLSearchParams(currentSearch);
  const normalized = normalizeMemberName(member);
  if (normalized) {
    params.set('member', normalized);
  } else {
    params.delete('member');
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function uniqueMemberNames(...groups: Array<Array<string | null | undefined> | undefined>): string[] {
  const seen = new Set<string>();
  groups.flatMap((group) => group ?? []).forEach((value) => {
    const normalized = normalizeMemberName(value);
    if (normalized) seen.add(normalized);
  });
  return Array.from(seen);
}
