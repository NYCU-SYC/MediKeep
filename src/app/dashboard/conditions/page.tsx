'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useSync } from '@/lib/sync';
import { memberHref, memberQueryParams, memberDisplayName } from '@/lib/members';
import { useActiveMember } from '../member-context';

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
  problem_kind?: string | null;
  treatment_plan?: string | null;
  follow_up_cadence?: string | null;
  follow_up_recommendation?: string | null;
  slots?: ProblemSlotMap;
  timeline?: ProblemTimelineItem[];
  published_at?: string | null;
  last_active_at?: string | null;
};

const SLOT_LABELS: Record<string, string> = {
  condition: '診斷',
  medication: '用藥',
  health_record: '量測',
  document: '文件',
  dicom_study: '影像',
  nhi_draft: 'NHI',
  follow_up: '追蹤',
  missing_data_request: '補資料',
};

function slotCount(problem: ProblemOut) {
  return Object.values(problem.slots ?? {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

function statusLabel(status?: string | null) {
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

function DiseaseOverviewPage() {
  const { activeMember, members } = useActiveMember();
  const sync = useSync();
  const problemSyncVersion = Math.max(
    sync.viewVersions.patient_problem_detail ?? 0,
    sync.viewVersions.patient_dashboard ?? 0,
  );
  const [problems, setProblems] = useState<ProblemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await api.get('/api/patients/me/problems', memberQueryParams(activeMember));
      setProblems(Array.isArray(data) ? data as ProblemOut[] : []);
      setError('');
    } catch {
      setError('疾病總覽讀取失敗，請稍後再試。');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeMember]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (problemSyncVersion > 0) void load(true);
  }, [load, problemSyncVersion]);

  const activeProblems = useMemo(() => problems.filter((p) => p.status !== 'resolved'), [problems]);
  const resolvedProblems = useMemo(() => problems.filter((p) => p.status === 'resolved'), [problems]);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家總覽' : '本人');

  return (
    <div className="page-wrap" style={{ maxWidth: 'var(--hk-page-wide)', margin: '0 auto', width: '100%' }}>
      <div className="hk-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="hk-badge hk-b-cmo" style={{ marginBottom: 8 }}>{scopeLabel}</div>
            <h1 style={{ margin: 0, fontSize: 24, color: 'var(--hk-ink)' }}>疾病總覽</h1>
            <p style={{ margin: '8px 0 0', color: 'var(--hk-ink-2)', fontSize: 14 }}>
              這裡只顯示 CMO 已發布的 Problems，來源與時間線由 Problem 關聯資料整理。
            </p>
          </div>
          <Link className="hk-btn hk-btn-ghost hk-btn-sm" href={memberHref('/dashboard/health-summary', activeMember)}>查看健康摘要</Link>
        </div>
      </div>

      {error && <div className="hk-card hk-b-red" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <div className="hk-card" style={{ color: 'var(--hk-ink-3)' }}>讀取中...</div>
      ) : problems.length === 0 ? (
        <div className="hk-card" style={{ color: 'var(--hk-ink-3)' }}>目前沒有已發布的疾病總覽。</div>
      ) : (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, marginBottom: 16 }}>
            <div className="hk-card"><div className="hk-ctitle">追蹤中</div><strong style={{ fontSize: 28 }}>{activeProblems.length}</strong></div>
            <div className="hk-card"><div className="hk-ctitle">已處理</div><strong style={{ fontSize: 28 }}>{resolvedProblems.length}</strong></div>
            <div className="hk-card"><div className="hk-ctitle">已連結來源</div><strong style={{ fontSize: 28 }}>{problems.reduce((sum, p) => sum + slotCount(p), 0)}</strong></div>
          </section>

          <section style={{ display: 'grid', gap: 12 }}>
            {problems.map((problem) => {
              const slots = problem.slots ?? {};
              const slotEntries = Object.entries(slots).filter(([, rows]) => Array.isArray(rows) && rows.length > 0);
              return (
                <article key={problem.id} className="hk-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 850, color: 'var(--hk-ink)' }}>{problem.display_layman || problem.display_name}</div>
                      <div style={{ marginTop: 5, color: 'var(--hk-ink-2)', fontSize: 13 }}>{problem.display_name}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <span className="hk-badge hk-b-blue">{statusLabel(problem.status)}</span>
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
                    <div style={{ marginTop: 12, color: 'var(--hk-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
                      {[problem.treatment_plan, problem.follow_up_cadence, problem.follow_up_recommendation].filter(Boolean).join(' · ')}
                    </div>
                  )}

                  {slotEntries.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      {slotEntries.map(([type, rows]) => (
                        <span key={type} className="hk-badge hk-b-green">{SLOT_LABELS[type] ?? type} {rows.length}</span>
                      ))}
                    </div>
                  )}

                  {problem.timeline && problem.timeline.length > 0 && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--hk-line)', paddingTop: 10 }}>
                      {problem.timeline.slice(0, 4).map((item) => (
                        <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '86px minmax(0,1fr)', gap: 10, fontSize: 13, padding: '6px 0', color: 'var(--hk-ink-2)' }}>
                          <span>{dateText(item.date) || '日期未定'}</span>
                          <span><strong style={{ color: 'var(--hk-ink)' }}>{SLOT_LABELS[item.type] ?? item.type}</strong> · {item.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

export default DiseaseOverviewPage;
