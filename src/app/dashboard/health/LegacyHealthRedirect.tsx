'use client';

import { Suspense, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AsyncState, PageHeader } from '../_components/Shared';

function mergeTarget(target: string, currentSearch: string, hash = ''): string {
  const targetUrl = new URL(target, 'https://healthkeep.invalid');
  const requiredParams = new URLSearchParams(targetUrl.search);
  const params = new URLSearchParams(currentSearch);
  requiredParams.forEach((value, key) => params.set(key, value));
  const query = params.toString();
  return `${targetUrl.pathname}${query ? `?${query}` : ''}${targetUrl.hash || hash}`;
}

type LegacyHealthRedirectProps = {
  target: string;
  label: string;
};

function LegacyHealthRedirectContent({
  target,
  label,
}: LegacyHealthRedirectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const fallbackTarget = useMemo(() => mergeTarget(target, search), [search, target]);

  useEffect(() => {
    router.replace(mergeTarget(target, search, window.location.hash));
  }, [router, search, target]);

  return (
    <div className="page-wrap">
      <div className="hk-health-wrap">
        <PageHeader eyebrow="健康" title={`正在開啟${label}`} description="這個舊網址已整合到新的健康流程，原本的成員與篩選條件會保留。" />
        <AsyncState state="loading" title={`正在前往${label}…`} />
        <div style={{ marginTop: 12 }}>
          <Link href={fallbackTarget} className="hk-btn hk-btn-ghost hk-btn-sm">立即前往</Link>
        </div>
      </div>
    </div>
  );
}

export default function LegacyHealthRedirect(props: LegacyHealthRedirectProps) {
  return (
    <Suspense fallback={(
      <div className="page-wrap">
        <div className="hk-health-wrap">
          <PageHeader eyebrow="健康" title={`正在開啟${props.label}`} description="正在保留舊網址中的成員與篩選條件。" />
          <AsyncState state="loading" title={`正在前往${props.label}…`} />
        </div>
      </div>
    )}>
      <LegacyHealthRedirectContent {...props} />
    </Suspense>
  );
}

export { mergeTarget };
