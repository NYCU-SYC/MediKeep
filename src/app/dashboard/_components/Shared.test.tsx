import { createRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccessibleDialog, AsyncState, SourceBadge, TaskLinkCard } from './Shared';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

describe('shared User UX primitives', () => {
  it('keeps source and confirmation badges distinct', () => {
    render(
      <>
        <SourceBadge source="本人量測" />
        <SourceBadge confirmed />
      </>,
    );
    expect(screen.getByText('來源：本人量測')).toBeInTheDocument();
    expect(screen.getByText('醫療團隊已確認')).toBeInTheDocument();
  });

  it('exposes a retry action for partial data', () => {
    const onRetry = vi.fn();
    render(<AsyncState state="partial" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('traps dialog focus, closes with Escape, and returns focus', async () => {
    const trigger = createRef<HTMLButtonElement>();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={trigger} type="button">開啟</button>
          <AccessibleDialog open={open} onClose={() => setOpen(false)} title="確認資料" returnFocusRef={trigger}>
            <button type="button">第一個動作</button>
          </AccessibleDialog>
        </>
      );
    }

    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: '確認資料' });
    await waitFor(() => expect(screen.getByRole('button', { name: '關閉對話框' })).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '確認資料' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '開啟' })).toHaveFocus();
  });

  it('uses an actual icon for task card navigation', () => {
    const { container } = render(<TaskLinkCard href="/dashboard/health" title="健康" description="查看摘要" />);
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(container).not.toHaveTextContent('→');
  });
});
