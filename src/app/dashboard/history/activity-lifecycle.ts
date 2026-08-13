export type ActivityLike = {
  id: string;
  action?: string;
  event_type?: string;
  title?: string;
  target_type?: string | null;
  target_id?: string | null;
  target_label?: string | null;
  short_description?: string | null;
  patient_facing_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  occurred_at?: string | null;
  at?: string | null;
  lifecycle_id?: string | null;
  lifecycle_kind?: string | null;
  resource_kind?: string | null;
  lifecycle_status?: string | null;
  latest_phase?: string | null;
  phase?: string | null;
  correlation_key?: string | null;
  request_id?: string | null;
  idempotency_key?: string | null;
  lifecycle_events?: ActivityLike[];
};

export type ActivityLifecycle<T extends ActivityLike> = Omit<T, 'lifecycle_events'> & {
  lifecycle_id: string;
  lifecycle_events: T[];
  latest_phase: string;
};

const EVENT_TITLES: Record<string, string> = {
  source_document_delete_requested: '已提出移除文件',
  source_document_delete: '文件已移至最近刪除',
  source_document_deleted: '文件已移至最近刪除',
  source_document_restore: '文件已從最近刪除恢復',
  source_document_restored: '文件已從最近刪除恢復',
  condition_delete: '健康狀況已移至最近刪除',
  condition_restore: '健康狀況已從最近刪除恢復',
  medication_delete: '用藥已移至最近刪除',
  medication_restore: '用藥已從最近刪除恢復',
  medication_update: '已更新目前用藥狀況',
  dicom_delete: '醫療影像已移至最近刪除',
  dicom_restore: '醫療影像已從最近刪除恢復',
  dicom_study_delete: '醫療影像已移至最近刪除',
  dicom_study_restore: '醫療影像已從最近刪除恢復',
  reminder_create: '已新增提醒',
  reminder_update: '已更新提醒',
  reminder_delete: '提醒已移至最近刪除',
  reminder_undo_delete: '提醒已從最近刪除恢復',
  change_request_draft: '已建立異動草稿',
  change_request_pending_review: '已送交醫療團隊確認',
  change_request_submit: '已送交醫療團隊確認',
  change_request_reply: '已補充資料並重新送交',
  change_request_accepted: '醫療團隊已確認異動',
  change_request_modified_and_accepted: '醫療團隊已修正後確認異動',
  change_request_rejected: '醫療團隊未採用這次異動',
  change_request_needs_clarification: '醫療團隊需要你補充資料',
  change_request_withdraw: '已撤回異動',
  change_request_withdrawn: '已撤回異動',
  undo: '醫療團隊已復原上一個操作',
};

const DELETION_RECOVERY_ACTIONS = new Set([
  'source_document_delete_requested',
  'source_document_delete',
  'source_document_deleted',
  'source_document_restore',
  'source_document_restored',
  'condition_delete',
  'condition_restore',
  'medication_delete',
  'medication_restore',
  'dicom_delete',
  'dicom_restore',
  'dicom_study_delete',
  'dicom_study_restore',
  'reminder_delete',
  'reminder_undo_delete',
]);

function canonicalAction(event: ActivityLike): string {
  const raw = String(event.event_type || event.action || event.title || '')
    .split(' · ')[0]
    .trim()
    .toLocaleLowerCase();
  return raw.replace(/[.\s-]+/g, '_');
}

function targetName(event: ActivityLike, fallback = '資料'): string {
  return event.target_label?.trim() || fallback;
}

export function humanActivityTitle(event: ActivityLike, fallbackType = '資料'): string {
  const mapped = EVENT_TITLES[canonicalAction(event)];
  if (mapped) return `${mapped}${event.target_label ? ` · ${event.target_label}` : ''}`;

  const rawTitle = String(event.title || '').trim();
  const looksInternal = !/[\u3400-\u9fff]/u.test(rawTitle)
    || /(?:actor|target|status|soft[ _-]?delete|audit|history|source[ _-]?document)/i.test(rawTitle)
    || /[._][a-z]/i.test(rawTitle);
  return looksInternal ? `${targetName(event, fallbackType)}的狀態已更新` : rawTitle;
}

export function humanActivityDescription(event: ActivityLike): string {
  if (event.patient_facing_note?.trim()) return event.patient_facing_note.trim();
  const description = String(event.short_description || '').trim();
  const looksInternal = /(?:actor|target|status|soft[ _-]?delete|audit|history|source[ _-]?document|[a-z]+_[a-z]+)/i.test(description);
  if (!description || looksInternal) return 'HealthKeep 已記錄這次變更；你可以開啟詳情查看目前狀態與下一步。';
  return description;
}

