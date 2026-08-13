export type LegacyReminder = Record<string, unknown>;

export type LegacyReminderPayload = {
  type: unknown;
  title: unknown;
  scheduled_date: unknown;
  repeat_type: unknown;
  is_done: unknown;
  note: unknown;
  member_name: unknown;
  clinic: unknown;
  doctor: unknown;
  room: unknown;
  time: unknown;
  color: unknown;
  conclusion: unknown;
  visit_types: unknown;
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function legacyReminderPayload(item: LegacyReminder, activeMember: string): LegacyReminderPayload {
  return {
    type: item.type || item.reminder_type || 'follow_up',
    title: item.title || '提醒',
    scheduled_date: item.date || item.scheduled_date || null,
    repeat_type: item.repeat || item.repeat_type || 'none',
    is_done: item.done || item.is_done || false,
    note: item.note || null,
    member_name: item.member || activeMember,
    clinic: item.clinic || null,
    doctor: item.doctor || null,
    room: item.room || null,
    time: item.time || null,
    color: item.color || null,
    conclusion: item.conclusion || null,
    visit_types: item.visit_types || null,
  };
}

export function legacyReminderIdempotencyKey(item: LegacyReminder, activeMember: string): string {
  const payload = legacyReminderPayload(item, activeMember);
  return `legacy-reminder-v1-${stableHash(JSON.stringify(payload))}`;
}

export async function migrateLegacyReminders(
  items: LegacyReminder[],
  activeMember: string,
  post: (payload: LegacyReminderPayload, idempotencyKey: string) => Promise<unknown>,
): Promise<{ migrated: number; remaining: LegacyReminder[] }> {
  const remaining: LegacyReminder[] = [];
  let migrated = 0;
  for (const item of items) {
    try {
      await post(
        legacyReminderPayload(item, activeMember),
        legacyReminderIdempotencyKey(item, activeMember),
      );
      migrated += 1;
    } catch {
      remaining.push(item);
    }
  }
  return { migrated, remaining };
}
