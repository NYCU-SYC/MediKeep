'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { memberDisplayName, memberHref, memberQueryParams, normalizeMemberName } from '@/lib/members';
import { useActiveMember } from '../member-context';
import {
  AsyncState,
  ConfirmationBadge,
  PageHeader,
  ReadOnlyNotice,
  SourceBadge,
  TaskLinkCard,
} from '../_components/Shared';

type ConditionOut = {
  id: number | string;
  display_name: string;
  status?: string | null;
  source?: string | null;
  is_patient_managed?: boolean;
  is_verified?: boolean;
  is_published?: boolean;
};

type MedicationOut = {
  id: number | string;
  drug_name: string;
  dose?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  source?: string | null;
  is_active?: boolean;
  is_patient_managed?: boolean;
  is_verified?: boolean;
  is_published?: boolean;
  patient_reported_usage_status?: string | null;
};

type RecordOut = {
  id: string;
  record_type: string;
  value1?: string | null;
  value2?: string | null;
  unit?: string | null;
  recorded_at?: string | null;
};

type CmoRecommendation = {
  id: string;
  title?: string | null;
  health_summary?: string | null;
  recommendation?: string | null;
  next_step?: string | null;
  follow_up_date?: string | null;
  published_at?: string | null;
};

type HealthSnapshot = {
  conditions: ConditionOut[];
  medications: MedicationOut[];
  records: RecordOut[];
};

type ResourceKey = keyof HealthSnapshot;
type HealthResourceKey = ResourceKey | 'recommendation';

const EMPTY_SNAPSHOT: HealthSnapshot = { conditions: [], medications: [], records: [] };

const RECORD_LABELS: Record<string, string> = {
  blood_pressure: '血壓',
  heart_rate: '心跳',
  glucose: '血糖',
  weight: '體重',
  bmi: 'BMI',
  body_fat: '體脂率',
  sleep: '睡眠',
  steps: '步數',
};

function sourceLabel(source?: string | null): string {
  const normalized = (source || '').trim().toLowerCase();
  if (['nhi', 'nhi_import', 'imported', 'health_bank'].includes(normalized)) return '健保匯入';
  if (['document', 'medical_record', 'ocr', 'document_extraction'].includes(normalized)) return '文件整理';
  if (['cmo', 'cmo_created', 'cmo_entry', 'medical_team', 'official'].includes(normalized)) return '醫療團隊整理';
  if (['patient_created', 'patient_reported', 'manual', 'self'].includes(normalized)) return '我新增';
  return normalized ? '其他健康資料' : '尚未標示';
}

function isConfirmed(item: { is_verified?: boolean; is_published?: boolean }): boolean {
  return Boolean(item.is_verified || item.is_published);
}

function isSelfManagedCondition(item: ConditionOut): boolean {
  if (item.is_patient_managed) return true;
  const source = (item.source || '').toLowerCase();
  return !isConfirmed(item) && ['patient_created', 'patient_reported', 'manual', 'self'].includes(source);
}

function isSelfManagedMedication(item: MedicationOut): boolean {
  if (item.is_patient_managed || item.patient_reported_usage_status === 'taking') return true;
  const source = (item.source || '').toLowerCase();
  return !isConfirmed(item) && ['patient_created', 'patient_reported', 'manual', 'self'].includes(source);
}

function formatRecord(record?: RecordOut): string {
  if (!record) return '尚未新增量測';
  const label = RECORD_LABELS[record.record_type] || '健康量測';
  const value = record.value2 ? `${record.value1 || '—'}/${record.value2}` : record.value1 || '—';
  const date = record.recorded_at ? new Date(record.recorded_at) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
    : '日期未記錄';
  return `${label} ${value}${record.unit ? ` ${record.unit}` : ''} · ${dateLabel}`;
}

