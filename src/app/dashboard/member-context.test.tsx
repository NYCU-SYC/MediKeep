import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemberProvider, useActiveMember } from './member-context';

function Probe() {
  const { canWriteMember, writeAccessReason } = useActiveMember();
  return (
    <>
      <div data-testid="can-write">{String(canWriteMember('本人'))}</div>
      <div data-testid="reason">{writeAccessReason('本人')}</div>
    </>
  );
}

describe('MemberProvider write access preflight', () => {
  it('fails closed until the authenticated access snapshot is available', () => {
    render(<MemberProvider><Probe /></MemberProvider>);
    expect(screen.getByTestId('can-write')).toHaveTextContent('false');
    expect(screen.getByTestId('reason')).toHaveTextContent('正在確認');
  });
});
