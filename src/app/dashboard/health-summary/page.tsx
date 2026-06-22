'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { api } from '@/lib/api';
import { useSync } from '@/lib/sync';
import { memberDisplayName, memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';

type CmoRecommendation = {
  id: string;
  version: number;
  status: string;
  title: string;
  health_summary: string;
  recommendation: string;
  next_step: string;
  follow_up_date?: string | null;
  published_at?: string | null;
};
type ProblemSummary = {
  total: number;
  active_count: number;
  last_verified_at: string | null;
  top_problems: Array<{
    id: number;
    display_name: string;
    display_layman?: string | null;
    tier: number;
    is_suspected?: boolean;
    verified_by_name?: string | null;
  }>;
};
type FollowUp = {
  id: number;
  reason: string;
  item: string;
  suggested_date?: string | null;
  priority?: string | null;
  status: string;
  needs_more_data?: boolean;
};
type MissingDataRequest = {
  id: string;
  title: string;
  reason: string;
  instructions?: string | null;
  due_date?: string | null;
  priority?: string | null;
  status: string;
  response_text?: string | null;
};
type DocOut = {
  id: string;
  file_name: string;
  doc_type?: string | null;
  status?: string | null;
  processing_status?: string | null;
  processing_status_label?: string | null;
  created_at?: string | null;
  doc_date?: string | null;
};
type RecordOut = {
  id: string;
  record_type: string;
  value1: string | null;
  value2?: string | null;
  unit?: string | null;
  recorded_at: string;
};

const CLOSED_STATUSES = new Set(['done', 'completed', 'resolved', 'closed', 'deleted', 'canceled', 'withdrawn']);
const DOC_STATUS: Record<string, { label: string; cls: string }> = {
  uploaded: { label: '已收到', cls: 'hk-b-blue' },
  queued: { label: '等待處理', cls: 'hk-b-blue' },
  extracting: { label: '整理中', cls: 'hk-b-amber' },
  needs_review: { label: '等待 CMO 審閱', cls: 'hk-b-amber' },
  reviewed: { label: '已審閱', cls: 'hk-b-green' },
  confirmed: { label: '已整理', cls: 'hk-b-green' },
  published: { label: '已發布摘要', cls: 'hk-b-green' },
  failed: { label: '處理失敗', cls: 'hk-b-red' },
  rejected: { label: '需補件', cls: 'hk-b-red' },
};
const RECORD_LABEL: Record<string, string> = {
  blood_pressure: '血壓',
  heart_rate: '心跳',
  glucose: '血糖',
  weight: '體重',
  bmi: 'BMI',
  body_fat: '體脂率',
  sleep: '睡眠',
  steps: '步數',
};

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
}

function patientSafeText(value?: string | null, fallback = '待醫療團隊整理的健康項目'): string {
  const text = (value ?? '').trim();
  const withoutCodes = text
    .replace(/\b[A-Z]\d{2}(?:\.\d+)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = withoutCodes || fallback;
  return safe.length > 90 ? `${safe.slice(0, 88)}...` : safe;
}

function docStatusMeta(doc: DocOut) {
  const status = doc.processing_status || doc.status || 'uploaded';
  return DOC_STATUS[status] ?? DOC_STATUS.uploaded;
}

function formatRecord(record: RecordOut): string {
  const label = RECORD_LABEL[record.record_type] ?? record.record_type;
  const value = record.value2 ? `${record.value1}/${record.value2}` : record.value1;
  return `${label} ${value ?? '-'}${record.unit ? ` ${record.unit}` : ''}`;
}

function TaskRow({
  title,
  desc,
  badge,
  badgeCls = 'hk-b-blue',
  href,
}: {
  title: string;
  desc?: string;
  badge?: string;
  badgeCls?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 0',
        borderBottom: '1px solid var(--hk-line)',
        textDecoration: 'none',
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 9, background: 'var(--hk-teal)', marginTop: 7, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--hk-ink)' }}>{title}</span>
          {badge && <span className={`hk-badge ${badgeCls}`}>{badge}</span>}
        </span>
        {desc && <span style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.55, color: 'var(--hk-ink-2)' }}>{desc}</span>}
      </span>
    </Link>
  );
}