function patientSafeText(value?: string | null, fallback = '醫療團隊尚未補充內容'): string {
  const text = (value || '')
    .replace(/\b[A-Z]\d{2}(?:\.\d+)?\b/gi, '')
    .replace(/\bCMO\b/gi, '醫療團隊')
    .replace(/\bOwner\b/gi, '家庭管理者')
    .replace(/\bSelf\b/gi, '本人')
    .replace(/\braw\b/gi, '原始資料')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

function DataItem({
  title,
  detail,
  source,
  confirmed,
}: {
  title: string;
  detail?: string;
  source?: string | null;
  confirmed: boolean;
}) {
  return (
    <li style={{ listStyle: 'none', padding: '12px 0', borderBottom: '1px solid var(--hk-line)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ display: 'block', color: 'var(--hk-ink)', fontSize: 15, lineHeight: 1.45 }}>{title}</strong>
          {detail && <span style={{ display: 'block', marginTop: 4, color: 'var(--hk-ink-2)', fontSize: 13 }}>{detail}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <SourceBadge source={sourceLabel(source)} />
          <ConfirmationBadge confirmed={confirmed} />
        </div>
      </div>
    </li>
  );
}

function EmptyList({ children }: { children: React.ReactNode }) {
  return (
    <div className="hk-async-state hk-async-empty" role="status" style={{ marginTop: 10 }}>
      <strong>{children}</strong>
    </div>
  );
}

export default function HealthLandingPage() {
  const searchParams = useSearchParams();
  const requestedMember = searchParams.get('member');
  const { activeMember, setActiveMember, members } = useActiveMember();
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(EMPTY_SNAPSHOT);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const loadedScopeRef = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [resourceErrors, setResourceErrors] = useState<HealthResourceKey[]>([]);
  const [recommendation, setRecommendation] = useState<CmoRecommendation | null>(null);

  useEffect(() => {
    if (requestedMember !== null) setActiveMember(normalizeMemberName(requestedMember));
  }, [requestedMember, setActiveMember]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const preservePrevious = loadedScopeRef.current === activeMember;
    setLoading(true);
    const params = memberQueryParams(activeMember);
    const results = await Promise.allSettled([
      api.get('/api/conditions', params),
      api.get('/api/medications', params),
      api.get('/api/records', { ...(params || {}), limit: '10' }),
      api.get('/api/patients/me/recommendations/latest', params),
    ]);
    const keys: ResourceKey[] = ['conditions', 'medications', 'records'];
    const failed: HealthResourceKey[] = [];
    if (sequence !== loadSequence.current) return;
    setSnapshot((previous) => {
      const next = preservePrevious ? { ...previous } : { ...EMPTY_SNAPSHOT };
      results.slice(0, 3).forEach((result, index) => {
        const key = keys[index];
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          next[key] = result.value as never;
        } else {
          failed.push(key);
        }
      });
      return next;
    });
    if (results[3].status === 'fulfilled') {
      const value = results[3].value;
      setRecommendation(value && typeof value === 'object' && !Array.isArray(value) ? value as CmoRecommendation : null);
    } else {
      failed.push('recommendation');
      if (!preservePrevious) setRecommendation(null);
    }
    loadedScopeRef.current = activeMember;
    setLoadedScope(activeMember);
    setResourceErrors(failed);
    setLoading(false);
  }, [activeMember]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleSnapshot = loadedScope === activeMember ? snapshot : EMPTY_SNAPSHOT;
  const visibleErrors = loadedScope === activeMember ? resourceErrors : [];
  const scopeIsLoading = loading || loadedScope !== activeMember;
  const selfManagedConditions = useMemo(
    () => visibleSnapshot.conditions.filter(isSelfManagedCondition).slice(0, 4),
    [visibleSnapshot.conditions],
  );
  const selfManagedMedications = useMemo(
    () => visibleSnapshot.medications.filter(isSelfManagedMedication).slice(0, 4),
    [visibleSnapshot.medications],
  );
  const confirmedConditions = useMemo(
    () => visibleSnapshot.conditions.filter(isConfirmed).slice(0, 4),
    [visibleSnapshot.conditions],
  );
  const confirmedMedications = useMemo(
    () => visibleSnapshot.medications.filter(isConfirmed).slice(0, 4),
    [visibleSnapshot.medications],
  );
  const latestRecord = useMemo(
    () => [...visibleSnapshot.records].sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''))[0],
    [visibleSnapshot.records],
  );
  const scopeLabel = memberDisplayName(activeMember, members.length > 1 ? '全家' : '本人');
  const visibleRecommendation = loadedScope === activeMember ? recommendation : null;
  const nothingLoaded = visibleSnapshot.conditions.length === 0 && visibleSnapshot.medications.length === 0 && visibleSnapshot.records.length === 0 && !visibleRecommendation;
  const allFailed = visibleErrors.length === 4 && nothingLoaded;

  return (
    <div className="page-wrap">
      <div className="hk-health-wrap">
        <PageHeader
          eyebrow="健康"
          title="健康"
          description={`${scopeLabel}目前管理的病況、用藥與醫療團隊已確認內容，都集中在這裡。資料來源與確認狀態會分開顯示。`}
          actions={(
            <>
              <Link href={memberHref('/dashboard/conditions', activeMember)} className="hk-btn hk-btn-primary hk-btn-sm">管理病況</Link>
              <Link href={memberHref('/dashboard/medications', activeMember)} className="hk-btn hk-btn-ghost hk-btn-sm">管理用藥</Link>
            </>
          )}
        />

        {scopeIsLoading && nothingLoaded ? <AsyncState state="loading" title="正在整理健康資料…" /> : allFailed ? (
          <AsyncState
            state="error"
            title="暫時無法載入健康資料"
            description="這不代表目前沒有資料；既有內容仍保留在系統中。"
            onRetry={() => void load()}
          />
        ) : (
          <div className="hk-landing-stack">
            {visibleErrors.length > 0 && (
              <AsyncState
                state="partial"
                title="部分健康資料尚未更新"
                description="畫面保留已成功載入的內容；重新載入只會再次取得失敗的資料。"
                onRetry={() => void load()}
              />
            )}

            <section className="hk-card" aria-labelledby="medical-team-summary-title">
              <div className="hk-section-heading">
                <div>
                  <h2 id="medical-team-summary-title">醫療團隊最新整理</h2>
                  <p>這裡呈現最近一次已發布的白話摘要與下一步；不會把資料來源誤當成醫療確認。</p>
                </div>
                {visibleRecommendation && <><SourceBadge source="醫療團隊整理" /><ConfirmationBadge confirmed /></>}
              </div>
              {visibleErrors.includes('recommendation') && !visibleRecommendation ? (
                <AsyncState state="error" title="醫療團隊摘要暫時無法載入" description="這不代表目前沒有摘要；請重新載入確認。" onRetry={() => void load()} />
              ) : visibleRecommendation ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <strong style={{ color: 'var(--hk-ink)', fontSize: 17 }}>{patientSafeText(visibleRecommendation.title, '最近一次健康整理')}</strong>
                    {visibleRecommendation.published_at && <span style={{ display: 'block', marginTop: 4, color: 'var(--hk-ink-3)', fontSize: 12 }}>整理時間：{new Date(visibleRecommendation.published_at).toLocaleString('zh-TW')}</span>}
                  </div>
                  <p style={{ margin: 0, color: 'var(--hk-ink-2)', lineHeight: 1.7 }}>{patientSafeText(visibleRecommendation.health_summary)}</p>
                  {visibleRecommendation.recommendation && <div style={{ borderLeft: '3px solid var(--hk-teal)', paddingLeft: 12, color: 'var(--hk-ink)', lineHeight: 1.7 }}><strong>建議留意：</strong>{patientSafeText(visibleRecommendation.recommendation)}</div>}
                  {visibleRecommendation.next_step && <div style={{ background: 'var(--hk-bg-soft)', borderRadius: 10, padding: 12, color: 'var(--hk-ink)', lineHeight: 1.7 }}><strong>下一步：</strong>{patientSafeText(visibleRecommendation.next_step)}{visibleRecommendation.follow_up_date ? ` · 建議日期 ${visibleRecommendation.follow_up_date}` : ''}</div>}
                </div>
              ) : <EmptyList>目前沒有醫療團隊已發布的摘要</EmptyList>}
            </section>

            <section className="hk-card" aria-labelledby="managed-health-title">
              <div className="hk-section-heading">
                <div>
                  <h2 id="managed-health-title">我目前管理的內容</h2>
                  <p>先顯示你主動管理或回報的內容；健保候選不會混入這個清單。</p>
                </div>
              </div>
              <div className="hk-landing-grid">
                <div>
                  <div className="hk-section-heading">
                    <h3 style={{ margin: 0, fontSize: 16, color: 'var(--hk-ink)' }}>病況</h3>
                    <Link href={memberHref('/dashboard/conditions', activeMember)} className="hk-btn hk-btn-ghost hk-btn-sm">查看全部</Link>
                  </div>
                  {visibleErrors.includes('conditions') && visibleSnapshot.conditions.length === 0 ? (
                    <AsyncState state="error" title="病況暫時無法載入" onRetry={() => void load()} />
                  ) : selfManagedConditions.length === 0 ? <EmptyList>目前沒有你管理的病況</EmptyList> : (
                    <ul style={{ margin: 0, padding: 0 }}>
                      {selfManagedConditions.map((condition) => (
                        <DataItem
                          key={condition.id}
                          title={condition.display_name || '未命名病況'}
                          detail="目前由你管理"
                          source={condition.source}
                          confirmed={isConfirmed(condition)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="hk-section-heading">
                    <h3 style={{ margin: 0, fontSize: 16, color: 'var(--hk-ink)' }}>用藥</h3>
                    <Link href={memberHref('/dashboard/medications', activeMember)} className="hk-btn hk-btn-ghost hk-btn-sm">查看全部</Link>
                  </div>
                  {visibleErrors.includes('medications') && visibleSnapshot.medications.length === 0 ? (
                    <AsyncState state="error" title="用藥暫時無法載入" onRetry={() => void load()} />
                  ) : selfManagedMedications.length === 0 ? <EmptyList>目前沒有你確認正在管理的用藥</EmptyList> : (
                    <ul style={{ margin: 0, padding: 0 }}>
                      {selfManagedMedications.map((medication) => (
                        <DataItem
                          key={medication.id}
                          title={medication.drug_name || '未命名藥物'}
                          detail={[medication.dose || medication.dosage, medication.frequency].filter(Boolean).join(' · ') || '用法尚未補充'}
                          source={medication.source}
                          confirmed={isConfirmed(medication)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            <section className="hk-card" aria-labelledby="confirmed-health-title">
              <div className="hk-section-heading">
                <div>
                  <h2 id="confirmed-health-title">醫療團隊已確認</h2>
                  <p>只有帶有確認標記的內容會出現在這一區；來源仍另外標示。</p>
                </div>
                <ConfirmationBadge confirmed />
              </div>
              {confirmedConditions.length === 0 && confirmedMedications.length === 0 ? (
                <EmptyList>目前沒有醫療團隊已確認的病況或用藥</EmptyList>
              ) : (
                <div className="hk-landing-grid">
                  <ul style={{ margin: 0, padding: 0 }}>
                    {confirmedConditions.map((condition) => (
                      <DataItem
                        key={`condition-${condition.id}`}
                        title={condition.display_name || '未命名病況'}
                        detail="病況"
                        source={condition.source}
                        confirmed
                      />
                    ))}
                  </ul>
                  <ul style={{ margin: 0, padding: 0 }}>
                    {confirmedMedications.map((medication) => (
                      <DataItem
                        key={`medication-${medication.id}`}
                        title={medication.drug_name || '未命名藥物'}
                        detail={[medication.dose || medication.dosage, medication.frequency].filter(Boolean).join(' · ') || '用藥'}
                        source={medication.source}
                        confirmed
                      />
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="hk-card" aria-labelledby="health-next-title">
              <div className="hk-section-heading">
                <div>
                  <h2 id="health-next-title">趨勢與急診準備</h2>
                  <p>查看最新量測、長期變化，以及急診現場需要的資料完整度。</p>
                </div>
              </div>
              <div className="hk-landing-grid">
                <TaskLinkCard
                  title="健康趨勢"
                  description="查看量測隨時間的變化；畫面不會替你下診斷結論。"
                  href={memberHref('/dashboard/trends', activeMember)}
                  icon="trend"
                  badge={<SourceBadge source="本人量測紀錄" />}
                  meta={formatRecord(latestRecord)}
                />
                <TaskLinkCard
                  title="急診資訊"
                  description="檢查立即注意事項、目前用藥、重要病史與最新量測，再管理唯讀分享。"
                  href={memberHref('/dashboard/emergency', activeMember)}
                  icon="emergency"
                  badge={<SourceBadge source="急診資料準備狀態" />}
                />
                <TaskLinkCard
                  title="健康時間軸"
                  description="依一次就醫或健康事件查看日期、院所、重點與資料來源。"
                  href={memberHref('/dashboard/timeline', activeMember)}
                  icon="activity"
                  badge={<SourceBadge source="健康事件" />}
                />
              </div>
            </section>

            <ReadOnlyNotice title="來源與確認是兩件事">
              「來源」表示資料從哪裡來；「醫療團隊已確認」表示內容已經過醫療團隊確認。健保匯入或文件整理不會自動等於已確認。
            </ReadOnlyNotice>
          </div>
        )}
      </div>
    </div>
  );
}
