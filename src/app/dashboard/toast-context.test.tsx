import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './toast-context';

function ToastTrigger({ onUndo }: { onUndo: () => void }) {
  const { showToast } = useToast();
  return <button type="button" onClick={() => showToast('已完成', 'success', { label: 'Undo', onClick: onUndo })}>顯示提示</button>;
}

describe('toast actions', () => {
  it('keeps the container passive while action buttons stay clickable and non-duplicated in live regions', () => {
    const onUndo = vi.fn();
    render(<ToastProvider><ToastTrigger onUndo={onUndo} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: '顯示提示' }));
    const container = document.querySelector('[data-toast-container]') as HTMLElement;
    const toast = screen.getByRole('status');
    expect(container.style.pointerEvents).toBe('none');
    expect(toast.style.pointerEvents).toBe('auto');
    expect(container).not.toHaveAttribute('aria-live');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });
});
