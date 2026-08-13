'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { memberDisplayName, memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';
import {
  getNhiProfileCandidates,
  nhiProfileCandidateEvidenceGroups,
  saveNhiProfileCandidate,
  type NhiProfileCandidate,
  type NhiProfileCandidatePage,
} from '@/lib/nhiImports';
import {
  PATIENT_CONDITION_STATUS_LABELS,
  PATIENT_CONDITION_STATUS_OPTIONS,
  PATIENT_PROBLEM_TRACKING_LABELS,
  PATIENT_PROBLEM_TRACKING_OPTIONS,
} from '@/lib/patientStatus';
import { useSync } from '@/lib/sync';
import { useActiveMember } from '../member-context';
import { useToast } from '../toast-context';
import { AccessibleDialog } from '../_components/Shared';

type ConditionOut = {
  id: number;
  member_name?: string | null;
  display_name: string;
  status: string;
  onset_date?: string | null;
  note?: string | null;
  source?: string | null;
  is_patient_managed?: boolean;
  is_verified?: boolean;
  is_published?: boolean;
};

type ProblemTimelineItem = {
  id: string;
  date?: string | null;
  event_date?: string | null;
  type: string;
  label: string;
};

type ProblemSlotMap = Record<string, Array<Record<string, unknown>>>;

type ProblemOut = {
  id: number;
  member_name?: string | null;
  display_name: string;
  display_layman?: string | null;
  user_visible_explanation?: string | null;
  status: string;
  tier?: number | null;
  diagnosis_status?: string | null;
  treatment_plan?: string | null;
  follow_up_cadence?: string | null;
  follow_up_recommendation?: string | null;
  patient_tracking_state?: string | null;
  slots?: ProblemSlotMap;
  timeline?: ProblemTimelineItem[];
};

type NhiConditionDraftOut = {
  id: number;
  member_name?: string | null;
  diagnosis: string;
  date?: string | null;
  facility?: string | null;
  section: string;
  section_label: string;
  review_status: string;
  review_status_label: string;
  publish_status: string;
  publish_status_label: string;
  source: 'nhi_import';
  source_label: string;
  organization_label: string;
  confirmation_label: string;
  patient_tracking_state?: string | null;
  patient_tracking_state_id?: string | null;
};

type NhiConditionCandidate = NhiProfileCandidate;

type ConditionForm = {
  display_name: string;
  status: string;
  onset_date: string;
  note: string;
};

type TrackingFilter = 'tracking' | 'completed' | 'all';

type UndoChange = {
  kind: 'condition' | 'problem' | 'nhi-draft';
  id: number;
  label: string;
  previous: string | null;
  next: string;
  reportedStateId?: string;
};

const EMPTY_FORM: ConditionForm = {
  display_name: '',
  status: 'active',
  onset_date: '',
  note: '',
};

const SLOT_LABELS: Record<string, string> = {
  condition: '病況',
  medication: '用藥',
  health_record: '量測',
  document: '文件',
  dicom_study: '影像',
  nhi_draft: 'NHI',
  follow_up: '追蹤',
  missing_data_request: '補資料',
};

const COMPLETED_PROBLEM_STATES = new Set([
  'doctor_said_no_follow_up',
  'no_longer_tracking',
  'resolved_by_self_report',
]);

