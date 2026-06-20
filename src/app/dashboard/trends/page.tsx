'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';

type RecordOut = {
  id: string;
  record_type: string;
  value1: string | null;
  value2: string | null;
  unit: string | null;
  recorded_at: string;
};

type Point = { label: string; value: number; value2?: number };

const METRICS = [
  { key: 'blood_pressure', label: '血壓',   icon: '❤️',  unit: 'mmHg', color: '#f44336', target: 140, targetLabel: '警戒 140' },
  { key: 'heart_rate',     label: '心跳',   icon: '💓',  unit: 'bpm',  color: '#e91e63', target: 100, targetLabel: '上限 100' },
  { key: 'glucose',        label: '血糖',   icon: '🩸',  unit: 'mg/dL', color: '#ff9800', target: 130, targetLabel: '上限 130' },
  { key: 'weight',         label: '體重',   icon: '⚖️',  unit: 'kg',   color: '#2196f3' },
  { key: 'steps',          label: '步數',   icon: '👟',  unit: '步',   color: '#4caf50', target: 8000, targetLabel: '目標 8,000' },
  { key: 'sleep',          label: '睡眠',   icon: '😴',  unit: 'h',    color: '#9c27b0', target: 7, targetLabel: '目標 7h' },
  { key: 'bmi',            label: 'BMI',    icon: '📊',  unit: '',     color: '#00bcd4' },
  { key: 'body_fat',       label: '體脂率', icon: '🔬',  unit: '%',    color: '#795548' },
] as const;

type MetricKey = typeof METRICS[number]['key'];

