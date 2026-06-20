'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [message, setMessage] = useState('正在為您準備...');
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated) {
          if (data?.needs_binding) {
            setMessage('請完成家庭設定...');
            router.replace('/setup');
          } else {
            setMessage('歡迎回來，正在進入儀表板...');
            router.replace('/dashboard');
          }
        } else {
          setMessage('正在連接 LINE...');
          router.replace('/upload-entry');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessage('正在連接 LINE...');
        router.replace('/upload-entry');
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)',
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
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '4px solid rgba(255,255,255,0.25)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 20px',
          }}
        />
        <p style={{ fontSize: '14px', opacity: 0.9, minHeight: '20px' }}>{message}</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