function activityTime(event: ActivityLike): string {
  return event.occurred_at || event.created_at || event.at || event.updated_at || '';
}

function phaseRank(event: ActivityLike): number {
  return { request: 0, event: 1, completion: 2, undo: 3 }[event.phase || 'event'] ?? 1;
}

function compareEvents(left: ActivityLike, right: ActivityLike): number {
  const byTime = activityTime(left).localeCompare(activityTime(right));
  if (byTime) return byTime;
  const byPhase = phaseRank(left) - phaseRank(right);
  return byPhase || left.id.localeCompare(right.id);
}

function lifecycleFamily(event: ActivityLike): 'change_request' | 'deletion_recovery' | null {
  if (event.lifecycle_kind === 'change_request' || event.request_id?.trim()) return 'change_request';
  if (event.lifecycle_kind === 'deletion_recovery' || DELETION_RECOVERY_ACTIONS.has(canonicalAction(event))) {
    return 'deletion_recovery';
  }
  return null;
}

function normalizedResourceKind(event: ActivityLike): string {
  const explicit = event.resource_kind?.trim();
  if (explicit) return explicit;
  const target = String(event.target_type || '').trim().toLocaleLowerCase();
  return {
    source_document: 'document',
    medication_regimen: 'medication',
    medication_event: 'medication',
    dicom: 'dicom_study',
  }[target] || target;
}

function lifecycleKey(event: ActivityLike): string | null {
  const family = lifecycleFamily(event);
  if (!family) return null;

  const explicitCorrelation = event.correlation_key?.trim();
  const requestCorrelation = event.request_id?.trim()
    ? `change_request:${event.request_id.trim()}`
    : '';
  const idempotencyCorrelation = event.idempotency_key?.trim()
    ? `idempotency:${event.idempotency_key.trim()}`
    : '';
  const correlation = explicitCorrelation || requestCorrelation || idempotencyCorrelation;
  const resource = normalizedResourceKind(event);
  if (!correlation || !resource) return null;

  if (family === 'deletion_recovery') {
    const targetType = event.target_type?.trim();
    const targetId = event.target_id?.trim();
    if (!targetType || !targetId) return null;
    return `${correlation}:${family}:${resource}:${targetType}:${targetId}`;
  }
  return `${correlation}:${family}:${resource}`;
}

function rawLifecycleEvents<T extends ActivityLike>(event: T): T[] {
  if (!Array.isArray(event.lifecycle_events) || event.lifecycle_events.length === 0) return [event];
  return event.lifecycle_events as T[];
}

/**
 * Consume the server lifecycle contract and safely support older raw feeds.
 * A target id or timestamp is never used as correlation evidence by itself.
 */
export function groupActivityLifecycles<T extends ActivityLike>(events: T[]): ActivityLifecycle<T>[] {
  const grouped = new Map<string, T[]>();
  const seenEventIds = new Set<string>();

  for (const item of events) {
    for (const event of rawLifecycleEvents(item)) {
      if (seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      const reliableKey = lifecycleKey(event);
      const key = reliableKey ? `lifecycle:${reliableKey}` : `audit:${event.id}`;
      const lifecycleEvents = grouped.get(key) || [];
      lifecycleEvents.push(event);
      grouped.set(key, lifecycleEvents);
    }
  }

  const output: ActivityLifecycle<T>[] = [];
  for (const [lifecycleId, rawEvents] of grouped.entries()) {
    const lifecycleEvents = rawEvents.slice().sort(compareEvents);
    const latest = lifecycleEvents[lifecycleEvents.length - 1];
    const idempotencyKeys = new Set(lifecycleEvents.map(event => event.idempotency_key?.trim()).filter(Boolean));
    const requestIds = new Set(lifecycleEvents.map(event => event.request_id?.trim()).filter(Boolean));
    output.push({
      ...latest,
      lifecycle_id: lifecycleId,
      lifecycle_events: lifecycleEvents,
      latest_phase: latest.phase || 'event',
      idempotency_key: idempotencyKeys.size === 1 ? [...idempotencyKeys][0] : null,
      request_id: requestIds.size === 1 ? [...requestIds][0] : null,
    } as ActivityLifecycle<T>);
  }
  return output.sort((left, right) => compareEvents(right, left));
}
