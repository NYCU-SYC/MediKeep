'use client';

import { BarChart3 } from 'lucide-react';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildTrendsUrl } from '../trends/routes';

/** Compatibility route for saved links to the former AI page. */
export default function LegacyAiPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const hash = window.location.hash;
    router.replace(buildTrendsUrl(searchParams.toString(), 'insights', hash));
  }, [router, searchParams]);

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div
        role="status"
        aria-live="polite"
        style={{
          maxWidth: 560,
          margin: '60px auto',
          padding: '44px 24px',
          textAlign: 'center',
          background: '#fff',
          border: '1px solid var(--gray-200)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <BarChart3 size={40} aria-hidden="true" style={{ color: 'var(--primary)', marginBottom: 13 }} />
        <h1 style={{ fontSize: 21, color: '#22313f', margin: 0 }}>正在開啟健康趨勢</h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 0' }}>數值整理已整合到健康趨勢頁。</p>
      </div>
    </div>
  );
}
