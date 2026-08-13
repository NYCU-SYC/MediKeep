import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'HealthKeep 急診保命資料',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function EmergencyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <meta name="referrer" content="no-referrer" />
      {children}
    </>
  );
}
