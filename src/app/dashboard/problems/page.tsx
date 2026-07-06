'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';
import { useActiveMember } from '../member-context';

type ProblemLink = {
  id: number;
  resource_type: string;
  resource_id: string;
  resource_label?: string | null;
  resource_date?: string | null;
};

type Problem = {
  id: number;
  display_name: string;
  display_layman?: string | null;
  status: 'underlying' | 'following' | 'resolved' | string;
  tier: number;
  certainty?: string | null;
  course?: string | null;
  followup_note?: string | null;
  tracking_note?: string | null;
  published_at?: string | null;
  links?: ProblemLink[];
  timeline?: ProblemLink[];
};

type Medication = {
  id: number;
  drug_name: string;
  brand_name?: string | null;
  generic_name_en?: string | null;
  dose?: string | null;
  frequency?: string | null;
  route?: string | null;
};

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  underlying: { label: '觀察中', tone: '#a16207' },
  following: { label: '追蹤中', tone: '#1d4ed8' },
  resolved: { label: '已解決', tone: '#047857' },
};

function fmtDate(value?: string | null) {
  if (!value) return '日期未記錄';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/T.*$/, '');
  return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function problemName(problem: Problem) {
  return problem.display_layman || problem.display_name || '未命名 Problem';
}

function resourceLabel(link: ProblemLink) {
  const typeLabel: Record<string, string> = {
    draft: '健保存摺',
    medication: '用藥',
    condition: '病史',
    health_record: '數值',
    document: '文件',
    dicom: '影像',
  };
  return `${typeLabel[link.resource_type] || link.resource_type} · ${link.resource_label || link.resource_id}`;
}

export default function ProblemsOverviewPage() {
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember } = useActiveMember();
  const requestedMemberParam = searchParams.get('member');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  useEffect(() => {
    let alive = true;
    const params = memberQueryParams(activeMember);
    Promise.allSettled([
      api.get('/api/patients/me/problems', params),
      api.get('/api/medications', params),
    ]).then((results) => {
      if (!alive) return;
      const problemData = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value as Problem[] : [];
      const medData = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value as Medication[] : [];
      setProblems(problemData);
      setMedications(medData);
      setSelectedId((current) => current ?? problemData[0]?.id ?? null);
      setLoadError(results.some((result) => result.status === 'rejected'));
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [activeMember]);

  const selected = problems.find((problem) => problem.id === selectedId) ?? problems[0] ?? null;
  const grouped = useMemo(() => {
    return {
      following: problems.filter((problem) => problem.status === 'following'),
      underlying: problems.filter((problem) => problem.status === 'underlying'),
      resolved: problems.filter((problem) => problem.status === 'resolved'),
    };
  }, [problems]);

  const relatedMedications = useMemo(() => {
    if (!selected) return [];
    const linkedMedIds = new Set((selected.links || []).filter((link) => link.resource_type === 'medication').map((link) => Number(link.resource_id)));
    return medications.filter((med) => linkedMedIds.has(med.id));
  }, [medications, selected]);

  if (loading) {
    return <div className="page-wrap"><div style={{ color: '#64748b' }}>正在載入疾病總覽...</div></div>;
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 1160, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: '#0f172a' }}>疾病總覽</h1>
        <p style={{ margin: '6px 0 0', color: '#64748b', lineHeight: 1.6 }}>
          依 CMO 發布的 Problem 容器整理疾病、來源資料、用藥與自動時間軸。
        </p>
        {loadError && <div style={{ marginTop: 10, color: '#b45309', fontSize: 13 }}>部分資料載入失敗，請稍後重新整理。</div>}
      </header>

      {problems.length === 0 ? (
        <section style={cardStyle}>
          <h2 style={sectionTitle}>尚無已發布 Problem</h2>
          <p style={{ color: '#64748b', lineHeight: 1.7 }}>醫療團隊發布疾病整理後，會顯示在這裡。</p>
          <Link href={memberHref('/dashboard/health-profile', activeMember)} className="hk-btn hk-btn-ghost hk-btn-sm">查看健康檔案</Link>
        </section>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16, alignItems: 'start' }}>
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(['following', 'underlying', 'resolved'] as const).map((status) => (
              <section key={status} style={cardStyle}>
                <h2 style={sectionTitle}>{STATUS_LABEL[status].label}</h2>
                {grouped[status].length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>目前沒有此狀態的 Problem。</div>
                ) : grouped[status].map((problem) => {
                  const active = selected?.id === problem.id;
                  return (
                    <button key={problem.id} onClick={() => setSelectedId(problem.id)} style={{
                      width: '100%', textAlign: 'left', border: `1px solid ${active ? '#99f6e4' : '#e2e8f0'}`,
                      background: active ? '#f0fdfa' : '#fff', borderRadius: 10, padding: 11, marginTop: 8, cursor: 'pointer',
                    }}>
                      <div style={{ fontWeight: 850, color: '#0f172a', lineHeight: 1.35 }}>{problemName(problem)}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                        Tier {problem.tier} · {problem.certainty === 'suspected' ? '疑似' : '確認'} · {problem.course || '病程未記錄'}
                      </div>
                    </button>
                  );
                })}
              </section>
            ))}
          </aside>

          {selected && (
            <main style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>{problemName(selected)}</h2>
                    <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>
                      {STATUS_LABEL[selected.status]?.label || selected.status} · Tier {selected.tier} · 發布 {fmtDate(selected.published_at)}
                    </div>
                  </div>
                  <Link href={memberHref('/dashboard/health-profile', activeMember)} className="hk-btn hk-btn-ghost hk-btn-sm">健康檔案</Link>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 16 }}>
                  <InfoTile label="回診" value={selected.followup_note || '尚未記錄'} />
                  <InfoTile label="追蹤" value={selected.tracking_note || '尚未記錄'} />
                  <InfoTile label="來源數" value={`${selected.links?.length || 0} 筆`} />
                </div>
              </section>

              <section style={cardStyle}>
                <h2 style={sectionTitle}>容器插槽</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <Slot title="用藥" items={relatedMedications.map((med) => [med.brand_name || med.drug_name, [med.generic_name_en, med.dose, med.frequency, med.route].filter(Boolean).join(' · ') || '明細待整理'])} />
                  <Slot title="來源資料" items={(selected.links || []).filter((link) => link.resource_type !== 'medication').map((link) => [resourceLabel(link), fmtDate(link.resource_date)])} />
                </div>
              </section>

              <section style={cardStyle}>
                <h2 style={sectionTitle}>自動時間軸</h2>
                {(selected.timeline || selected.links || []).length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>尚無已關聯來源資料。</div>
                ) : (selected.timeline || selected.links || []).map((link) => (
                  <div key={`${link.resource_type}-${link.resource_id}-${link.id}`} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 12, padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>{fmtDate(link.resource_date)}</div>
                    <div>
                      <div style={{ color: '#0f172a', fontWeight: 800 }}>{resourceLabel(link)}</div>
                      <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>#{link.resource_id}</div>
                    </div>
                  </div>
                ))}
              </section>
            </main>
          )}
        </div>
      )}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 850, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 800, lineHeight: 1.45 }}>{value}</div>
    </div>
  );
}

function Slot({ title, items }: { title: string; items: Array<[string, string]> }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#fff' }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>{title}</div>
      {items.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>尚無資料</div> : items.slice(0, 6).map(([name, detail]) => (
        <div key={`${name}-${detail}`} style={{ padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 800 }}>{name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{detail}</div>
        </div>
      ))}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 16,
  boxShadow: '0 10px 24px rgba(15,23,42,0.04)',
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  color: '#0f172a',
  fontWeight: 900,
};
