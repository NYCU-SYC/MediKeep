import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthProfileCompatibilityPage from './page';

const { replace, apiGet } = vi.hoisted(() => ({
  replace: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('member=%E7%8E%8B%E5%B0%8F%E6%98%8E&problem=12&highlight=problem-12&tab=confirmed'),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { get: apiGet },
}));

describe('health profile legacy URL compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#problem-12';
  });

  it('replaces the old URL with canonical health without dropping deep-link state', async () => {
    render(<HealthProfileCompatibilityPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      '/dashboard/health?member=%E7%8E%8B%E5%B0%8F%E6%98%8E&problem=12&highlight=problem-12&tab=confirmed#problem-12',
    ));
    expect(screen.getByRole('link', { name: '立即前往' })).toHaveAttribute(
      'href',
      '/dashboard/health?member=%E7%8E%8B%E5%B0%8F%E6%98%8E&problem=12&highlight=problem-12&tab=confirmed',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
