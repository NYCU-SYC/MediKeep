import { describe, expect, it, vi } from 'vitest';
import { legacyReminderIdempotencyKey, migrateLegacyReminders } from './legacy-migration';

describe('legacy reminder migration', () => {
  it('keeps failed reminders for a later retry instead of deleting them', async () => {
    const first = { title: '心臟科回診', date: '2026-08-20' };
    const second = { title: '量血壓', date: '2026-08-21' };
    const post = vi.fn()
      .mockResolvedValueOnce({ id: 'r1' })
      .mockRejectedValueOnce(new Error('offline'));

    const result = await migrateLegacyReminders([first, second], '本人', post);

    expect(result).toEqual({ migrated: 1, remaining: [second] });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('uses the same logical idempotency key across retries', () => {
    const item = { title: '量血壓', date: '2026-08-21', member: '本人' };
    expect(legacyReminderIdempotencyKey(item, '本人')).toBe(legacyReminderIdempotencyKey({ ...item }, '本人'));
  });
});
