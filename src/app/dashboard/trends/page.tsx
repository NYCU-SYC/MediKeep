'use client';

import type { CSSProperties } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CircleCheck,
  Droplets,
  Footprints,
  Gauge,
  HeartPulse,
  Info,
  Lightbulb,
  LoaderCircle,
  Moon,
  Plus,
  RefreshCw,
  Scale,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, invalidateApiGetCache } from '@/lib/api';
import { memberHref, memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';
import { useActiveMember } from '../member-context';
import { analyzeHealthRecords, type HealthInsight, type HealthRecord } from './insights';
import { buildTrendsUrl, normalizeTrendsSection, type TrendsSection } from './routes';

type Point = {
  id: string;
  label: string;
  value: number;
  value2?: number;
};

const METRICS = [
  { key: 'blood_pressure', label: '血壓', unit: 'mmHg', color: '#0f766e', target: 140, targetLabel: '參考值 140', icon: Gauge },
  { key: 'heart_rate', label: '心跳', unit: 'bpm', color: '#0e7490', target: 100, targetLabel: '參考值 100', icon: HeartPulse },
  { key: 'glucose', label: '血糖', unit: 'mg/dL', color: '#0369a1', icon: Droplets },
  { key: 'weight', label: '體重', unit: 'kg', color: '#2563eb', icon: Scale },
  { key: 'steps', label: '步數', unit: '步', color: '#15803d', icon: Footprints },
  { key: 'sleep', label: '睡眠', unit: '小時', color: '#475569', icon: Moon },
  { key: 'bmi', label: 'BMI', unit: '', color: '#0e7490', icon: Activity },
  { key: 'body_fat', label: '體脂率', unit: '%', color: '#0f766e', icon: BarChart3 },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];
type Metric = (typeof METRICS)[number];

const panelStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid var(--gray-200)',
  borderRadius: 16,
  boxShadow: 'var(--shadow-sm)',
};

function isMetricKey(value: string | null): value is MetricKey {
  return METRICS.some((metric) => metric.key === value);
}

function recordsFromResponse(response: unknown): HealthRecord[] {
  if (Array.isArray(response)) return response as HealthRecord[];
  if (response && typeof response === 'object' && Array.isArray((response as { items?: unknown }).items)) {
    return (response as { items: HealthRecord[] }).items;
  }
  throw new Error('Unexpected records response');
}

function pointsForMetric(records: HealthRecord[], metric: MetricKey): Point[] {
  return records
    .filter((record) => record.record_type === metric)
    .slice(0, 30)
    .reverse()
    .map((record) => ({
      id: record.id,
      label: new Date(record.recorded_at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
      value: Number.parseFloat(record.value1 ?? ''),
      value2: record.value2 == null ? undefined : Number.parseFloat(record.value2),
    }))
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({
      ...point,
      value2: Number.isFinite(point.value2) ? point.value2 : undefined,
    }));
}

