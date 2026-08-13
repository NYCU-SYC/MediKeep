'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { setPatientSessionToken } from '@/lib/api';
import { nextRouteFromSearch, routeWithNext } from '@/lib/internalRoutes';

export default function HomePage() {
  const [message, setMessage] = useState('正在為您準備...');
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const next = nextRouteFromSearch(window.location.search, '/dashboard');
        if (data?.authenticated) {
          setPatientSessionToken(null);
          if (data?.needs_binding) {
            setMessage('請完成家庭設定...');
            router.replace(routeWithNext('/setup', next));
          } else {
            setMessage('歡迎回來，正在進入儀表板...');
            router.replace(next);
          }
        } else {
          setMessage('正在連接 LINE...');
          router.replace(routeWithNext('/upload-entry', next));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessage('正在連接 LINE...');
        router.replace(routeWithNext('/upload-entry', nextRouteFromSearch(window.location.search, '/dashboard')));
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main
      aria-busy="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #3e6b7e 0%, #33596a 100%)',
      }}
    >
      <div style={{ textAlign: 'center', color: '#fff', padding: '24px' }}>
        <h1
          style={{
            fontSize: '32px',
            fontWeight: 800,
            letterSpacing: '1px',
            marginBottom: '6px',
          }}
        >
          HealthKeep
        </h1>
        <p
          style={{
            fontSize: '12px',
            opacity: 0.75,
            marginBottom: '36px',
            letterSpacing: '0.5px',
          }}
        >
          您的家庭健康守護者
        </p>
        <LoaderCircle
          aria-hidden="true"
          className="hk-entry-spinner"
          size={48}
          strokeWidth={3}
          style={{ margin: '0 auto 20px' }}
        />
        <p role="status" style={{ fontSize: '14px', opacity: 0.9, minHeight: '20px' }}>{message}</p>
      </div>
      <style>{`
        .hk-entry-spinner { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .hk-entry-spinner { animation: none; }
        }
      `}</style>
    </main>
  );
}