function slotCount(problem: ProblemOut) {
  return Object.values(problem.slots ?? {}).reduce(
    (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
}

function officialStatusLabel(status?: string | null) {
  if (status === 'underlying') return '長期追蹤';
  if (status === 'resolved') return '已處理';
  return '追蹤中';
}

function diagnosisLabel(status?: string | null) {
  if (status === 'confirmed') return '已確認';
  if (status === 'suspected') return '疑似';
  if (status === 'ruled_out') return '已排除';
  return '待確認';
}

function dateText(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export default function ConditionsPage() {
  const { activeMember, members, canWriteMember, writeAccessReason } = useActiveMember();
  const { showToast } = useToast();
  const sync = useSync();
  const syncVersion = Math.max(
    sync.viewVersions.patient_problem_detail ?? 0,
    sync.viewVersions.patient_dashboard ?? 0,
    sync.viewVersions.patient_nhi_imports ?? 0,
  );
  const [conditions, setConditions] = useState<ConditionOut[]>([]);
  const [problems, setProblems] = useState<ProblemOut[]>([]);
  const [nhiDrafts, setNhiDrafts] = useState<NhiConditionDraftOut[]>([]);
  const [nhiCandidates, setNhiCandidates] = useState<NhiConditionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [conditionError, setConditionError] = useState('');
  const [problemError, setProblemError] = useState('');
  const [nhiDraftError, setNhiDraftError] = useState('');
  const [nhiCandidateError, setNhiCandidateError] = useState('');
  const [nhiCandidateLoading, setNhiCandidateLoading] = useState(false);
  const [nhiCandidateOpen, setNhiCandidateOpen] = useState(false);
  const [nhiCandidateQuery, setNhiCandidateQuery] = useState('');
  const [nhiCandidateSearch, setNhiCandidateSearch] = useState('');
  const [nhiCandidateCursor, setNhiCandidateCursor] = useState<string | null>(null);
  const [nhiCandidatePage, setNhiCandidatePage] = useState<NhiProfileCandidatePage>({
    items: [],
    next_cursor: null,
    previous_cursor: null,
  });
  const [nhiCandidateToConfirm, setNhiCandidateToConfirm] = useState<NhiConditionCandidate | null>(null);
  const [nhiCandidateStatus, setNhiCandidateStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ConditionForm>(EMPTY_FORM);
  const [busy, setBusy] = useState('');
  const [trackingFilter, setTrackingFilter] = useState<TrackingFilter>('tracking');
  const [undoChange, setUndoChange] = useState<UndoChange | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConditionOut | null>(null);
  const [deletedCondition, setDeletedCondition] = useState<ConditionOut | null>(null);
  const [deleteOperationKey, setDeleteOperationKey] = useState('');
  const [restoreOperationKey, setRestoreOperationKey] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstDialogControlRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const nhiCandidateStatusRef = useRef<HTMLSelectElement>(null);
  const nhiCandidateReturnFocusRef = useRef<HTMLElement | null>(null);
  const conditionCreateOperationRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家總覽' : '本人');
  const selectedMember = normalizeMemberName(activeMember)
    || (members.length === 1 ? normalizeMemberName(members[0]?.name) : '');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const params = memberQueryParams(activeMember);
    const [conditionResult, deletedConditionResult, problemResult, nhiDraftResult] = await Promise.allSettled([
      api.get('/api/conditions', params),
      api.get('/api/conditions', { ...params, deleted: 'true' }),
      api.get('/api/patients/me/problems', params),
      api.get('/api/patients/me/nhi-condition-drafts', params),
    ]);

    if (conditionResult.status === 'fulfilled') {
      const rows = Array.isArray(conditionResult.value) ? conditionResult.value as ConditionOut[] : [];
      setConditions(rows.filter((row) => row.is_patient_managed || row.source === 'patient_created'));
      setConditionError('');
    } else {
      setConditionError(errorMessage(conditionResult.reason, '你的病況讀取失敗，請稍後再試。'));
    }

    if (deletedConditionResult.status === 'fulfilled') {
      const rows = Array.isArray(deletedConditionResult.value)
        ? deletedConditionResult.value as ConditionOut[]
        : [];
      setDeletedCondition(rows[0] ?? null);
      if (rows[0]) setRestoreOperationKey(`restore-condition-${rows[0].id}-${crypto.randomUUID()}`);
    }

    if (problemResult.status === 'fulfilled') {
      setProblems(Array.isArray(problemResult.value) ? problemResult.value as ProblemOut[] : []);
      setProblemError('');
    } else {
      setProblemError(errorMessage(problemResult.reason, '醫療團隊診斷讀取失敗，請稍後再試。'));
    }

    if (nhiDraftResult.status === 'fulfilled') {
      setNhiDrafts(Array.isArray(nhiDraftResult.value) ? nhiDraftResult.value as NhiConditionDraftOut[] : []);
      setNhiDraftError('');
    } else {
      setNhiDraftError(errorMessage(nhiDraftResult.reason, '健保匯入疾病讀取失敗，請稍後再試。'));
    }
    if (!silent) setLoading(false);
  }, [activeMember]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (syncVersion > 0) void load(true);
  }, [load, syncVersion]);

  const activeConditions = useMemo(
    () => conditions.filter((condition) => condition.status !== 'resolved'),
    [conditions],
  );
  const activeProblems = useMemo(
    () => problems.filter((problem) => problem.status !== 'resolved'),
    [problems],
  );
  const trackingProblems = useMemo(
    () => problems.filter((problem) => !COMPLETED_PROBLEM_STATES.has(problem.patient_tracking_state ?? '')),
    [problems],
  );
  const trackingNhiDrafts = useMemo(
    () => nhiDrafts.filter((draft) => !COMPLETED_PROBLEM_STATES.has(draft.patient_tracking_state ?? '')),
    [nhiDrafts],
  );
  const visibleConditions = useMemo(() => conditions.filter((condition) => {
    if (trackingFilter === 'all') return true;
    const completed = condition.status === 'resolved';
    return trackingFilter === 'completed' ? completed : !completed;
  }), [conditions, trackingFilter]);
  const visibleProblems = useMemo(() => problems.filter((problem) => {
    if (trackingFilter === 'all') return true;
    const completed = COMPLETED_PROBLEM_STATES.has(problem.patient_tracking_state ?? '');
    return trackingFilter === 'completed' ? completed : !completed;
  }), [problems, trackingFilter]);
  const visibleNhiDrafts = useMemo(() => nhiDrafts.filter((draft) => {
    if (trackingFilter === 'all') return true;
    const completed = COMPLETED_PROBLEM_STATES.has(draft.patient_tracking_state ?? '');
    return trackingFilter === 'completed' ? completed : !completed;
  }), [nhiDrafts, trackingFilter]);

  const loadNhiCandidates = useCallback(async (cursor = nhiCandidateCursor, query = nhiCandidateQuery) => {
    if (!nhiCandidateOpen) return;
    setNhiCandidateLoading(true);
    setNhiCandidateError('');
    try {
      const page = await getNhiProfileCandidates({
        kind: 'condition',
        q: query,
        cursor,
        limit: 10,
        member: selectedMember || normalizeMemberName(activeMember) || null,
      });
      const conditionItems = page.items.filter((candidate) => candidate.profile_kind === 'condition');
      setNhiCandidatePage({ ...page, items: conditionItems });
      setNhiCandidates(conditionItems);
    } catch (error) {
      setNhiCandidates([]);
      setNhiCandidatePage({ items: [], next_cursor: null, previous_cursor: null });
      setNhiCandidateError(errorMessage(error, '可加入的健保疾病讀取失敗，請稍後再試。'));
    } finally {
      setNhiCandidateLoading(false);
    }
  }, [activeMember, nhiCandidateCursor, nhiCandidateOpen, nhiCandidateQuery, selectedMember]);

  useEffect(() => {
    if (nhiCandidateOpen) void loadNhiCandidates();
  }, [loadNhiCandidates, nhiCandidateOpen]);

  useEffect(() => {
    const activeDialog = showForm || Boolean(deleteTarget);
    if (!activeDialog) return;
    const focusTarget = firstDialogControlRef.current;
    const focusTimer = window.setTimeout(() => focusTarget?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (deleteTarget) setDeleteTarget(null);
        else {
          conditionCreateOperationRef.current = null;
          setShowForm(false);
        }
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [deleteTarget, showForm]);

  const openCreate = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!selectedMember) {
      showToast('請先從頁面上方選擇要記錄的家庭成員', 'error');
      return;
    }
    returnFocusRef.current = event?.currentTarget ?? null;
    conditionCreateOperationRef.current = null;
    setEditingId(null);
    setForm(EMPTY_FORM);
    firstDialogControlRef.current = null;
    setShowForm(true);
  };

  const canSaveNhiCondition = (candidate: NhiConditionCandidate) => {
    const clinicalKind = candidate.clinical_kind?.trim().toLowerCase() || '';
    return candidate.profile_kind === 'condition'
      && (!clinicalKind || ['condition', 'diagnosis', 'problem'].includes(clinicalKind))
      && candidate.eligible
      && candidate.can_save_to_profile;
  };

  const openNhiConditionConfirmation = (
    candidate: NhiConditionCandidate,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!canWriteMember(candidate.member_name)) {
      showToast(writeAccessReason(candidate.member_name) ?? '目前身份為唯讀，無法加入病況。', 'info');
      return;
    }
    if (!canSaveNhiCondition(candidate)) {
      showToast(candidate.ineligible_reason ?? '這筆資料不是可加入的病況，無法存入我的病況。', 'info');
      return;
    }
    nhiCandidateReturnFocusRef.current = event.currentTarget;
    setNhiCandidateStatus('');
    setNhiCandidateToConfirm(candidate);
  };

  const saveNhiCondition = async (candidate: NhiConditionCandidate, status: string) => {
    if (!status) {
      showToast('請先選擇這個病況目前的狀態。', 'info');
      return;
    }
    const busyKey = `nhi-candidate-${candidate.fact_id}`;
    setBusy(busyKey);
    try {
      await saveNhiProfileCandidate(candidate.fact_id, {
        status,
      });
      setNhiCandidates((current) => current.map((item) => (
        item.fact_id === candidate.fact_id ? { ...item, saved_to_profile: true } : item
      )));
      await load(true);
      await loadNhiCandidates();
      setNhiCandidateToConfirm(null);
      setNhiCandidateStatus('');
      showToast(`已加入我的病況，狀態為「${PATIENT_CONDITION_STATUS_LABELS[status] ?? '由我確認'}」。`, 'success');
      sync.refreshNow();
    } catch (error) {
      showToast(errorMessage(error, '加入病況失敗，請稍後再試。'), 'error');
    } finally {
      setBusy('');
    }
  };

  const openEdit = (condition: ConditionOut, event?: React.MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event?.currentTarget ?? null;
    conditionCreateOperationRef.current = null;
    setEditingId(condition.id);
    setForm({
      display_name: condition.display_name,
      status: condition.status || 'active',
      onset_date: condition.onset_date || '',
      note: condition.note || '',
    });
    firstDialogControlRef.current = null;
    setShowForm(true);
  };

  const saveCondition = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.display_name.trim()) return;
    if (!editingId && !selectedMember) {
      showToast('請先選擇家庭成員', 'error');
      return;
    }
    setBusy('save');
    try {
      const payload = {
        display_name: form.display_name.trim(),
        status: form.status,
        onset_date: form.onset_date || null,
        note: form.note.trim() || null,
        ...(!editingId ? { member_name: selectedMember } : {}),
      };
      let createOptions: { idempotencyKey: string } | undefined;
      if (!editingId) {
        const fingerprint = JSON.stringify(payload);
        if (conditionCreateOperationRef.current?.fingerprint !== fingerprint) {
          const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          conditionCreateOperationRef.current = {
            fingerprint,
            key: `condition-create-${suffix}`,
          };
        }
        createOptions = { idempotencyKey: conditionCreateOperationRef.current.key };
      }
      const saved = editingId
        ? await api.patch(`/api/conditions/${editingId}`, payload)
        : await api.post('/api/conditions', payload, createOptions);
      const row = saved as ConditionOut;
      setConditions((current) => (
        editingId
          ? current.map((condition) => condition.id === editingId ? row : condition)
          : [row, ...current]
      ));
      showToast(editingId ? '你的病況已更新，立即生效' : '你的病況已新增，立即生效', 'success');
      setShowForm(false);
      conditionCreateOperationRef.current = null;
      setEditingId(null);
      setForm(EMPTY_FORM);
      sync.refreshNow();
    } catch (error) {
      showToast(errorMessage(error, '儲存失敗，請稍後再試'), 'error');
    } finally {
      setBusy('');
    }
  };

  const updateConditionStatus = async (condition: ConditionOut, status: string) => {
    const previous = condition.status;
    if (previous === status) return;
    setConditions((current) => current.map((row) => row.id === condition.id ? { ...row, status } : row));
    setBusy(`condition-${condition.id}`);
    try {
      const saved = await api.patch(`/api/conditions/${condition.id}`, { status }) as ConditionOut;
      setConditions((current) => current.map((row) => row.id === condition.id ? saved : row));
      setUndoChange({ kind: 'condition', id: condition.id, label: condition.display_name, previous, next: status });
      showToast(`你的狀態已更新為「${PATIENT_CONDITION_STATUS_LABELS[status] ?? '狀態已記錄'}」`, 'success');
      sync.refreshNow();
    } catch (error) {
      setConditions((current) => current.map((row) => row.id === condition.id ? { ...row, status: previous } : row));
      showToast(errorMessage(error, '狀態更新失敗'), 'error');
    } finally {
      setBusy('');
    }
  };

  const requestDelete = (condition: ConditionOut, event: React.MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    firstDialogControlRef.current = null;
    setDeleteOperationKey(`delete-condition-${condition.id}-${crypto.randomUUID()}`);
    setDeleteTarget(condition);
  };

  const deleteCondition = async () => {
    const condition = deleteTarget;
    if (!condition) return;
    setBusy(`delete-${condition.id}`);
    try {
      await api.delete(
        `/api/conditions/${condition.id}`,
        { idempotencyKey: deleteOperationKey || `delete-condition-${condition.id}-${crypto.randomUUID()}` },
      );
      setConditions((current) => current.filter((row) => row.id !== condition.id));
      setDeleteTarget(null);
      setDeletedCondition(condition);
      setRestoreOperationKey(`restore-condition-${condition.id}-${crypto.randomUUID()}`);
      showToast('已從你的病況清單移除；你仍可在下方復原這筆個人紀錄。', 'success');
      sync.refreshNow();
    } catch (error) {
      showToast(errorMessage(error, '移除失敗，請稍後再試'), 'error');
    } finally {
      setBusy('');
    }
  };

  const restoreDeletedCondition = async () => {
    const condition = deletedCondition;
    if (!condition) return;
    setBusy('restore-condition');
    try {
      const restored = await api.post(
        `/api/conditions/${condition.id}/restore`,
        undefined,
        { idempotencyKey: restoreOperationKey || `restore-condition-${condition.id}-${crypto.randomUUID()}` },
      ) as ConditionOut;
      setConditions((current) => [restored, ...current]);
      setDeletedCondition(null);
      setDeleteOperationKey('');
      setRestoreOperationKey('');
      showToast('已復原到我的病況清單。', 'success');
      sync.refreshNow();
    } catch (error) {
      showToast(errorMessage(error, '復原失敗；原紀錄仍維持移除狀態。'), 'error');
    } finally {
      setBusy('');
    }
  };

  const updateProblemTracking = async (problem: ProblemOut, status: string) => {
    const previous = problem.patient_tracking_state ?? null;
    if (previous === status) return;
    setProblems((current) => current.map((row) => (
      row.id === problem.id ? { ...row, patient_tracking_state: status } : row
    )));
    setBusy(`problem-${problem.id}`);
    try {
      const response = await api.post(`/api/patients/me/problems/${problem.id}/tracking-state`, {
        tracking_state: status,
      }) as { reported_state?: { id?: string } };
      setUndoChange({
        kind: 'problem',
        id: problem.id,
        label: problem.display_layman || problem.display_name,
        previous,
        next: status,
        reportedStateId: response.reported_state?.id,
      });
      showToast(`你的追蹤狀況已更新為「${PATIENT_PROBLEM_TRACKING_LABELS[status] ?? '狀態已記錄'}」`, 'success');
      sync.refreshNow();
    } catch (error) {
      setProblems((current) => current.map((row) => (
        row.id === problem.id ? { ...row, patient_tracking_state: previous } : row
      )));
      showToast(errorMessage(error, '追蹤狀況更新失敗'), 'error');
    } finally {
      setBusy('');
    }
  };

  const updateNhiDraftTracking = async (draft: NhiConditionDraftOut, status: string) => {
    const previous = draft.patient_tracking_state ?? null;
    if (previous === status) return;
    setNhiDrafts((current) => current.map((row) => (
      row.id === draft.id ? { ...row, patient_tracking_state: status } : row
    )));
    setBusy(`nhi-draft-${draft.id}`);
    try {
      const response = await api.post(`/api/patients/me/nhi-drafts/${draft.id}/tracking-state`, {
        tracking_state: status,
      }) as { reported_state?: { id?: string } };
      const reportedStateId = response.reported_state?.id ?? draft.patient_tracking_state_id ?? undefined;
      setNhiDrafts((current) => current.map((row) => (
        row.id === draft.id
          ? { ...row, patient_tracking_state: status, patient_tracking_state_id: reportedStateId ?? null }
          : row
      )));
      setUndoChange({
        kind: 'nhi-draft',
        id: draft.id,
        label: draft.diagnosis,
        previous,
        next: status,
        reportedStateId,
      });
      showToast(`你的追蹤狀況已更新為「${PATIENT_PROBLEM_TRACKING_LABELS[status] ?? '狀態已記錄'}」`, 'success');
      sync.refreshNow();
    } catch (error) {
      setNhiDrafts((current) => current.map((row) => (
        row.id === draft.id ? { ...row, patient_tracking_state: previous } : row
      )));
      showToast(errorMessage(error, '追蹤狀況更新失敗，已恢復原本狀態'), 'error');
    } finally {
      setBusy('');
    }
  };

  const undoLastTrackingChange = async () => {
    const change = undoChange;
    if (!change) return;
    setUndoChange(null);
    setBusy(`undo-${change.kind}-${change.id}`);
    if (change.kind === 'condition') {
      setConditions((current) => current.map((row) => row.id === change.id ? { ...row, status: change.previous as string } : row));
    } else if (change.kind === 'problem' && change.previous !== null) {
      setProblems((current) => current.map((row) => row.id === change.id ? { ...row, patient_tracking_state: change.previous } : row));
    } else if (change.kind === 'problem') {
      setProblems((current) => current.map((row) => row.id === change.id ? { ...row, patient_tracking_state: null } : row));
    } else {
      setNhiDrafts((current) => current.map((row) => (
        row.id === change.id ? { ...row, patient_tracking_state: change.previous } : row
      )));
    }
    try {
      if (change.kind === 'condition') {
        const saved = await api.patch(`/api/conditions/${change.id}`, { status: change.previous }) as ConditionOut;
        setConditions((current) => current.map((row) => row.id === change.id ? saved : row));
      } else if (change.reportedStateId && change.previous === null) {
        await api.post(`/api/patients/me/patient-reported-states/${change.reportedStateId}/withdraw`, {});
      } else if (change.reportedStateId) {
        await api.post(`/api/patients/me/patient-reported-states/${change.reportedStateId}/restore-previous`, {});
      } else {
        const path = change.kind === 'nhi-draft'
          ? `/api/patients/me/nhi-drafts/${change.id}/tracking-state`
          : `/api/patients/me/problems/${change.id}/tracking-state`;
        await api.post(path, { tracking_state: change.previous ?? 'unsure' });
      }
      showToast(`已復原「${change.label}」的追蹤狀況`, 'success');
      sync.refreshNow();
    } catch (error) {
      if (change.kind === 'condition') {
        setConditions((current) => current.map((row) => row.id === change.id ? { ...row, status: change.next } : row));
      } else if (change.kind === 'problem') {
        setProblems((current) => current.map((row) => row.id === change.id ? { ...row, patient_tracking_state: change.next } : row));
      } else {
        setNhiDrafts((current) => current.map((row) => row.id === change.id ? { ...row, patient_tracking_state: change.next } : row));
      }
      showToast(errorMessage(error, '復原失敗，已保留目前狀態'), 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-wrap" style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
      <div className="hk-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="hk-badge hk-b-blue" style={{ marginBottom: 8 }}>{scopeLabel}</div>
            <h1 style={{ margin: 0, fontSize: 24, color: 'var(--hk-ink)' }}>疾病與病況管理</h1>
            <p style={{ margin: '8px 0 0', color: 'var(--hk-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
              你的症狀與追蹤狀況由你直接管理、立即生效；正式診斷與醫療紀錄仍由醫療團隊確認。
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="hk-btn hk-btn-primary hk-btn-sm" onClick={openCreate}>新增我的病況</button>
            <Link className="hk-btn hk-btn-ghost hk-btn-sm" href={memberHref('/dashboard/health', activeMember)}>查看健康全貌</Link>
          </div>
        </div>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12, marginBottom: 16 }}>
        <div className="hk-card"><div className="hk-ctitle">我的病況</div><strong style={{ fontSize: 28 }}>{conditions.length}</strong></div>
        <div className="hk-card"><div className="hk-ctitle">目前持續中</div><strong style={{ fontSize: 28 }}>{activeConditions.length + trackingProblems.length + trackingNhiDrafts.length}</strong></div>
        <div className="hk-card"><div className="hk-ctitle">醫療團隊診斷</div><strong style={{ fontSize: 28 }}>{problems.length}</strong></div>
        <div className="hk-card"><div className="hk-ctitle">健保匯入疾病</div><strong style={{ fontSize: 28 }}>{nhiDrafts.length}</strong></div>
      </section>

      <div className="hk-card" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ marginRight: 4, fontSize: 13, color: 'var(--hk-ink-2)' }}>顯示</strong>
        {([
          ['tracking', '還在治療／追蹤'],
          ['completed', '已完成／不用追蹤'],
          ['all', '全部'],
        ] as Array<[TrackingFilter, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`hk-btn hk-btn-sm ${trackingFilter === key ? 'hk-btn-primary' : 'hk-btn-ghost'}`}
            aria-pressed={trackingFilter === key}
            onClick={() => setTrackingFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {undoChange && (
        <div className="hk-card" role="status" aria-live="polite" style={{ marginBottom: 16, borderColor: 'var(--primary)', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--hk-ink-2)', fontSize: 13 }}>已更新「{undoChange.label}」；這是你的個人狀態，不會覆寫正式診斷。</span>
          <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" disabled={busy.startsWith('undo-')} onClick={() => void undoLastTrackingChange()}>
            復原上次變更
          </button>
        </div>
      )}

      {showForm && (
        <div style={modalBackdropStyle}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="condition-form-heading"
            className="hk-card"
            style={modalPanelStyle}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div className="hk-badge hk-b-blue" style={{ marginBottom: 6 }}>我的健康紀錄</div>
                <h2 id="condition-form-heading" style={{ margin: 0, fontSize: 19 }}>{editingId ? '修改我的病況' : `新增${selectedMember ? `「${selectedMember}」的` : ''}病況`}</h2>
              </div>
              <span className="hk-badge hk-b-green">儲存後立即生效</span>
            </div>
            <form onSubmit={saveCondition}>
              <div className="grid-2col" style={{ gap: 12 }}>
                <label style={dialogLabelStyle}>
                  病況或症狀名稱
                  <input
                    ref={(node) => { firstDialogControlRef.current = node; }}
                    value={form.display_name}
                    onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                    placeholder="例：最近容易頭暈"
                    required
                    style={inputStyle}
                  />
                </label>
                <label style={dialogLabelStyle}>
                  目前狀態
                  <select
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                    style={inputStyle}
                  >
                    {PATIENT_CONDITION_STATUS_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label style={dialogLabelStyle}>
                  開始日期（選填）
                  <input
                    type="date"
                    value={form.onset_date}
                    onChange={(event) => setForm((current) => ({ ...current, onset_date: event.target.value }))}
                    style={inputStyle}
                  />
                </label>
                <label style={dialogLabelStyle}>
                  補充說明（選填）
                  <input
                    value={form.note}
                    onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                    placeholder="發生頻率、情境或你想記住的資訊"
                    style={inputStyle}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
                <button type="submit" className="hk-btn hk-btn-primary hk-btn-sm" disabled={busy === 'save'} style={touchButtonStyle}>
                  {busy === 'save' ? '儲存中…' : '儲存我的病況'}
                </button>
                <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => {
                  conditionCreateOperationRef.current = null;
                  setShowForm(false);
                }} style={touchButtonStyle}>取消</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={modalBackdropStyle}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="condition-delete-heading"
            className="hk-card"
            style={modalPanelStyle}
          >
            <div className="hk-badge hk-b-amber" style={{ marginBottom: 8 }}>移除前確認</div>
            <h2 id="condition-delete-heading" style={{ margin: 0, fontSize: 19 }}>要移除「{deleteTarget.display_name}」嗎？</h2>
            <p style={{ color: 'var(--hk-ink-2)', lineHeight: 1.65, fontSize: 14 }}>
                這只會把你的病況紀錄移到最近刪除，不會改變健保存摺或醫療團隊的正式診斷。完成後可用「復原到清單」還原同一筆紀錄與來源資訊。
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                ref={(node) => { firstDialogControlRef.current = node; }}
                type="button"
                className="hk-btn hk-btn-primary hk-btn-sm"
                disabled={busy === `delete-${deleteTarget.id}`}
                onClick={() => void deleteCondition()}
                style={touchButtonStyle}
              >
                {busy === `delete-${deleteTarget.id}` ? '移除中…' : '確認移除'}
              </button>
              <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => setDeleteTarget(null)} style={touchButtonStyle}>保留這筆</button>
            </div>
          </div>
        </div>
      )}

      <section style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'end', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>我的病況與症狀</h2>
            <div style={{ color: 'var(--hk-ink-3)', fontSize: 13, marginTop: 4 }}>可新增、修改、移除與調整狀態，不需等待醫療團隊。</div>
          </div>
          {conditionError && <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => void load()}>重試</button>}
        </div>
        {conditionError && <div className="hk-card hk-b-red" style={{ marginBottom: 10 }}>{conditionError}</div>}
        {loading ? (
          <div className="hk-card" style={{ color: 'var(--hk-ink-3)' }}>讀取中…</div>
        ) : visibleConditions.length === 0 ? (
          <div className="hk-card" style={{ color: 'var(--hk-ink-2)', lineHeight: 1.6 }}>
            {conditions.length === 0
              ? '目前還沒有你自行記錄的病況。你可以新增症狀、觀察中的狀況，或補充醫療團隊尚未整理的資訊。'
              : '這個篩選條件下目前沒有病況。'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {visibleConditions.map((condition) => (
              <article key={condition.id} className="hk-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 850, fontSize: 17 }}>{condition.display_name}</div>
                    <div style={{ color: 'var(--hk-ink-3)', fontSize: 12, marginTop: 4 }}>
                      {condition.member_name || '本人'}{condition.onset_date ? ` · 開始於 ${dateText(condition.onset_date)}` : ''}
                    </div>
                    {condition.note && <div style={{ color: 'var(--hk-ink-2)', fontSize: 13, marginTop: 8, lineHeight: 1.55 }}>{condition.note}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <select
                      aria-label={`更新${condition.display_name}的目前狀態（立即生效）`}
                      value={condition.status}
                      disabled={busy === `condition-${condition.id}`}
                      onChange={(event) => void updateConditionStatus(condition, event.target.value)}
                      style={statusSelectStyle}
                    >
                      {PATIENT_CONDITION_STATUS_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                    <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={(event) => openEdit(condition, event)} style={touchButtonStyle}>修改</button>
                    <button
                      type="button"
                      className="hk-btn hk-btn-ghost hk-btn-sm"
                      disabled={busy === `delete-${condition.id}`}
                      onClick={(event) => requestDelete(condition, event)}
                      style={{ ...touchButtonStyle, color: 'var(--hk-red)' }}
                    >
                      移除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {deletedCondition && (
        <div className="hk-card" role="status" aria-live="polite" style={{ marginBottom: 20, borderColor: 'var(--primary)', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--hk-ink-2)', fontSize: 13 }}>「{deletedCondition.display_name}」已移除；這是你的個人紀錄，健保存摺與正式診斷未受影響。</span>
          <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" disabled={busy === 'restore-condition'} onClick={() => void restoreDeletedCondition()} style={touchButtonStyle}>
            {busy === 'restore-condition' ? '復原中…' : '復原到清單'}
          </button>
        </div>
      )}

      <details
        className="hk-card"
        open={nhiCandidateOpen}
        onToggle={(event) => setNhiCandidateOpen(event.currentTarget.open)}
        style={{ marginBottom: 20, border: '1px solid #cfe3e8' }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 850, color: 'var(--hk-ink)', minHeight: 44, display: 'flex', alignItems: 'center' }}>
          從健保匯入找可加入的病況
        </summary>
        <div style={{ paddingTop: 12 }}>
          <p style={{ margin: '0 0 12px', color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.6 }}>
            候選只會列出臨床病況。加入後是你自己的可編輯健康紀錄，不會改寫健保資料，也不代表醫療團隊已正式確認診斷。
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const query = nhiCandidateSearch.trim();
              setNhiCandidateQuery(query);
              setNhiCandidateCursor(null);
              if (query === nhiCandidateQuery && nhiCandidateCursor === null) void loadNhiCandidates(null, query);
            }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}
          >
            <label style={{ ...dialogLabelStyle, flex: '1 1 240px' }}>
              搜尋候選
              <input
                value={nhiCandidateSearch}
                onChange={(event) => setNhiCandidateSearch(event.target.value)}
                placeholder="搜尋疾病名稱或證據摘要"
                style={inputStyle}
              />
            </label>
            <button type="submit" className="hk-btn hk-btn-ghost hk-btn-sm" style={touchButtonStyle}>搜尋</button>
          </form>
          {nhiCandidateError && (
            <div role="alert" className="hk-b-red" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>{nhiCandidateError}</span>
              <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => void loadNhiCandidates()} style={touchButtonStyle}>重試</button>
            </div>
          )}
          {nhiCandidateLoading ? (
            <div role="status" style={{ marginTop: 14, color: 'var(--hk-ink-3)' }}>正在讀取候選…</div>
          ) : nhiCandidates.length === 0 && !nhiCandidateError ? (
            <div style={{ marginTop: 14, color: 'var(--hk-ink-2)', lineHeight: 1.6 }}>目前沒有符合條件的臨床病況候選。</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
              {nhiCandidates.map((candidate) => {
                const candidateBusy = busy === `nhi-candidate-${candidate.fact_id}`;
                const canAdd = canSaveNhiCondition(candidate);
                const evidenceGroups = nhiProfileCandidateEvidenceGroups(candidate);
                const encounterDate = candidate.date || candidate.encounter_ref?.date || null;
                const encounterFacility = candidate.facility || candidate.encounter_ref?.facility || null;
                return (
                  <article key={candidate.fact_id} className="nhi-profile-candidate" style={{ border: '1px solid var(--hk-line)', borderRadius: 12, padding: 14, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                      <div style={{ fontWeight: 850, color: 'var(--hk-ink)', overflowWrap: 'anywhere' }}>{candidate.title}</div>
                      <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span className="hk-badge hk-b-blue">臨床類型：{candidate.clinical_kind || '病況'}</span>
                        <span className="hk-badge hk-b-gray">{candidate.source_label}</span>
                        {candidate.saved_to_profile && <span className="hk-badge hk-b-green">已在我的病況</span>}
                      </div>
                      {candidate.summary && <div style={{ marginTop: 6, color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.5 }}>{candidate.summary}</div>}
                      <details style={{ marginTop: 8, borderTop: '1px solid var(--hk-line)' }}>
                        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--hk-ink-2)', fontSize: 13, fontWeight: 800 }}>
                          查看證據
                        </summary>
                        <div style={{ padding: '2px 0 8px', color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.6 }}>
                          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 10, rowGap: 4, margin: 0 }}>
                            <dt style={{ fontWeight: 800 }}>就醫資料來源</dt><dd style={{ margin: 0 }}>{candidate.source_label || '健保存摺'}</dd>
                            <dt style={{ fontWeight: 800 }}>最近就醫日期</dt><dd style={{ margin: 0 }}>{dateText(encounterDate) || '未提供'}</dd>
                            <dt style={{ fontWeight: 800 }}>就醫院所</dt><dd style={{ margin: 0 }}>{encounterFacility || '未提供'}</dd>
                            <dt style={{ fontWeight: 800 }}>家庭成員</dt><dd style={{ margin: 0 }}>{candidate.member_name || '本人'}</dd>
                            {candidate.last_seen_at && <><dt style={{ fontWeight: 800 }}>資料最後出現</dt><dd style={{ margin: 0 }}>{dateText(candidate.last_seen_at)}</dd></>}
                          </dl>
                          {candidate.evidence_summary && candidate.evidence_summary !== candidate.summary && (
                            <p style={{ margin: '8px 0 0' }}><strong>證據摘要：</strong>{candidate.evidence_summary}</p>
                          )}
                          {evidenceGroups.length > 0 ? (
                            <div style={{ marginTop: 8 }}>
                              <strong>相關佐證</strong>
                              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                                {evidenceGroups.map((group) => <li key={group.label}>{group.label}{group.count > 1 ? `（${group.count} 筆）` : ''}</li>)}
                              </ul>
                            </div>
                          ) : <p style={{ margin: '8px 0 0' }}>目前沒有額外文件引用；就醫來源與日期仍保留於健保匯入紀錄。</p>}
                        </div>
                      </details>
                      {!canAdd && !candidate.saved_to_profile && <div style={{ marginTop: 6, color: 'var(--hk-ink-3)', fontSize: 12 }}>不可加入：{candidate.ineligible_reason ?? '此筆資料不是可存入的臨床病況。'}</div>}
                    </div>
                    {candidate.saved_to_profile ? (
                      <span className="hk-badge hk-b-green">已加入我的病況</span>
                    ) : canAdd ? (
                      <button
                        type="button"
                        className="hk-btn hk-btn-primary hk-btn-sm"
                        disabled={candidateBusy}
                        onClick={(event) => openNhiConditionConfirmation(candidate, event)}
                        style={touchButtonStyle}
                      >
                        {candidateBusy ? '加入中…' : '確認狀態後加入'}
                      </button>
                    ) : (
                      <span className="hk-badge hk-b-gray" aria-disabled="true">不可加入</span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {(nhiCandidatePage.previous_cursor || nhiCandidatePage.next_cursor) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" disabled={!nhiCandidatePage.previous_cursor || nhiCandidateLoading} onClick={() => setNhiCandidateCursor(nhiCandidatePage.previous_cursor)} style={touchButtonStyle}>上一頁</button>
              <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" disabled={!nhiCandidatePage.next_cursor || nhiCandidateLoading} onClick={() => setNhiCandidateCursor(nhiCandidatePage.next_cursor)} style={touchButtonStyle}>下一頁</button>
            </div>
          )}
        </div>
      </details>

      <section style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'end', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>醫療團隊確認的診斷</h2>
            <div style={{ color: 'var(--hk-ink-3)', fontSize: 13, marginTop: 4 }}>
              診斷內容由醫療團隊維護；你可以立即更新自己的追蹤狀況，或回報正式紀錄需要修正。
            </div>
          </div>
          {problemError && <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => void load()}>重試</button>}
        </div>
        {problemError && <div className="hk-card hk-b-red" style={{ marginBottom: 10 }}>{problemError}</div>}
        {!loading && visibleProblems.length === 0 ? (
          <div className="hk-card" style={{ color: 'var(--hk-ink-3)' }}>
            {problems.length === 0 ? '目前沒有醫療團隊已發布的診斷。' : '這個篩選條件下目前沒有診斷。'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {visibleProblems.map((problem) => {
              const slotEntries = Object.entries(problem.slots ?? {}).filter(([, rows]) => Array.isArray(rows) && rows.length > 0);
              return (
                <article key={problem.id} className="hk-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 850, color: 'var(--hk-ink)' }}>{problem.display_layman || problem.display_name}</div>
                      <div style={{ marginTop: 5, color: 'var(--hk-ink-2)', fontSize: 13 }}>{problem.display_name}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <span className="hk-badge hk-b-blue">{officialStatusLabel(problem.status)}</span>
                      <span className="hk-badge hk-b-cmo">{diagnosisLabel(problem.diagnosis_status)}</span>
                      {problem.tier === 1 && <span className="hk-badge hk-b-red">高風險</span>}
                    </div>
                  </div>

                  {problem.user_visible_explanation && (
                    <div style={{ marginTop: 10, color: 'var(--hk-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
                      {problem.user_visible_explanation}
                    </div>
                  )}
                  {(problem.treatment_plan || problem.follow_up_cadence || problem.follow_up_recommendation) && (
                    <div style={{ marginTop: 10, color: 'var(--hk-ink-2)', fontSize: 13, lineHeight: 1.6 }}>
                      {[problem.treatment_plan, problem.follow_up_cadence, problem.follow_up_recommendation].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {slotEntries.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      {slotEntries.map(([type, rows]) => (
                        <span key={type} className="hk-badge hk-b-green">{SLOT_LABELS[type] ?? '其他來源'} {rows.length}</span>
                      ))}
                      <span style={{ color: 'var(--hk-ink-3)', fontSize: 12, alignSelf: 'center' }}>共 {slotCount(problem)} 個來源</span>
                    </div>
                  )}

                  <div style={{ marginTop: 14, borderTop: '1px solid var(--hk-line)', paddingTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label className="patient-status-control" style={{ fontSize: 13, fontWeight: 800, color: 'var(--hk-ink-2)' }}>
                      我的追蹤狀況
                      <select
                        aria-label={`更新${problem.display_layman || problem.display_name}的個人追蹤狀況（立即生效）`}
                        value={problem.patient_tracking_state ?? ''}
                        disabled={busy === `problem-${problem.id}`}
                        onChange={(event) => { if (event.target.value) void updateProblemTracking(problem, event.target.value); }}
                        style={{ ...statusSelectStyle, marginLeft: 8 }}
                      >
                        <option value="" disabled>選擇目前狀況…</option>
                        {PATIENT_PROBLEM_TRACKING_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <span className="hk-badge hk-b-green">立即生效</span>
                    <Link className="hk-btn hk-btn-ghost hk-btn-sm" href={memberHref('/dashboard/health', activeMember, { section: 'confirmed', problem: String(problem.id) })}>
                      回報正式紀錄需要修正
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="nhi-condition-heading" aria-live="polite">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'end', marginBottom: 10 }}>
          <div>
            <h2 id="nhi-condition-heading" style={{ margin: 0, fontSize: 18 }}>健保匯入／尚未醫療確認</h2>
            <div style={{ color: 'var(--hk-ink-3)', fontSize: 13, marginTop: 4 }}>
              這些疾病名稱由健保存摺匯入並經規則或 AI 整理，尚未成為正式診斷；你只能管理自己的追蹤狀況，不能改寫或刪除來源內容。
            </div>
          </div>
          {nhiDraftError && <button type="button" className="hk-btn hk-btn-ghost hk-btn-sm" onClick={() => void load()}>重試</button>}
        </div>
        {nhiDraftError && <div className="hk-card hk-b-red" role="alert" style={{ marginBottom: 10 }}>{nhiDraftError}</div>}
        {loading ? (
          <div className="hk-card" role="status" style={{ color: 'var(--hk-ink-3)' }}>正在讀取健保匯入疾病…</div>
        ) : visibleNhiDrafts.length === 0 ? (
          <div className="hk-card" style={{ color: 'var(--hk-ink-3)', lineHeight: 1.6 }}>
            {nhiDrafts.length === 0
              ? '目前沒有含疾病名稱、且尚未成為正式診斷的健保匯入資料。'
              : '這個篩選條件下目前沒有健保匯入疾病。'}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {visibleNhiDrafts.map((draft) => (
              <article key={draft.id} className="hk-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 850, color: 'var(--hk-ink)' }}>{draft.diagnosis}</div>
                    <div style={{ color: 'var(--hk-ink-3)', fontSize: 12, marginTop: 5 }}>
                      {[draft.member_name || '本人', dateText(draft.date), draft.facility, draft.section_label].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <span className="hk-badge hk-b-blue">{draft.source_label}</span>
                    <span className="hk-badge hk-b-cmo">{draft.organization_label}</span>
                    <span className="hk-badge hk-b-amber">{draft.confirmation_label}</span>
                    <span className="hk-badge hk-b-gray">{draft.review_status_label}</span>
                  </div>
                </div>
                <div style={{ marginTop: 14, borderTop: '1px solid var(--hk-line)', paddingTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className="patient-status-control" style={{ fontSize: 13, fontWeight: 800, color: 'var(--hk-ink-2)' }}>
                    我的追蹤狀況
                    <select
                      aria-label={`更新${draft.diagnosis}的個人追蹤狀況（立即生效）`}
                      value={draft.patient_tracking_state ?? ''}
                      disabled={busy === `nhi-draft-${draft.id}`}
                      onChange={(event) => { if (event.target.value) void updateNhiDraftTracking(draft, event.target.value); }}
                      style={{ ...statusSelectStyle, marginLeft: 8 }}
                    >
                      <option value="" disabled>選擇目前狀況…</option>
                      {PATIENT_PROBLEM_TRACKING_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <span className="hk-badge hk-b-green">立即生效</span>
                  <Link className="hk-btn hk-btn-ghost hk-btn-sm" href={memberHref('/dashboard/nhi', activeMember)}>
                    查看健保存摺來源
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {activeProblems.length > 0 && (
        <div style={{ marginTop: 14, color: 'var(--hk-ink-3)', fontSize: 12 }}>
          目前有 {activeProblems.length} 筆醫療團隊診斷仍在追蹤；你的個人標記不會直接覆蓋正式診斷。
        </div>
      )}

      <AccessibleDialog
        open={Boolean(nhiCandidateToConfirm)}
        onClose={() => {
          if (nhiCandidateToConfirm && busy === `nhi-candidate-${nhiCandidateToConfirm.fact_id}`) return;
          setNhiCandidateToConfirm(null);
          setNhiCandidateStatus('');
        }}
        title="確認目前病況狀態"
        description="健保存摺是過去就醫的資料來源，不代表現在仍有這個病況。請依你目前知道的情況選擇。"
        initialFocusRef={nhiCandidateStatusRef}
        returnFocusRef={nhiCandidateReturnFocusRef}
      >
        {nhiCandidateToConfirm && (
          <form onSubmit={(event) => {
            event.preventDefault();
            void saveNhiCondition(nhiCandidateToConfirm, nhiCandidateStatus);
          }}>
            <div className="hk-field">
              <label htmlFor="nhi-condition-current-status" className="hk-label">這個病況目前的狀態</label>
              <select
                ref={nhiCandidateStatusRef}
                id="nhi-condition-current-status"
                className="hk-input"
                value={nhiCandidateStatus}
                onChange={(event) => setNhiCandidateStatus(event.target.value)}
                required
              >
                <option value="">請選擇目前狀態</option>
                {PATIENT_CONDITION_STATUS_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="hk-card" role="note" style={{ marginTop: 14 }}>
              <strong>{nhiCandidateToConfirm.title}</strong>
              {nhiCandidateToConfirm.summary && <p>{nhiCandidateToConfirm.summary}</p>}
              <p style={{ marginBottom: 0 }}>加入後會標示為「健保匯入、由我確認目前狀態」，不會被標成醫療團隊已確認。</p>
            </div>
            <div className="hk-dialog-actions">
              <button
                type="button"
                className="hk-btn hk-btn-ghost"
                disabled={busy === `nhi-candidate-${nhiCandidateToConfirm.fact_id}`}
                onClick={() => {
                  setNhiCandidateToConfirm(null);
                  setNhiCandidateStatus('');
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className="hk-btn hk-btn-primary"
                disabled={!nhiCandidateStatus || busy === `nhi-candidate-${nhiCandidateToConfirm.fact_id}`}
              >
                {busy === `nhi-candidate-${nhiCandidateToConfirm.fact_id}` ? '加入中…' : '確認並加入'}
              </button>
            </div>
          </form>
        )}
      </AccessibleDialog>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--hk-line)',
  background: '#fff',
  font: 'inherit',
};

const statusSelectStyle: React.CSSProperties = {
  minHeight: 44,
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid #bfe0cd',
  background: '#f5fbf7',
  color: '#256d46',
  fontSize: 12,
  fontWeight: 750,
};

const touchButtonStyle: React.CSSProperties = {
  minHeight: 44,
};

const dialogLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
};

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  background: 'rgba(19, 43, 58, 0.48)',
};

const modalPanelStyle: React.CSSProperties = {
  width: 'min(720px, 100%)',
  maxHeight: 'min(90vh, 760px)',
  overflowY: 'auto',
  border: '1px solid #cfe3e8',
};