function LineChart({
  points,
  metric,
  showSecondValue,
}: {
  points: Point[];
  metric: Metric;
  showSecondValue: boolean;
}) {
  if (points.length < 2) return null;
  const width = 560;
  const height = 176;
  const padding = { top: 18, right: 34, bottom: 34, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const values = points.flatMap((point) => [
    point.value,
    ...(showSecondValue && point.value2 !== undefined ? [point.value2] : []),
  ]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || Math.max(Math.abs(maximum) * 0.1, 1);
  const low = Math.floor(minimum - range * 0.2);
  const high = Math.ceil(maximum + range * 0.2);
  const total = high - low || 1;
  const x = (index: number) => padding.left + (index / (points.length - 1)) * innerWidth;
  const y = (value: number) => padding.top + innerHeight - ((value - low) / total) * innerHeight;
  const mainPath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`)
    .join(' ');
  const secondPath = showSecondValue
    ? points
        .filter((point) => point.value2 !== undefined)
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(point.value2 ?? point.value).toFixed(1)}`)
        .join(' ')
    : '';
  const ticks = [low, Math.round((low + high) / 2), high];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${metric.label}最近 ${points.length} 筆紀錄的趨勢圖`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <title>{metric.label}趨勢圖</title>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            y1={y(tick)}
            x2={padding.left + innerWidth}
            y2={y(tick)}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
          <text x={padding.left - 7} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {tick}
          </text>
        </g>
      ))}
      {'target' in metric && metric.target >= low && metric.target <= high && (
        <g>
          <line
            x1={padding.left}
            y1={y(metric.target)}
            x2={padding.left + innerWidth}
            y2={y(metric.target)}
            stroke={metric.color}
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text x={padding.left + innerWidth + 4} y={y(metric.target) + 4} fontSize="10" fill={metric.color}>
            {metric.targetLabel}
          </text>
        </g>
      )}
      {secondPath && (
        <path
          d={secondPath}
          fill="none"
          stroke={metric.color}
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.65"
        />
      )}
      <path
        d={mainPath}
        fill="none"
        stroke={metric.color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={point.id}>
          <circle cx={x(index)} cy={y(point.value)} r="4" fill="#fff" stroke={metric.color} strokeWidth="2" />
          {showSecondValue && point.value2 !== undefined && (
            <circle cx={x(index)} cy={y(point.value2)} r="3" fill="#fff" stroke={metric.color} strokeWidth="1.5" />
          )}
          <text x={x(index)} y={height - 6} textAnchor="middle" fontSize="10" fill="#64748b">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function MetricStats({ points, metric }: { points: Point[]; metric: Metric }) {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
  const latest = values.at(-1) ?? 0;
  const previous = values.at(-2) ?? latest;
  const difference = latest - previous;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const precision = values.some((value) => value % 1 !== 0) ? 1 : 0;
  const changeText = difference === 0
    ? '與上次相同'
    : `較上次${difference > 0 ? '增加' : '減少'} ${Math.abs(difference).toFixed(1)}`;
  const stats = [
    { label: '最新', value: latest.toFixed(precision), detail: changeText },
    { label: '平均', value: average.toFixed(1), detail: `${points.length} 筆平均` },
    { label: '最低', value: Math.min(...values).toFixed(1), detail: metric.unit },
    { label: '最高', value: Math.max(...values).toFixed(1), detail: metric.unit },
  ];

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
        gap: 10,
        margin: '18px 0 0',
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label} style={{ background: '#f8fafc', borderRadius: 12, padding: 12, textAlign: 'center' }}>
          <dt style={{ color: '#64748b', fontSize: 12 }}>{stat.label}</dt>
          <dd style={{ margin: '4px 0 0', color: '#172033', fontSize: 20, fontWeight: 800 }}>{stat.value}</dd>
          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{stat.detail}</div>
        </div>
      ))}
    </dl>
  );
}

const INSIGHT_APPEARANCE: Record<HealthInsight['kind'], {
  label: string;
  color: string;
  background: string;
  icon: typeof Info;
}> = {
  attention: { label: '請留意', color: '#9a3412', background: '#fff7ed', icon: TriangleAlert },
  steady: { label: '目前穩定', color: '#166534', background: '#f0fdf4', icon: CircleCheck },
  information: { label: '數值摘要', color: '#075985', background: '#f0f9ff', icon: Info },
  reminder: { label: '記錄提醒', color: '#334155', background: '#f8fafc', icon: Lightbulb },
};

function MemberChoice({
  members,
  onChoose,
}: {
  members: ReturnType<typeof useActiveMember>['members'];
  onChoose: (member: string) => void;
}) {
  return (
    <section style={{ ...panelStyle, padding: '40px 24px', textAlign: 'center' }} aria-labelledby="choose-member-title">
      <Users size={40} aria-hidden="true" style={{ color: 'var(--primary)', marginBottom: 14 }} />
      <h2 id="choose-member-title" style={{ fontSize: 18, color: '#22313f', margin: 0 }}>
        請選擇要查看的成員
      </h2>
      <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, margin: '8px 0 20px' }}>
        健康趨勢依成員分開顯示，選擇一位成員後即可查看。
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => onChoose(member.name)}
            style={{
              minHeight: 44,
              padding: '9px 18px',
              borderRadius: 22,
              border: '1px solid var(--gray-200)',
              background: '#fff',
              color: '#22313f',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {member.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function EmptyRecords({ member, onAdd }: { member: string; onAdd: () => void }) {
  return (
    <section style={{ ...panelStyle, padding: '48px 24px', textAlign: 'center' }} aria-labelledby="empty-records-title">
      <BarChart3 size={42} aria-hidden="true" style={{ color: 'var(--primary)', marginBottom: 14 }} />
      <h2 id="empty-records-title" style={{ fontSize: 18, color: '#22313f', margin: 0 }}>
        {member}目前還沒有可整理的量測紀錄
      </h2>
      <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 20px' }}>
        新增血壓、血糖、體重或其他量測後，這裡會顯示實際趨勢與數值摘要。
      </p>
      <button
        type="button"
        onClick={onAdd}
        style={{
          minHeight: 44,
          padding: '10px 18px',
          border: 0,
          borderRadius: 10,
          background: 'var(--primary)',
          color: '#fff',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        新增第一筆量測
      </button>
    </section>
  );
}

export default function TrendsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const requestedMember = searchParams.get('member');
  const section = normalizeTrendsSection(searchParams.get('section'));
  const metricKey: MetricKey = isMetricKey(searchParams.get('metric'))
    ? searchParams.get('metric') as MetricKey
    : 'blood_pressure';
  const metric = METRICS.find((item) => item.key === metricKey) ?? METRICS[0];
  const MetricIcon = metric.icon;
  const [data, setData] = useState<{ member: string | null; records: HealthRecord[] }>({ member: null, records: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (requestedMember === null) return;
    setActiveMember(normalizeMemberName(requestedMember));
  }, [requestedMember, setActiveMember]);

  const loadRecords = useCallback(async (force = false) => {
    if (!activeMember) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    if (force) invalidateApiGetCache();
    try {
      const response = await api.get('/api/records', { member: activeMember, limit: '100' });
      setData({ member: activeMember, records: recordsFromResponse(response) });
    } catch (reason) {
      const message = reason instanceof ApiError && reason.message !== 'Request failed'
        ? reason.message
        : '目前無法更新健康紀錄，請稍後再試。';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeMember]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const activeRecords = useMemo(
    () => data.member === activeMember ? data.records : [],
    [activeMember, data],
  );
  const hasSuccessfulData = Boolean(activeMember && data.member === activeMember);
  const initialLoading = loading && !hasSuccessfulData;
  const insights = useMemo(
    () => activeMember ? analyzeHealthRecords(activeRecords, activeMember) : [],
    [activeMember, activeRecords],
  );
  const points = useMemo(() => pointsForMetric(activeRecords, metricKey), [activeRecords, metricKey]);
  const metricCounts = useMemo(() => {
    return activeRecords.reduce<Record<string, number>>((result, record) => {
      result[record.record_type] = (result[record.record_type] ?? 0) + 1;
      return result;
    }, {});
  }, [activeRecords]);

  const switchMember = (member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  const switchSection = (nextSection: TrendsSection) => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(buildTrendsUrl(searchParams.toString(), nextSection, hash), { scroll: false });
  };

  const switchMetric = (nextMetric: MetricKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('metric', nextMetric);
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(`/dashboard/trends?${params.toString()}${hash}`, { scroll: false });
  };

  const addRecord = (type?: MetricKey) => {
    const uploadType = type === 'body_fat' ? 'body_composition' : type;
    router.push(memberHref('/dashboard/upload', activeMember, uploadType ? { type: uploadType } : undefined));
  };

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 'var(--hk-page-wide)', width: '100%', margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => router.push(memberHref('/dashboard/health', activeMember))}
            aria-label="返回健康頁"
            style={{
              width: 44,
              height: 44,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--gray-200)',
              borderRadius: 12,
              background: '#fff',
              color: '#334155',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <div style={{ flex: '1 1 240px' }}>
            <h1 style={{ fontSize: 26, lineHeight: 1.2, color: '#172033', margin: 0 }}>健康趨勢</h1>
            <p style={{ color: '#64748b', fontSize: 14, margin: '5px 0 0' }}>
              {activeMember ? `查看${activeMember}的量測變化與數值整理` : '查看量測變化與白話數值整理'}
            </p>
          </div>
          {activeMember && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={() => void loadRecords(true)}
                disabled={loading}
                style={{
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '9px 13px',
                  borderRadius: 10,
                  border: '1px solid var(--gray-200)',
                  background: '#fff',
                  color: '#334155',
                  fontWeight: 700,
                  cursor: loading ? 'wait' : 'pointer',
                }}
              >
                <RefreshCw size={17} aria-hidden="true" />
                更新資料
              </button>
              <button
                type="button"
                onClick={() => addRecord(metricKey)}
                style={{
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '9px 15px',
                  borderRadius: 10,
                  border: 0,
                  background: 'var(--primary)',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                <Plus size={18} aria-hidden="true" />
                新增量測
              </button>
            </div>
          )}
        </header>

        <div
          role="tablist"
          aria-label="健康趨勢內容"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 6,
            padding: 5,
            marginBottom: 18,
            background: '#eaf4f5',
            borderRadius: 13,
          }}
        >
          {([
            { key: 'trends' as const, label: '趨勢圖表', icon: BarChart3 },
            { key: 'insights' as const, label: '數值整理', icon: Info },
          ]).map((tab) => {
            const TabIcon = tab.icon;
            const selected = tab.key === section;
            return (
              <button
                key={tab.key}
                id={`health-trends-tab-${tab.key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`health-trends-panel-${tab.key}`}
                onClick={() => switchSection(tab.key)}
                style={{
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  border: selected ? '1px solid #c7e2e5' : '1px solid transparent',
                  borderRadius: 9,
                  background: selected ? '#fff' : 'transparent',
                  color: selected ? '#0f766e' : '#475569',
                  boxShadow: selected ? '0 1px 3px rgba(15, 118, 110, 0.1)' : 'none',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                <TabIcon size={18} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 10,
              padding: 14,
              marginBottom: 18,
              border: '1px solid #fdba74',
              borderRadius: 12,
              background: '#fff7ed',
              color: '#7c2d12',
            }}
          >
            <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: '1 1 220px', lineHeight: 1.55 }}>
              <strong>資料更新失敗</strong>
              <div style={{ fontSize: 13 }}>
                {error}{hasSuccessfulData ? ' 目前仍顯示上次成功載入的資料。' : ' 畫面未將錯誤當成沒有資料。'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadRecords(true)}
              style={{
                minHeight: 44,
                padding: '8px 14px',
                border: '1px solid #fdba74',
                borderRadius: 9,
                background: '#fff',
                color: '#9a3412',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              再試一次
            </button>
          </div>
        )}

        {members.length === 0 && (
          <section style={{ ...panelStyle, padding: '44px 24px', textAlign: 'center' }} aria-labelledby="no-members-title">
            <Users size={42} aria-hidden="true" style={{ color: 'var(--primary)', marginBottom: 14 }} />
            <h2 id="no-members-title" style={{ color: '#22313f', fontSize: 18, margin: 0 }}>請先完成家庭設定</h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: '8px 0 18px' }}>完成設定後，就能依成員查看健康趨勢。</p>
            <button
              type="button"
              onClick={() => router.push(memberHref('/dashboard/settings', activeMember))}
              style={{ minHeight: 44, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--primary)', background: '#fff', color: 'var(--primary)', fontWeight: 800, cursor: 'pointer' }}
            >
              前往家庭設定
            </button>
          </section>
        )}

        {members.length > 0 && !activeMember && <MemberChoice members={members} onChoose={switchMember} />}

        {activeMember && initialLoading && (
          <div
            role="status"
            aria-live="polite"
            style={{ ...panelStyle, padding: '52px 24px', textAlign: 'center', color: '#64748b' }}
          >
            <LoaderCircle size={34} aria-hidden="true" style={{ color: 'var(--primary)', marginBottom: 12 }} />
            <div>正在載入{activeMember}的健康紀錄…</div>
          </div>
        )}

        {activeMember && hasSuccessfulData && activeRecords.length === 0 && !error && (
          <EmptyRecords member={activeMember} onAdd={() => addRecord()} />
        )}

        {activeMember && hasSuccessfulData && activeRecords.length > 0 && section === 'trends' && (
          <div
            id="health-trends-panel-trends"
            role="tabpanel"
            aria-labelledby="health-trends-tab-trends"
          >
            <div className="scroll-x-row" role="group" style={{ marginBottom: 16 }} aria-label="選擇量測項目">
              {METRICS.map((item) => {
                const Icon = item.icon;
                const selected = metricKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => switchMetric(item.key)}
                    style={{
                      minHeight: 44,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      flexShrink: 0,
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: `1px solid ${selected ? item.color : 'var(--gray-200)'}`,
                      background: selected ? item.color : '#fff',
                      color: selected ? '#fff' : '#334155',
                      fontWeight: selected ? 800 : 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={17} aria-hidden="true" />
                    {item.label}
                    <span aria-label={`${metricCounts[item.key] ?? 0} 筆`}>({metricCounts[item.key] ?? 0})</span>
                  </button>
                );
              })}
            </div>

            {points.length >= 2 && (
              <section style={{ ...panelStyle, padding: 20, marginBottom: 18 }} aria-labelledby="metric-chart-title">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                  <div>
                    <h2 id="metric-chart-title" style={{ fontSize: 18, color: '#22313f', margin: 0 }}>{metric.label}</h2>
                    <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                      最近 {points.length} 筆紀錄{metricKey === 'blood_pressure' ? '；實線為收縮壓，虛線為舒張壓' : ''}
                    </p>
                  </div>
                  {loading && <span role="status" style={{ fontSize: 12, color: '#64748b' }}>正在更新…</span>}
                </div>
                <LineChart points={points} metric={metric} showSecondValue={metricKey === 'blood_pressure'} />
                <MetricStats points={points} metric={metric} />
              </section>
            )}

            {points.length === 1 && (
              <section style={{ ...panelStyle, padding: 28, marginBottom: 18, textAlign: 'center' }} aria-labelledby="single-record-title">
                <h2 id="single-record-title" style={{ fontSize: 18, color: '#22313f', margin: 0 }}>{metric.label}</h2>
                <div style={{ color: metric.color, fontSize: 44, fontWeight: 900, marginTop: 18 }}>{points[0].value}</div>
                <div style={{ color: '#64748b', fontSize: 14, marginTop: 3 }}>{metric.unit}</div>
                <p style={{ color: '#64748b', fontSize: 13, margin: '12px 0 0' }}>再新增 1 筆，即可開始比較趨勢。</p>
              </section>
            )}

            {points.length === 0 && (
              <section style={{ ...panelStyle, padding: '38px 24px', marginBottom: 18, textAlign: 'center' }} aria-labelledby="metric-empty-title">
                <MetricIcon size={38} aria-hidden="true" style={{ color: metric.color, marginBottom: 12 }} />
                <h2 id="metric-empty-title" style={{ fontSize: 18, color: '#22313f', margin: 0 }}>
                  {activeMember}還沒有{metric.label}紀錄
                </h2>
                <p style={{ color: '#64748b', fontSize: 13, margin: '8px 0 17px' }}>這是此量測項目的空白狀態；其他量測紀錄仍保留。</p>
                <button
                  type="button"
                  onClick={() => addRecord(metricKey)}
                  style={{ minHeight: 44, padding: '9px 16px', border: 0, borderRadius: 10, background: 'var(--primary)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  新增{metric.label}
                </button>
              </section>
            )}

            <section style={{ ...panelStyle, padding: 18 }} aria-labelledby="all-metrics-title">
              <h2 id="all-metrics-title" style={{ fontSize: 17, color: '#22313f', margin: '0 0 13px' }}>所有量測摘要</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
                {METRICS.map((item) => {
                  const itemPoints = pointsForMetric(activeRecords, item.key);
                  const latest = itemPoints.at(-1);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => switchMetric(item.key)}
                      style={{
                        minHeight: 78,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 11,
                        padding: 12,
                        border: '1px solid var(--gray-200)',
                        borderRadius: 12,
                        background: '#fff',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <Icon size={22} aria-hidden="true" style={{ color: item.color, flexShrink: 0 }} />
                      <span>
                        <span style={{ display: 'block', color: '#334155', fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                        <span style={{ display: 'block', color: latest ? '#172033' : '#64748b', fontSize: latest ? 17 : 13, fontWeight: latest ? 800 : 500, marginTop: 2 }}>
                          {latest ? `${latest.value} ${item.unit}` : '尚無紀錄'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {activeMember && hasSuccessfulData && activeRecords.length > 0 && section === 'insights' && (
          <div
            id="health-trends-panel-insights"
            role="tabpanel"
            aria-labelledby="health-trends-tab-insights"
          >
            <div
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, marginBottom: 16, border: '1px solid #bae6fd', borderRadius: 12, background: '#f0f9ff', color: '#0c4a6e' }}
            >
              <Info size={20} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 13, lineHeight: 1.65, margin: 0 }}>
                這裡使用固定規則整理你已記錄的數值，方便看懂變化。內容不是醫療診斷、不提供治療建議，也不取代醫療專業人員。
              </p>
            </div>

            {insights.length === 0 ? (
              <section style={{ ...panelStyle, padding: '42px 24px', textAlign: 'center' }} aria-labelledby="no-insights-title">
                <CircleCheck size={40} aria-hidden="true" style={{ color: '#15803d', marginBottom: 12 }} />
                <h2 id="no-insights-title" style={{ fontSize: 18, color: '#22313f', margin: 0 }}>目前沒有需要特別說明的數值變化</h2>
                <p style={{ color: '#64748b', fontSize: 13, margin: '8px 0 0' }}>請持續記錄；若有不適或疑問，仍請與醫療團隊確認。</p>
              </section>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {insights.map((insight) => {
                  const appearance = INSIGHT_APPEARANCE[insight.kind];
                  const InsightIcon = appearance.icon;
                  const insightMetric = METRICS.find((item) => item.key === insight.metric);
                  return (
                    <article
                      key={insight.id}
                      style={{
                        ...panelStyle,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 13,
                        padding: 18,
                        borderLeft: `4px solid ${appearance.color}`,
                        background: appearance.background,
                      }}
                    >
                      <InsightIcon size={23} aria-hidden="true" style={{ color: appearance.color, flexShrink: 0, marginTop: 1 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <h2 style={{ fontSize: 16, color: '#172033', margin: 0 }}>{insight.title}</h2>
                          <span style={{ padding: '3px 8px', borderRadius: 99, background: '#fff', color: appearance.color, fontSize: 11, fontWeight: 800 }}>
                            {appearance.label}
                          </span>
                        </div>
                        <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.7, margin: '7px 0 0' }}>{insight.body}</p>
                        {insightMetric && (
                          <button
                            type="button"
                            onClick={() => addRecord(insightMetric.key)}
                            style={{ minHeight: 44, marginTop: 7, padding: '8px 0', border: 0, background: 'transparent', color: '#0f766e', fontWeight: 800, cursor: 'pointer' }}
                          >
                            新增{insightMetric.label}紀錄
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