export default function HealthSummaryPage() {
  const searchParams = useSearchParams();
  const sync = useSync();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [recommendation, setRecommendation] = useState<CmoRecommendation | null>(null);
  const [summary, setSummary] = useState<ProblemSummary | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [missingRequests, setMissingRequests] = useState<MissingDataRequest[]>([]);
  const [docs, setDocs] = useState<DocOut[]>([]);
  const [records, setRecords] = useState<RecordOut[]>([]);

  useEffect(() => {
    const requested = searchParams.get('member');
    if (requested !== null) setActiveMember(normalizeMemberName(requested));
  }, [searchParams, setActiveMember]);

  const load = useCallback(async () => {
    const params = memberQueryParams(activeMember);
    const results = await Promise.allSettled([
      api.get('/api/patients/me/recommendations/latest'),
      api.get('/api/patients/me/problems/summary'),
      api.get('/api/patients/me/follow-ups'),
      api.get('/api/patients/me/missing-data-requests'),
      api.get('/api/documents', params),
      api.get('/api/records', { limit: '20', ...(params ?? {}) }),
    ]);
    const at = (i: number): unknown => (results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<unknown>).value : null);
    const arr = (i: number): unknown[] => { const v = at(i); return Array.isArray(v) ? v : []; };
    setRecommendation((at(0) as CmoRecommendation) ?? null);
    setSummary((at(1) as ProblemSummary) ?? null);
    setFollowUps(arr(2) as FollowUp[]);
    setMissingRequests(arr(3) as MissingDataRequest[]);
    setDocs(arr(4) as DocOut[]);
    setRecords(arr(5) as RecordOut[]);
    setLoadError(results.some((r) => r.status === 'rejected'));
    setLoaded(true);
  }, [activeMember]);

  // Data-fetch effect sets state after the async request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, sync.version]);

  const href = (path: string, extra?: Record<string, string | null | undefined>) => memberHref(path, activeMember, extra);
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家總覽' : '本人');

  const activeMissing = useMemo(
    () => missingRequests.filter((request) => !CLOSED_STATUSES.has(request.status)),
    [missingRequests],
  );
  const activeFollowUps = useMemo(
    () => followUps.filter((task) => !CLOSED_STATUSES.has(task.status)).sort((a, b) => (a.suggested_date || '9999').localeCompare(b.suggested_date || '9999')),
    [followUps],
  );
  const recentDocs = docs.slice(0, 4);
  const processingDocs = docs.filter((doc) => !['confirmed', 'published'].includes(doc.processing_status || doc.status || '')).slice(0, 3);
  const recentRecords = records.slice(0, 4);
  const topProblems = (summary?.top_problems ?? []).slice(0, 4);

  const primaryAction = (() => {
    if (activeMissing.length > 0) return { label: '完成 CMO 要求的補資料', href: href('/dashboard/reminders') };
    if (activeFollowUps.length > 0) return { label: '查看追蹤提醒', href: href('/dashboard/reminders') };
    if (processingDocs.length > 0) return { label: '查看資料整理進度', href: href('/dashboard/upload', { tab: 'file' }) };
    return { label: '上傳新的報告', href: href('/dashboard/upload', { tab: 'file' }) };
  })();

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div className="hk-home-wrap">
        {loadError && (
          <div className="hk-card hk-b-amber" style={{ marginBottom: 12, fontSize: 13 }}>
            部分健康摘要讀取失敗，畫面可能不完整。
            <button className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginLeft: 8 }} onClick={() => load()}>重新整理</button>
          </div>
        )}

        <div className="hk-card hk-home-hero" style={{ marginBottom: 14, background: 'linear-gradient(135deg,#ecfeff,#ffffff)', borderColor: '#cffafe' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 760 }}>
              <div className="hk-ctitle" style={{ marginBottom: 8 }}>Health Summary</div>
              <h1 style={{ fontSize: 26, lineHeight: 1.25, margin: 0, color: 'var(--hk-ink)', fontWeight: 900 }}>
                {scopeLabel}的健康摘要
              </h1>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.7, color: 'var(--hk-ink-2)' }}>
                這裡只放 CMO 已整理的重點、你需要做的下一步、補資料任務與最近資料狀態。
              </p>
              {recommendation?.published_at && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--hk-ink-3)' }}>
                  CMO 最新發布：{relativeTime(recommendation.published_at)}
                </p>
              )}
            </div>
            <Link href={primaryAction.href} className="hk-btn hk-btn-primary" style={{ width: 'auto', minWidth: 190 }}>
              {primaryAction.label}
            </Link>
          </div>
        </div>

        <div className="hk-home-grid">
          <main className="hk-home-main">
            <div className="hk-card">
              <div className="hk-ctitle">
                CMO 最新建議
                {recommendation ? <span className="hk-badge hk-b-cmo">已發布</span> : <span className="hk-badge hk-b-blue">等待整理</span>}
              </div>
              {recommendation ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--hk-ink)', lineHeight: 1.4 }}>
                      {patientSafeText(recommendation.title, 'CMO 最新建議')}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--hk-ink-3)', marginTop: 4 }}>
                      Version {recommendation.version}{recommendation.published_at ? ` · ${relativeTime(recommendation.published_at)}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--hk-ink-2)' }}>
                    {patientSafeText(recommendation.health_summary || recommendation.recommendation, 'CMO 已完成一則健康摘要。')}
                  </div>
                  <div style={{ border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#1d4ed8', marginBottom: 4 }}>下一步</div>
                    <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--hk-ink)' }}>
                      {patientSafeText(recommendation.next_step || recommendation.recommendation, '依 CMO 建議完成下一步')}
                    </div>
                    {recommendation.follow_up_date && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#1d4ed8', fontWeight: 800 }}>
                        建議追蹤日：{recommendation.follow_up_date}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--hk-ink-2)' }}>
                  CMO 團隊完成整理後，會在這裡顯示白話摘要與下一步。你可以先上傳新的報告或完成補資料任務。
                </div>
              )}
            </div>

            <div className="hk-card">
              <div className="hk-ctitle">
                目前健康重點
                <Link href={href('/dashboard/health-profile')} style={{ fontSize: 11, color: 'var(--hk-teal)', textDecoration: 'none', fontWeight: 800 }}>詳細資料 →</Link>
              </div>
              {topProblems.length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {topProblems.map((problem) => (
                    <div key={problem.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--hk-line)' }}>
                      <span className={`hk-badge ${problem.tier <= 1 ? 'hk-b-red' : problem.tier === 2 ? 'hk-b-amber' : 'hk-b-blue'}`}>
                        {problem.tier <= 1 ? '優先留意' : problem.tier === 2 ? '持續追蹤' : '健康紀錄'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 850, color: 'var(--hk-ink)' }}>
                          {patientSafeText(problem.display_layman || problem.display_name)}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 12, color: 'var(--hk-ink-3)' }}>
                          {problem.verified_by_name ? `CMO ${problem.verified_by_name} 已確認` : 'CMO 已整理'}
                          {problem.is_suspected ? ' · 仍需補充資料確認' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--hk-ink-2)' }}>
                  目前沒有 CMO 已確認的健康重點。若你有新報告，可以先上傳，整理後會更新在這裡。
                </div>
              )}
            </div>

            <div className="hk-card">
              <div className="hk-ctitle">最近更新狀態</div>
              {recentDocs.length === 0 && recentRecords.length === 0 ? (
                <div style={{ fontSize: 14, color: 'var(--hk-ink-2)' }}>尚未有新的上傳或量測紀錄。</div>
              ) : (
                <>
                  {recentDocs.map((doc) => {
                    const meta = docStatusMeta(doc);
                    return (
                      <TaskRow
                        key={`doc-${doc.id}`}
                        title={patientSafeText(doc.file_name, '上傳文件')}
                        desc={(doc.doc_date || doc.created_at) ? `資料日期：${doc.doc_date || new Date(doc.created_at ?? '').toLocaleDateString('zh-TW')}` : '文件庫資料'}
                        badge={doc.processing_status_label || meta.label}
                        badgeCls={meta.cls}
                        href={href('/dashboard/documents')}
                      />
                    );
                  })}
                  {recentRecords.map((record) => (
                    <TaskRow
                      key={`record-${record.id}`}
                      title={formatRecord(record)}
                      desc={record.recorded_at ? `自我紀錄 · ${relativeTime(record.recorded_at)}` : '自我紀錄'}
                      badge="已記錄"
                      badgeCls="hk-b-blue"
                      href={href('/dashboard/history')}
                    />
                  ))}
                </>
              )}
            </div>
          </main>

          <aside className="hk-home-side">
            <div className="hk-card">
              <div className="hk-ctitle">
                需要補資料
                <span className={`hk-badge ${activeMissing.length ? 'hk-b-amber' : 'hk-b-green'}`}>
                  {activeMissing.length ? `${activeMissing.length} 件` : '沒有待辦'}
                </span>
              </div>
              {activeMissing.length > 0 ? activeMissing.slice(0, 3).map((request) => (
                <TaskRow
                  key={request.id}
                  title={patientSafeText(request.title, 'CMO 要求的資料')}
                  desc={patientSafeText(request.instructions || request.reason, '請依 CMO 說明補充資料')}
                  badge={request.status === 'needs_cmo_review' ? '已回覆，待審閱' : request.due_date ? `期限 ${request.due_date}` : '待補'}
                  badgeCls={request.status === 'needs_cmo_review' ? 'hk-b-green' : 'hk-b-amber'}
                  href={href('/dashboard/reminders', { highlight: `missing-${request.id}` })}
                />
              )) : (
                <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>目前沒有 CMO 要求你補的資料。</div>
              )}
              <Link href={href('/dashboard/reminders')} className="hk-btn hk-btn-ghost hk-btn-sm" style={{ marginTop: 10 }}>查看提醒與補資料</Link>
            </div>

            <div className="hk-card">
              <div className="hk-ctitle">
                追蹤提醒
                <span className={`hk-badge ${activeFollowUps.length ? 'hk-b-blue' : 'hk-b-green'}`}>
                  {activeFollowUps.length ? `${activeFollowUps.length} 件` : '沒有待辦'}
                </span>
              </div>
              {activeFollowUps.length > 0 ? activeFollowUps.slice(0, 3).map((task) => (
                <TaskRow
                  key={task.id}
                  title={patientSafeText(task.item || task.reason, 'CMO 追蹤提醒')}
                  desc={patientSafeText(task.reason, '依 CMO 建議持續追蹤')}
                  badge={task.suggested_date ? `追蹤日 ${task.suggested_date}` : '待追蹤'}
                  badgeCls={task.priority === 'high' ? 'hk-b-red' : task.priority === 'medium' ? 'hk-b-amber' : 'hk-b-blue'}
                  href={href('/dashboard/reminders', { highlight: `followup-${task.id}` })}
                />
              )) : (
                <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>目前沒有 CMO 建立的追蹤任務。</div>
              )}
            </div>

            <div className="hk-card">
              <div className="hk-ctitle">
                資料整理
                <span className={`hk-badge ${processingDocs.length ? 'hk-b-amber' : 'hk-b-green'}`}>
                  {processingDocs.length ? `${processingDocs.length} 份整理中` : '穩定'}
                </span>
              </div>
              {processingDocs.length > 0 ? processingDocs.map((doc) => {
                const meta = docStatusMeta(doc);
                return (
                  <TaskRow
                    key={doc.id}
                    title={patientSafeText(doc.file_name, '上傳文件')}
                    desc="完成後才會進入健康摘要或 CMO 建議。"
                    badge={doc.processing_status_label || meta.label}
                    badgeCls={meta.cls}
                    href={href('/dashboard/upload', { tab: 'file' })}
                  />
                );
              }) : (
                <div style={{ fontSize: 13, color: 'var(--hk-ink-3)' }}>沒有正在等待整理的文件。</div>
              )}
              <Link href={href('/dashboard/upload', { tab: 'file' })} className="hk-btn hk-btn-primary" style={{ marginTop: 10 }}>上傳新報告</Link>
            </div>

            {!loaded && (
              <div className="hk-card" style={{ fontSize: 13, color: 'var(--hk-ink-2)' }}>
                正在讀取健康摘要...
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