// ── SVG Line Chart ────────────────────────────────────────────────────────────
function LineChart({ points, color, target, targetLabel, showDiastolic }: {
  points: Point[]; color: string; target?: number; targetLabel?: string; showDiastolic?: boolean;
}) {
  if (points.length < 2) return null;
  const W = 560; const H = 160;
  const PAD = { top: 16, right: 24, bottom: 28, left: 48 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  const vals = points.map(p => p.value);
  const allVals = showDiastolic
    ? [...vals, ...points.map(p => p.value2 ?? p.value)]
    : vals;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const rng = maxV - minV || 1;
  const lo = Math.floor(minV - rng * 0.2);
  const hi = Math.ceil(maxV + rng * 0.2);
  const tot = hi - lo || 1;

  const tx = (i: number) => PAD.left + (i / (points.length - 1)) * iW;
  const ty = (v: number) => PAD.top + iH - ((v - lo) / tot) * iH;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(i).toFixed(1)} ${ty(p.value).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${tx(points.length - 1).toFixed(1)} ${PAD.top + iH} L ${PAD.left} ${PAD.top + iH} Z`;

  const diastolicPathD = showDiastolic
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(i).toFixed(1)} ${ty(p.value2 ?? p.value).toFixed(1)}`).join(' ')
    : '';

  const yTicks = [lo, Math.round((lo + hi) / 2), hi];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PAD.left} y1={ty(v)} x2={PAD.left + iW} y2={ty(v)} stroke="#e9ecef" strokeWidth="1" />
          <text x={PAD.left - 6} y={ty(v) + 4} textAnchor="end" fontSize="10" fill="#aaa">{v}</text>
        </g>
      ))}
      {/* Target line */}
      {target !== undefined && target >= lo && target <= hi && (
        <g>
          <line x1={PAD.left} y1={ty(target)} x2={PAD.left + iW} y2={ty(target)} stroke={color} strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
          <text x={PAD.left + iW + 4} y={ty(target) + 4} fontSize="9" fill={color} opacity="0.7">{targetLabel}</text>
        </g>
      )}
      {/* Area fill (systolic only) */}
      <path d={areaD} fill={color} opacity="0.07" />
      {/* Diastolic line (blood pressure only) */}
      {showDiastolic && diastolicPathD && (
        <path d={diastolicPathD} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" opacity="0.6" />
      )}
      {/* Systolic / main line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* Data point circles */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={tx(i)} cy={ty(p.value)} r="4" fill="#fff" stroke={color} strokeWidth="2" />
          {showDiastolic && p.value2 !== undefined && (
            <circle cx={tx(i)} cy={ty(p.value2)} r="3" fill="#fff" stroke={color} strokeWidth="1.5" opacity="0.7" />
          )}
          <text x={tx(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="#aaa">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function StatRow({ points, unit, showDiastolic }: { points: Point[]; unit: string; showDiastolic?: boolean }) {
  if (points.length === 0) return null;
  const vals = points.map(p => p.value);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const last = vals[vals.length - 1];
  const prev = vals.length >= 2 ? vals[vals.length - 2] : last;
  const delta = last - prev;

  const diastolicVals = showDiastolic ? points.map(p => p.value2).filter((v): v is number => v !== undefined) : [];
  const diastolicAvg = diastolicVals.length > 0 ? diastolicVals.reduce((a, b) => a + b, 0) / diastolicVals.length : null;

  return (
    <div style={{ marginTop: '16px' }}>
      <div className="grid-4col">
        {[
          { label: '最新', value: last % 1 === 0 ? last.toString() : last.toFixed(1), sub: delta !== 0 ? `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} vs 上次` : '與上次持平', subColor: delta > 0 ? '#f44336' : delta < 0 ? '#4caf50' : '#999' },
          { label: '平均', value: avg.toFixed(1), sub: `${points.length}筆平均`, subColor: '#999' },
          { label: '最低', value: (Math.min(...vals)).toFixed(1), sub: unit, subColor: '#4caf50' },
          { label: '最高', value: (Math.max(...vals)).toFixed(1), sub: unit, subColor: '#f44336' },
        ].map(s => (
          <div key={s.label} style={{ background: '#f8f9fa', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#999', marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#111' }}>{s.value}</div>
            <div style={{ fontSize: '10px', color: s.subColor, marginTop: '2px' }}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Diastolic note for blood pressure */}
      {diastolicAvg !== null && (
        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '10px', textAlign: 'center' }}>
          舒張壓平均：{diastolicAvg.toFixed(0)} mmHg（虛線）
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TrendsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const [activeMetricKey, setActiveMetricKey] = useState<MetricKey>('blood_pressure');
  const [records, setRecords] = useState<RecordOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Partial<Record<MetricKey, RecordOut[]>>>({});
  const requestedMemberParam = searchParams.get('member');

  const metric = METRICS.find(m => m.key === activeMetricKey) ?? METRICS[0];

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const switchMember = (member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  useEffect(() => {
    if (!activeMember) return;
    fetch(
      `/api/records?member=${encodeURIComponent(activeMember)}&record_type=${activeMetricKey}&limit=30`,
      { credentials: 'include' }
    )
      .then(r => r.ok ? r.json() : [])
      .then((data: RecordOut[]) => setRecords(data))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [activeMember, activeMetricKey]);

  useEffect(() => {
    if (!activeMember) return;
    const fetchAll = async () => {
      const result: Partial<Record<MetricKey, RecordOut[]>> = {};
      await Promise.all(
        METRICS.map(async m => {
          try {
            const resp = await fetch(
              `/api/records?member=${encodeURIComponent(activeMember)}&record_type=${m.key}&limit=10`,
              { credentials: 'include' }
            );
            if (resp.ok) result[m.key] = await resp.json();
          } catch { /* ignore */ }
        })
      );
      setSummary(result);
    };
    fetchAll();
  }, [activeMember]);

  const points: Point[] = [...records].reverse().map(r => ({
    label: new Date(r.recorded_at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
    value: parseFloat(r.value1 ?? '0'),
    value2: r.value2 ? parseFloat(r.value2) : undefined,
  }));

  const isBP = activeMetricKey === 'blood_pressure';

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
          <button
            onClick={() => router.back()}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              minWidth: '44px', height: '44px', flexShrink: 0,
              border: '1px solid var(--gray-200)', background: '#fff', borderRadius: '12px',
              fontSize: '18px', cursor: 'pointer', color: '#555', boxShadow: 'var(--shadow-sm)',
            }}
          >←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', lineHeight: 1.2 }}>趨勢分析</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginTop: '3px' }}>
              {activeMember ? `${activeMember}的健康指標趨勢` : '追蹤各項健康指標的變化'}
            </p>
          </div>
          {activeMember && (
            <button
              onClick={() => router.push(`/dashboard/upload?type=${activeMetricKey === 'body_fat' ? 'body_composition' : metric.key}`)}
              style={{
                background: 'var(--primary)', color: '#fff', border: 'none',
                padding: '10px 18px', borderRadius: '10px', fontWeight: '700',
                fontSize: '14px', cursor: 'pointer', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(0,123,255,0.3)',
              }}
            >
              + 新增
            </button>
          )}
        </div>

        {/* ── 全部 mode guide ── */}
        {!activeMember && members.length > 0 && (
          <div style={{
            background: '#fff', borderRadius: '20px', padding: '48px 32px',
            textAlign: 'center', boxShadow: 'var(--shadow-sm)', marginBottom: '20px',
          }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>📈</div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>
              請選擇要查看的成員
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.7, marginBottom: '24px' }}>
              趨勢分析針對個別成員的健康數據，<br />請從上方選擇成員後查看圖表。
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {members.map(m => (
                <button
                  key={m.id}
                  onClick={() => switchMember(m.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 20px', borderRadius: '24px',
                    border: `2px solid ${m.color}`, background: `${m.color}12`, color: m.color,
                    fontSize: '14px', fontWeight: '700', cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '12px', background: m.color,
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: '800',
                  }}>
                    {m.name.slice(0, 2)}
                  </div>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Content when member is selected ── */}
        {activeMember && (
          <>
            {/* Metric tabs — horizontally scrollable on mobile */}
            <div className="scroll-x-row" style={{ marginBottom: '20px' }}>
              {METRICS.map(m => (
                <button
                  key={m.key}
                  onClick={() => setActiveMetricKey(m.key as MetricKey)}
                  style={{
                    padding: '9px 18px', borderRadius: '10px',
                    border: `1.5px solid ${activeMetricKey === m.key ? m.color : 'var(--gray-200)'}`,
                    background: activeMetricKey === m.key ? m.color : '#fff',
                    color: activeMetricKey === m.key ? '#fff' : '#555',
                    fontWeight: activeMetricKey === m.key ? '700' : '500',
                    fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>

            {/* Chart card */}
            {loading ? (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '60px', textAlign: 'center', boxShadow: 'var(--shadow-sm)', marginBottom: '24px' }}>
                <div style={{ width: '36px', height: '36px', border: '3px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <div style={{ color: '#94a3b8', fontSize: '14px' }}>載入中...</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : points.length >= 2 ? (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-sm)', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h3 style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>
                      {metric.icon} {metric.label}
                      <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 'normal', marginLeft: '8px' }}>· {activeMember}</span>
                    </h3>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                      最近 {points.length} 筆紀錄
                      {isBP && ' · 實線=收縮壓，虛線=舒張壓'}
                    </p>
                  </div>
                </div>
                <LineChart
                  points={points}
                  color={metric.color}
                  target={'target' in metric ? metric.target : undefined}
                  targetLabel={'targetLabel' in metric ? metric.targetLabel : undefined}
                  showDiastolic={isBP}
                />
                <StatRow points={points} unit={metric.unit} showDiastolic={isBP} />
              </div>
            ) : points.length === 1 ? (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', boxShadow: 'var(--shadow-sm)', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '17px', fontWeight: '800', marginBottom: '20px', color: '#0f172a' }}>{metric.icon} {metric.label}</h3>
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <div style={{ fontSize: '48px', fontWeight: '900', color: metric.color, lineHeight: 1 }}>{points[0].value}</div>
                  <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '6px' }}>{metric.unit}</div>
                  <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '12px' }}>僅有 1 筆紀錄，再新增 1 筆即可看到趨勢圖</p>
                </div>
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '60px 32px', textAlign: 'center', boxShadow: 'var(--shadow-sm)', marginBottom: '24px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📈</div>
                <div style={{ fontWeight: '700', color: '#0f172a', marginBottom: '8px', fontSize: '17px' }}>
                  {activeMember} 還沒有 {metric.label} 的紀錄
                </div>
                <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>開始記錄即可看到趨勢圖表</p>
                <button
                  onClick={() => router.push(`/dashboard/upload?type=${activeMetricKey === 'body_fat' ? 'body_composition' : metric.key}`)}
                  style={{ background: 'var(--primary)', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: '10px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,123,255,0.3)' }}
                >
                  + 記錄第一筆 {metric.label}
                </button>
              </div>
            )}

            {/* Overview grid — other metrics */}
            {Object.values(summary).some(arr => arr && arr.length > 0) && (
              <>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '14px' }}>
                  全部指標概覽
                </div>
                <div className="grid-2col">
                  {METRICS.filter(m => m.key !== activeMetricKey).map(m => {
                    const recs = summary[m.key] ?? [];
                    if (recs.length === 0) return null;
                    const last = parseFloat(recs[0].value1 ?? '0');
                    const prev = recs.length >= 2 ? parseFloat(recs[1].value1 ?? '0') : last;
                    const delta = last - prev;
                    const miniPts = [...recs].reverse().map(r => parseFloat(r.value1 ?? '0'));
                    const maxMini = Math.max(...miniPts);
                    return (
                      <button
                        key={m.key}
                        onClick={() => setActiveMetricKey(m.key as MetricKey)}
                        style={{
                          background: '#fff', borderRadius: '14px', padding: '20px',
                          boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
                          border: '1px solid var(--gray-200)', textAlign: 'left',
                          transition: 'transform 0.15s, box-shadow 0.15s',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                          (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-md)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.transform = '';
                          (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-sm)';
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: `${m.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                            {m.icon}
                          </div>
                          {delta !== 0 && (
                            <span style={{ fontSize: '11px', color: delta > 0 ? '#f44336' : '#4caf50', fontWeight: '700' }}>
                              {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} {m.unit}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '3px', fontWeight: '600' }}>{m.label}</div>
                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>
                          {m.key === 'steps' ? last.toLocaleString() : last.toFixed(1)}
                          {m.unit && <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#94a3b8', marginLeft: '4px' }}>{m.unit}</span>}
                        </div>
                        {miniPts.length >= 2 && (
                          <div style={{ height: '28px', display: 'flex', alignItems: 'flex-end', gap: '2px', marginTop: '10px' }}>
                            {miniPts.map((v, i) => (
                              <div key={i} style={{ flex: 1, height: `${maxMini > 0 ? (v / maxMini) * 100 : 50}%`, background: m.color, borderRadius: '2px', opacity: 0.6 }} />
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
