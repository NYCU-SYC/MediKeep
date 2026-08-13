'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { memberQueryParams } from '@/lib/members';
import { useActiveMember } from '../member-context';
import { AsyncState, PageHeader, ReadOnlyNotice, TaskLinkCard } from '../_components/Shared';

type TaskKey = 'reminders' | 'followUps' | 'missing';
type Counts = Record<TaskKey, number | null>;
type TaskState = 'loading' | 'ready' | 'partial' | 'error';

const INITIAL_COUNTS: Counts = { reminders: null, followUps: null, missing: null };

function countOpenRows(value: unknown, closed: string[]) {
  if (!Array.isArray(value)) return 0;
  return value.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const item = row as { status?: string | null; is_done?: boolean };
    return !item.is_done && !closed.includes(item.status || '');
  }).length;
}

export default function TasksLandingPage() {
  const { activeMember } = useActiveMember();
  const [counts, setCounts] = useState<Counts>(INITIAL_COUNTS);
  const [state, setState] = useState<TaskState>('loading');
  const snapshotScopeRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const scopeKey = activeMember || '__family__';
    const hasSameScopeSnapshot = snapshotScopeRef.current === scopeKey;
    const requestSequence = ++requestSequenceRef.current;
    if (!hasSameScopeSnapshot) {
      snapshotScopeRef.current = null;
      setCounts(INITIAL_COUNTS);
      setState('loading');
    }
    const params = memberQueryParams(activeMember);
    const results = await Promise.allSettled([
      api.get('/api/patients/me/reminders', params),
      api.get('/api/patients/me/follow-ups', params),
      api.get('/api/patients/me/missing-data-requests', params),
    ]);
    if (requestSequence !== requestSequenceRef.current) return;
    // A failed refresh must not turn the last known count into "尚未取得".
    // Fulfilled empty arrays still correctly replace the count with zero.
    if (results[0].status === 'fulfilled') {
      const value = countOpenRows(results[0].value, ['completed', 'deleted', 'done', 'resolved']);
      setCounts((previous) => ({ ...previous, reminders: value }));
    }
    if (results[1].status === 'fulfilled') {
      const value = countOpenRows(results[1].value, ['completed', 'deleted', 'done', 'resolved', 'closed', 'canceled']);
      setCounts((previous) => ({ ...previous, followUps: value }));
    }
    if (results[2].status === 'fulfilled') {
      const value = countOpenRows(results[2].value, ['resolved', 'deleted', 'canceled', 'completed']);
      setCounts((previous) => ({ ...previous, missing: value }));
    }
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed < results.length) snapshotScopeRef.current = scopeKey;
    setState(failed === 0 ? 'ready' : hasSameScopeSnapshot || failed < results.length ? 'partial' : 'error');
  }, [activeMember]);

  // Fetching the task counts is the external synchronization this effect owns.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const countLabel = (value: number | null) => value == null ? '尚未取得' : value === 0 ? '目前沒有待處理' : `${value} 件待處理`;

  if (state === 'loading' || state === 'error') {
    return (
      <div className="page-wrap">
        <div className="hk-health-wrap">
          <PageHeader eyebrow="待辦" title="待辦" description="把提醒、醫療團隊交辦與補資料集中在同一個入口。" />
          <AsyncState state={state} title={state === 'loading' ? '正在整理待辦…' : undefined} onRetry={state === 'error' ? () => { void load(); } : undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="hk-health-wrap">
        <PageHeader eyebrow="待辦" title="待辦" description="先處理需要你回覆或完成的事項；完成後會回到原本的資料頁確認結果。" />
        {state === 'partial' && <div style={{ marginBottom: 14 }}><AsyncState state="partial" onRetry={() => { void load(); }} /></div>}
        <div className="hk-landing-stack">
          <TaskLinkCard
            href="/dashboard/reminders"
            title="我的提醒"
            description="查看回診、量測、用藥或其他由本人建立的提醒。"
            icon="bell"
            badge={<span className="hk-badge hk-b-blue">{countLabel(counts.reminders)}</span>}
          />
          <TaskLinkCard
            href="/dashboard/reminders"
            title="醫療團隊交辦"
            description="查看醫療團隊建立的追蹤內容與需要回覆的項目。"
            icon="health"
            badge={<span className="hk-badge hk-b-cmo">{countLabel(counts.followUps)}</span>}
          />
          <TaskLinkCard
            href="/dashboard/reminders"
            title="補資料"
            description="查看需要補充的文件或說明，回覆後等待醫療團隊審閱。"
            icon="folder"
            badge={<span className="hk-badge hk-b-amber">{countLabel(counts.missing)}</span>}
          />
          <ReadOnlyNotice>
            待辦數量只統計目前登入身份可讀、且尚未結束的資料；詳細內容與可用動作仍以提醒頁為準。
          </ReadOnlyNotice>
        </div>
      </div>
    </div>
  );
}
