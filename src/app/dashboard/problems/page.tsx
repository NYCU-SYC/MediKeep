'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function buildProblemsRedirect(
  currentSearch: string,
  currentHash = '',
  includeConfirmedSection = true,
): string {
  const params = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch);
  if (includeConfirmedSection && !params.has('section')) params.set('section', 'confirmed');
  const query = params.toString();
  const hash = currentHash ? (currentHash.startsWith('#') ? currentHash : `#${currentHash}`) : '';
  return `/dashboard/conditions${query ? `?${query}` : ''}${hash}`;
}

export default function ProblemsLegacyRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(buildProblemsRedirect(search, hash));
  }, [router, search]);

  return <div className="page-wrap" role="status">正在開啟病況頁面…</div>;
}
