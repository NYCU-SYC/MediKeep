import { safeNextRoute } from './internalRoutes';

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
  if (!text || ['all', '\u5168\u90e8', '\u5168\u5bb6', '\u5168\u5bb6\u7e3d\u89bd'].includes(text)) {
    return ALL_MEMBERS;
  }
  const lowered = text.toLowerCase();
  if (['self', '\u672c\u4eba', '\u6211', 'owner'].includes(lowered)) return '\u672c\u4eba';
  if (['\u7238\u7238', '\u7238', '\u7236\u89aa', 'father', 'dad'].includes(lowered)) return '\u7238\u7238';
  if (['\u5abd\u5abd', '\u5abd', '\u6bcd\u89aa', 'mother', 'mom', 'mum'].includes(lowered)) return '\u5abd\u5abd';
  if (['\u914d\u5076', '\u592a\u592a', '\u5148\u751f', 'spouse', 'partner'].includes(lowered)) return '\u914d\u5076';
  return text;
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
  const safePath = safeNextRoute(path, '/dashboard');
  const hashIndex = safePath.indexOf('#');
  const hash = hashIndex >= 0 ? safePath.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? safePath.slice(0, hashIndex) : safePath;
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');
  const normalized = normalizeMemberName(member);
  if (normalized) params.set('member', normalized);
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value != null && value !== '') params.set(key, value);
  });
  const query = params.toString();
  return query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`;
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
  const safePath = safeNextRoute(path, '/dashboard');
  const hashIndex = safePath.indexOf('#');
  const hash = hashIndex >= 0 ? safePath.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? safePath.slice(0, hashIndex) : safePath;
  return query ? `${withoutHash}?${query}${hash}` : `${withoutHash}${hash}`;
}

export function uniqueMemberNames(...groups: Array<Array<string | null | undefined> | undefined>): string[] {
  const seen = new Set<string>();
  groups.flatMap((group) => group ?? []).forEach((value) => {
    const normalized = normalizeMemberName(value);
    if (normalized) seen.add(normalized);
  });
  return Array.from(seen);
}
