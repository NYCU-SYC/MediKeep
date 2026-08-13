'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

function buildLegacyNhiJobRedirect(jobId: string, currentSearch = '', currentHash = ''): string {
  const normalizedJobId = jobId.trim();
  const path = normalizedJobId
    ? `/dashboard/nhi/import/${encodeURIComponent(normalizedJobId)}`
    : '/dashboard/nhi';
  const params = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch);
  const query = params.toString();
  const hash = currentHash ? (currentHash.startsWith('#') ? currentHash : `#${currentHash}`) : '';
  return `${path}${query ? `?${query}` : ''}${hash}`;
}

export default function LegacyNhiImportJobRedirectPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = typeof params?.jobId === 'string' ? params.jobId : '';
  const search = searchParams.toString();

  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(buildLegacyNhiJobRedirect(jobId, search, hash));
  }, [jobId, router, search]);

  return <div className="page-wrap" role="status">正在開啟健保資料匯入進度…</div>;
}
