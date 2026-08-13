import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'HealthKeep 限時醫療影像',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <meta name="referrer" content="no-referrer" />
      {children}
    </>
  );
}
