export type PatientStatusOption = {
  key: string;
  label: string;
  description?: string;
};

/**
 * These values describe the user's own lived status. They are intentionally
 * separate from clinician-owned diagnosis, prescription, and publication
 * states, and therefore take effect immediately.
 */
export const PATIENT_PROBLEM_TRACKING_OPTIONS: PatientStatusOption[] = [
  { key: 'actively_treating', label: '我還在治療' },
  { key: 'following', label: '我還在追蹤' },
  { key: 'doctor_said_no_follow_up', label: '醫師說不用追蹤' },
  { key: 'no_longer_tracking', label: '我不想再追蹤' },
  { key: 'resolved_by_self_report', label: '我覺得已完成治療' },
  { key: 'unsure', label: '我不確定' },
];

export const PATIENT_PROBLEM_TRACKING_LABELS: Record<string, string> =
  Object.fromEntries(PATIENT_PROBLEM_TRACKING_OPTIONS.map((option) => [option.key, option.label]));

export const PATIENT_CONDITION_STATUS_OPTIONS: PatientStatusOption[] = [
  { key: 'active', label: '目前有症狀／狀況持續中' },
  { key: 'monitoring', label: '持續觀察中' },
  { key: 'resolved', label: '目前已緩解' },
  { key: 'unsure', label: '不確定' },
];

export const PATIENT_CONDITION_STATUS_LABELS: Record<string, string> =
  Object.fromEntries(PATIENT_CONDITION_STATUS_OPTIONS.map((option) => [option.key, option.label]));

export const PATIENT_MEDICATION_USAGE_OPTIONS: PatientStatusOption[] = [
  { key: 'taking', label: '我正在吃' },
  { key: 'not_taking', label: '我沒有在吃' },
  { key: 'doctor_stopped', label: '醫師已停藥' },
  { key: 'course_completed', label: '療程吃完了' },
  { key: 'self_stopped', label: '我自己先停了' },
  { key: 'side_effect_stopped', label: '因副作用停用' },
  { key: 'unsure', label: '我不確定' },
];

export const PATIENT_MEDICATION_USAGE_LABELS: Record<string, string> =
  Object.fromEntries(PATIENT_MEDICATION_USAGE_OPTIONS.map((option) => [option.key, option.label]));

const MEDICATION_SAFETY_NOTICE_STATES = new Set(['self_stopped', 'side_effect_stopped']);

export function medicationUsageNeedsSafetyNotice(status: string): boolean {
  return MEDICATION_SAFETY_NOTICE_STATES.has(status);
}
