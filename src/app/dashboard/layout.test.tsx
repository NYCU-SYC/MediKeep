import { createRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  humanizeMemberRelation,
  MobileNavItem,
  PRIMARY_NAV_ITEMS,
  MobileMenuSheet,
  primaryNavIsActive,
} from './layout';

vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <a {...props}>{children}</a> }));

function TestSheet() {
  const [open, setOpen] = useState(true);
  const trigger = createRef<HTMLButtonElement>();
  return (
    <>
      <button ref={trigger} type="button">開啟全部功能</button>
      <div data-mobile-dialog-background>背景內容</div>
      <MobileMenuSheet open={open} onClose={() => setOpen(false)} pathname="/dashboard" navHref={(href) => href} returnFocusRef={trigger} />
    </>
  );
}

describe('mobile all-features dialog', () => {
  it('moves focus inside, traps tab, marks background inert, and returns focus on close', async () => {
    render(<TestSheet />);
    const dialog = await screen.findByRole('dialog', { name: '全部功能' });
    const background = document.querySelector('[data-mobile-dialog-background]') as HTMLElement;
    await waitFor(() => expect(dialog.querySelector('button')).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');
    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect((background as HTMLElement & { inert?: boolean }).inert).toBe(true);

    const close = screen.getByRole('button', { name: '關閉' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '全部功能' })).not.toBeInTheDocument());
    expect(close).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開啟全部功能' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    expect(background).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('does not duplicate the five primary destinations in the all-features sheet', async () => {
    render(<TestSheet />);
    const dialog = await screen.findByRole('dialog', { name: '全部功能' });
    const hrefs = within(dialog).getAllByRole('link').map((link) => link.getAttribute('href'));

    expect(hrefs).not.toContain('/dashboard');
    for (const item of PRIMARY_NAV_ITEMS.slice(1)) expect(hrefs).not.toContain(item.href);
    expect(hrefs).toContain('/dashboard/conditions');
    expect(hrefs).toContain('/dashboard/nhi');
    expect(hrefs).not.toContain('/dashboard/health-summary');
    expect(hrefs).not.toContain('/dashboard/health-profile');
    expect(hrefs).not.toContain('/dashboard/redzone');
    expect(hrefs).not.toContain('/dashboard/reminders');
  });
});

describe('five-entry mobile navigation', () => {
  it('uses the same five entries and marks only the active route', () => {
    render(
      <nav aria-label="主要入口">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <MobileNavItem key={item.href} item={item} isActive={item.href === '/dashboard/tasks'} />
        ))}
      </nav>,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.textContent)).toEqual(['總覽', '健康', '紀錄', '待辦', '更多']);
    expect(screen.getByRole('link', { name: '待辦' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '總覽' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '健康' })).toHaveAttribute('href', '/dashboard/health');
  });

  it('keeps the correct primary entry active on detail pages', () => {
    expect(primaryNavIsActive('/dashboard/conditions', '/dashboard/health')).toBe(true);
    expect(primaryNavIsActive('/dashboard/emergency', '/dashboard/health')).toBe(true);
    expect(primaryNavIsActive('/dashboard/timeline', '/dashboard/records')).toBe(true);
    expect(primaryNavIsActive('/dashboard/reminders', '/dashboard/tasks')).toBe(true);
    expect(primaryNavIsActive('/dashboard/settings', '/dashboard/more')).toBe(true);
    expect(primaryNavIsActive('/dashboard/imaging/shares', '/dashboard/more')).toBe(true);
    expect(primaryNavIsActive('/dashboard/imaging/shares', '/dashboard/records')).toBe(false);
  });
});

describe('member labels', () => {
  it('does not expose internal role names in user navigation', () => {
    expect(humanizeMemberRelation('self')).toBe('本人');
    expect(humanizeMemberRelation('Owner')).toBe('家庭管理者');
    expect(humanizeMemberRelation('CMO')).toBe('醫療團隊');
    expect(humanizeMemberRelation('raw')).toBe('原始資料');
    expect(humanizeMemberRelation('母親')).toBe('母親');
  });
});
