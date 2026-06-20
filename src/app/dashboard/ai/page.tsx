'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useActiveMember } from '../member-context';
import { getTypeMeta } from '../record-types';
import { memberHrefWithCurrentSearch, normalizeMemberName } from '@/lib/members';

type RecordOut = {
  id: string;
  member_name: string;
  record_type: string;
  value1: string | null;
  value2: string | null;
  unit: string | null;
  recorded_at: string;
};

type Insight = {
  id: string;
  type: 'warning' | 'good' | 'info' | 'tip';
  title: string;
  body: string;
  metric: string;
  icon: string;
};

const INSIGHT_COLORS: Record<Insight['type'], { bg: string; border: string; label: string; labelBg: string; labelColor: string }> = {
  warning: { bg: '#fff8f0', border: '#ff9800', label: '請留意', labelBg: '#fff3e0', labelColor: '#e65100' },
  good:    { bg: '#f0fff4', border: '#4caf50', label: '參考範圍內', labelBg: '#e8f5e9', labelColor: '#1b5e20' },
  info:    { bg: '#f0f7ff', border: '#2196f3', label: '數值整理', labelBg: '#e3f2fd', labelColor: '#0d47a1' },
  tip:     { bg: '#f9f0ff', border: '#9c27b0', label: '記錄提醒', labelBg: '#f3e5f5', labelColor: '#4a148c' },
};

// ── Rule-based analysis engine ────────────────────────────────────────────────
function analyzeRecords(records: RecordOut[], memberName: string): Insight[] {
  const insights: Insight[] = [];

  const byType: Record<string, RecordOut[]> = {};
  for (const r of records) {
    if (!byType[r.record_type]) byType[r.record_type] = [];
    byType[r.record_type].push(r);
  }

  // ── Blood pressure ────────────────────────────────────────────────────────
  // API returns newest-first, so recent3[0] = most recent measurement
  const bps = byType['blood_pressure'] ?? [];
  if (bps.length >= 3) {
    const systolics = bps.map(r => parseFloat(r.value1 ?? '0')).filter(v => v > 0);
    const avg = systolics.reduce((a, b) => a + b, 0) / systolics.length;
    const recent3 = systolics.slice(0, 3);
    // risingTrend: each successive reading is higher → values increasing over time
    const risingTrend  = recent3.length === 3 && recent3[0] > recent3[1] && recent3[1] > recent3[2];
    // fallingTrend: each successive reading is lower → values decreasing over time (improving)
    const fallingTrend = recent3.length === 3 && recent3[0] < recent3[1] && recent3[1] < recent3[2];

    if (avg >= 140) {
      insights.push({
        id: 'bp-high', type: 'warning', metric: 'blood_pressure', icon: '❤️',
        title: `${memberName}的血壓偏高`,
        body: `近 ${systolics.length} 次量測收縮壓平均為 ${avg.toFixed(0)} mmHg。這是數值整理，非診斷；請帶著紀錄與醫療團隊確認。`,
      });
    } else if (avg < 130 && fallingTrend) {
      insights.push({
        id: 'bp-good', type: 'good', metric: 'blood_pressure', icon: '❤️',
        title: '血壓數值近期較穩定',
        body: `近三次收縮壓呈下降趨勢，平均 ${avg.toFixed(0)} mmHg。請依原醫囑與既有照護計畫持續追蹤。`,
      });
    } else if (risingTrend) {
      insights.push({
        id: 'bp-rising', type: 'warning', metric: 'blood_pressure', icon: '❤️',
        title: '血壓有上升趨勢',
        body: `近三次量測數值連續上升（${recent3[2]}→${recent3[1]}→${recent3[0]} mmHg）。請確認量測方式一致，並帶著紀錄與醫療團隊討論。`,
      });
    } else {
      insights.push({
        id: 'bp-info', type: 'info', metric: 'blood_pressure', icon: '❤️',
        title: `血壓平均 ${avg.toFixed(0)} mmHg`,
        body: `已累積 ${bps.length} 筆量測資料。固定時段量測較容易比較趨勢。`,
      });
    }
  } else if (bps.length > 0) {
    insights.push({
      id: 'bp-few', type: 'tip', metric: 'blood_pressure', icon: '❤️',
      title: '繼續記錄血壓資料',
      body: `目前有 ${bps.length} 筆記錄，累積 3 筆以上才能整理初步趨勢。`,
    });
  }

  // ── Glucose ───────────────────────────────────────────────────────────────
  const gs = byType['glucose'] ?? [];
  if (gs.length >= 2) {
    const vals = gs.map(r => parseFloat(r.value1 ?? '0')).filter(v => v > 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg > 126) {
      insights.push({
        id: 'glu-high', type: 'warning', metric: 'glucose', icon: '🩸',
        title: '空腹血糖偏高',
        body: `近期量測平均血糖 ${avg.toFixed(0)} mg/dL，高於一般空腹參考上限 126 mg/dL。這是數值整理，非診斷；請與您的醫療團隊討論。`,
      });
    } else if (avg >= 100) {
      insights.push({
        id: 'glu-pre', type: 'info', metric: 'glucose', icon: '🩸',
        title: '血糖值偏高',
        body: `近期量測平均血糖 ${avg.toFixed(0)} mg/dL，落在一般空腹參考區間 100–125 的偏高範圍。這是數值整理，非診斷；是否需要進一步評估請與您的醫療團隊討論。`,
      });
    } else {
      insights.push({
        id: 'glu-good', type: 'good', metric: 'glucose', icon: '🩸',
        title: '血糖數值在一般參考範圍',
        body: `${vals.length} 次量測平均 ${avg.toFixed(0)} mg/dL。這是數值整理，仍請依醫療團隊建議追蹤。`,
      });
    }
  }

  // ── Heart rate ────────────────────────────────────────────────────────────
  const hrs = byType['heart_rate'] ?? [];
  if (hrs.length >= 2) {
    const vals = hrs.map(r => parseFloat(r.value1 ?? '0')).filter(v => v > 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg < 60) {
      insights.push({
        id: 'hr-low', type: 'warning', metric: 'heart_rate', icon: '💓',
        title: '心跳偏緩',
        body: `近期量測平均心跳 ${avg.toFixed(0)} bpm，低於一般靜止心跳參考下限 60 bpm。這是數值整理，非診斷；如有不適或疑問，請與您的醫療團隊討論。`,
      });
    } else if (avg > 100) {
      insights.push({
        id: 'hr-high', type: 'warning', metric: 'heart_rate', icon: '💓',
        title: '心跳偏快',
        body: `平均心跳 ${avg.toFixed(0)} bpm，超過一般靜止心跳參考上限 100 bpm。這是數值整理，若有不適或疑問請與醫療團隊討論。`,
      });
    } else {
      insights.push({
        id: 'hr-good', type: 'good', metric: 'heart_rate', icon: '💓',
        title: '心跳在一般參考範圍',
        body: `${vals.length} 次量測平均心跳 ${avg.toFixed(0)} bpm，一般靜止心跳參考範圍為 60–100 bpm。`,
      });
    }
  }

  // ── Steps ─────────────────────────────────────────────────────────────────
  const steps = byType['steps'] ?? [];
  if (steps.length >= 3) {
    const vals = steps.map(r => parseFloat(r.value1 ?? '0')).filter(v => v > 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg >= 8000) {
      insights.push({
        id: 'steps-good', type: 'good', metric: 'steps', icon: '👟',
        title: '步數達到常見活動量參考',
        body: `近期日均步數 ${avg.toFixed(0)} 步，已達常見活動量參考值。請依個人體能與醫囑安排活動。`,
      });
    } else {
      insights.push({
        id: 'steps-low', type: 'tip', metric: 'steps', icon: '👟',
        title: '步數低於常見活動量參考',
        body: `日均 ${avg.toFixed(0)} 步，低於常見活動量參考值。是否調整活動量，請依個人體能與醫療團隊建議。`,
      });
    }
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────
  const sleeps = byType['sleep'] ?? [];
  if (sleeps.length >= 3) {
    const vals = sleeps.map(r => parseFloat(r.value1 ?? '0')).filter(v => v > 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (avg < 6) {
      insights.push({
        id: 'sleep-low', type: 'warning', metric: 'sleep', icon: '😴',
        title: '睡眠時間不足',
        body: `平均睡眠 ${avg.toFixed(1)} 小時，低於成年人常見睡眠參考範圍。若長期如此或伴隨不適，請與醫療團隊討論。`,
      });
    } else if (avg >= 7 && avg <= 9) {
      insights.push({
        id: 'sleep-good', type: 'good', metric: 'sleep', icon: '😴',
        title: '睡眠時間在常見參考範圍',
        body: `平均睡眠 ${avg.toFixed(1)} 小時，落在成年人常見睡眠參考範圍。`,
      });
    } else if (avg > 9) {
      insights.push({
        id: 'sleep-long', type: 'info', metric: 'sleep', icon: '😴',
        title: '睡眠時間較長',
        body: `平均睡眠 ${avg.toFixed(1)} 小時，超過 9 小時。這是數值整理，非診斷；若長期如此可與您的醫療團隊討論。`,
      });
    }
  }

  // ── BMI ───────────────────────────────────────────────────────────────────
  const bmis = byType['bmi'] ?? [];
  if (bmis.length > 0) {
    const latest = parseFloat(bmis[0].value1 ?? '0');
    if (latest >= 30) {
      insights.push({ id: 'bmi-obese', type: 'warning', metric: 'bmi', icon: '📊', title: 'BMI 落在肥胖參考範圍', body: `目前 BMI ${latest.toFixed(1)}（肥胖參考：≥30）。這是數值整理，體重管理方式請與醫療團隊討論。` });
    } else if (latest >= 24) {
      insights.push({ id: 'bmi-over', type: 'info', metric: 'bmi', icon: '📊', title: 'BMI 落在過重參考範圍', body: `目前 BMI ${latest.toFixed(1)}（過重參考：24–30）。是否需要調整飲食或活動，請與醫療團隊討論。` });
    } else if (latest >= 18.5) {
      insights.push({ id: 'bmi-good', type: 'good', metric: 'bmi', icon: '📊', title: 'BMI 在一般參考範圍', body: `目前 BMI ${latest.toFixed(1)}，落在一般參考範圍（18.5–24）。` });
    } else if (latest > 0) {
      insights.push({ id: 'bmi-low', type: 'info', metric: 'bmi', icon: '📊', title: 'BMI 偏低', body: `目前 BMI ${latest.toFixed(1)}（< 18.5）。這是數值整理，非診斷；體重狀況可與您的醫療團隊討論。` });
    }
  }

  // ── Body fat ──────────────────────────────────────────────────────────────
  const bodyFats = byType['body_fat'] ?? [];
  if (bodyFats.length > 0) {
    const latest = parseFloat(bodyFats[0].value1 ?? '0');
    if (latest > 0) {
      // General guidance (gender-specific ranges would need more data)
      if (latest > 30) {
        insights.push({ id: 'bf-high', type: 'warning', metric: 'body_fat', icon: '🔬', title: '體脂率偏高', body: `目前體脂率 ${latest.toFixed(1)}%，高於一般參考值。這是數值整理，是否需要調整請與醫療團隊討論。` });
      } else if (latest >= 18 && latest <= 28) {
        insights.push({ id: 'bf-good', type: 'good', metric: 'body_fat', icon: '🔬', title: '體脂率在一般參考範圍', body: `目前體脂率 ${latest.toFixed(1)}%，落在一般參考範圍。` });
      } else {
        insights.push({ id: 'bf-info', type: 'info', metric: 'body_fat', icon: '🔬', title: `體脂率 ${latest.toFixed(1)}%`, body: `持續記錄體脂率，有助於追蹤身體組成的長期變化趨勢。` });
      }
    }
  }

  // ── General tip when few data points ─────────────────────────────────────
  if (records.length > 0 && records.length < 5) {
    insights.push({
      id: 'general-tip', type: 'tip', metric: 'general', icon: '📊',
      title: '累積更多資料，趨勢更完整',
      body: `目前共有 ${records.length} 筆紀錄。持續記錄 2 週以上，較能呈現完整趨勢。`,
    });
  }

  return insights;
}

// ── Preview cards shown when no data ─────────────────────────────────────────
const PREVIEW_INSIGHTS: Insight[] = [
  { id: 'p1', type: 'info', metric: 'blood_pressure', icon: '❤️', title: '（範例）血壓有上升趨勢', body: '示意：近三次量測收縮壓連續上升。實際資料會以白話整理數值變化，非診斷。' },
  { id: 'p2', type: 'good',    metric: 'steps',          icon: '👟', title: '（範例）步數達到常見活動量參考', body: '示意：本週日均步數 9,240 步。實際活動安排仍請依個人體能與醫囑。' },
  { id: 'p3', type: 'tip',     metric: 'sleep',          icon: '😴', title: '（範例）睡眠時間略低於參考範圍', body: '示意：平均睡眠 6.2 小時。若長期如此或伴隨不適，可與醫療團隊討論。' },
  { id: 'p4', type: 'info',    metric: 'glucose',        icon: '🩸', title: '（範例）血糖數值在一般參考範圍', body: '示意：5 次量測平均 98 mg/dL。這是數值整理，非診斷。' },
];

export default function AiPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeMember, setActiveMember, members } = useActiveMember();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const requestedMemberParam = searchParams.get('member');

  useEffect(() => {
    if (requestedMemberParam === null) return;
    setActiveMember(normalizeMemberName(requestedMemberParam));
  }, [requestedMemberParam, setActiveMember]);

  const switchMember = (member: string) => {
    const normalized = normalizeMemberName(member);
    setActiveMember(normalized);
    router.replace(memberHrefWithCurrentSearch(pathname, searchParams.toString(), normalized), { scroll: false });
  };

  const analyze = useCallback(async () => {
    if (!activeMember) return;
    setLoading(true);
    try {
      const resp = await fetch(
        `/api/records?member=${encodeURIComponent(activeMember)}&limit=100`,
        { credentials: 'include' }
      );
      if (resp.ok) {
        const data: RecordOut[] = await resp.json();
        setRecordCount(data.length);
        setHasData(data.length > 0);
        setInsights(data.length > 0 ? analyzeRecords(data, activeMember) : []);
      }
    } finally {
      setLoading(false);
    }
  }, [activeMember]);

  useEffect(() => { analyze(); }, [analyze]);

  const displayInsights = hasData ? insights : PREVIEW_INSIGHTS;

  return (
    <div className="page-wrap" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
          <button
            onClick={() => router.back()}
            style={{
              width: '44px', height: '44px', borderRadius: '10px', background: '#fff',
              border: '1px solid var(--gray-200)', fontSize: '18px', cursor: 'pointer',
              color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, boxShadow: 'var(--shadow-sm)',
            }}
          >←</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#111' }}>健康數值整理</h2>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '2px' }}>
              {hasData && activeMember
                ? `整理 ${activeMember} 的 ${recordCount} 筆數值變化，以白話呈現`
                : '把你記錄的健康數值，整理成白話的趨勢說明'}
            </p>
            <p style={{ fontSize: '12px', color: '#9333ea', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              ⓘ 這是規則式數值整理，<strong>非醫療診斷、不提供治療建議、不取代醫師</strong>。用藥與治療請依醫療團隊指示。
            </p>
          </div>
          {hasData && activeMember && (
            <button
              onClick={analyze}
              disabled={loading}
              style={{
                background: '#f0f4f8', color: '#555', border: 'none',
                padding: '8px 16px', borderRadius: '10px', fontWeight: '600',
                fontSize: '13px', cursor: 'pointer',
              }}
            >
              🔄 重新分析
            </button>
          )}
        </div>

        {/* No members */}
        {members.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>👨‍👩‍👧‍👦</div>
            <div style={{ fontWeight: '700', color: '#333', marginBottom: '8px' }}>請先新增家庭成員</div>
            <button
              onClick={() => router.push('/dashboard/settings')}
              style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', fontWeight: '600' }}
            >
              前往設定 →
            </button>
          </div>
        )}

        {/* ── 全部 mode guide: no specific member selected ── */}
        {members.length > 0 && !activeMember && (
          <div style={{
            background: '#fff', borderRadius: '20px', padding: '48px 32px',
            textAlign: 'center', boxShadow: 'var(--shadow-sm)', marginBottom: '20px',
          }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>📊</div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>
              請選擇要分析的成員
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.7, marginBottom: '24px' }}>
              數值整理會針對個別成員的健康紀錄，<br />請從上方選擇成員後再查看。
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {members.map(m => (
                <button
                  key={m.id}
                  onClick={() => switchMember(m.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 20px', borderRadius: '24px',
                    border: `2px solid ${m.color}`,
                    background: `${m.color}12`, color: m.color,
                    fontSize: '14px', fontWeight: '700', cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '12px',
                    background: m.color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
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

        {/* Preview banner (has member but no data) */}
        {members.length > 0 && activeMember && !hasData && !loading && (
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '20px', padding: '28px', marginBottom: '24px', color: '#fff',
          }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📊</div>
            <h3 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>數值整理預覽</h3>
            <p style={{ fontSize: '14px', opacity: 0.9, lineHeight: 1.7 }}>
              開始記錄血壓、血糖、體重等數值後，<br />
              HealthKeep 會用規則式邏輯整理趨勢與提醒。<br />
              以下是示意資料，非診斷或治療建議。
            </p>
            <button
              onClick={() => router.push('/dashboard/upload')}
              style={{
                marginTop: '16px', background: '#fff', color: '#764ba2',
                border: 'none', padding: '10px 24px', borderRadius: '10px',
                fontWeight: '700', fontSize: '14px', cursor: 'pointer',
              }}
            >
              開始記錄健康資料 →
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px', color: '#999' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
            <div>正在整理健康數值...</div>
          </div>
        )}

        {/* Member chips (desktop only, when has data and multiple members) */}
        {hasData && members.length > 1 && activeMember && (
          <div className="desktop-only" style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => switchMember(m.name)}
                style={{
                  padding: '6px 14px', borderRadius: '20px', border: '1px solid',
                  borderColor: m.name === activeMember ? 'var(--primary)' : '#ddd',
                  background: m.name === activeMember ? 'var(--primary)' : '#fff',
                  color: m.name === activeMember ? '#fff' : '#555',
                  fontSize: '13px', cursor: 'pointer',
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {/* Insight cards */}
        {!loading && members.length > 0 && activeMember && (
          <>
            {displayInsights.length === 0 && hasData && (
              <div style={{ textAlign: 'center', padding: '48px', background: '#fff', borderRadius: '16px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                <div style={{ fontWeight: '700', color: '#333' }}>目前沒有規則式整理標記出的特別項目</div>
                <div style={{ fontSize: '13px', color: '#888', marginTop: '8px' }}>請持續記錄；若有不適或疑問，仍請與醫療團隊確認。</div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {displayInsights.map(insight => {
                const style = INSIGHT_COLORS[insight.type];
                const meta = getTypeMeta(insight.metric);
                return (
                  <div
                    key={insight.id}
                    style={{
                      background: style.bg, borderRadius: '16px', padding: '20px',
                      borderLeft: `4px solid ${style.border}`,
                      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                      <div style={{ fontSize: '28px', lineHeight: 1, flexShrink: 0 }}>{insight.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '15px', fontWeight: '700', color: '#111' }}>{insight.title}</span>
                          <span style={{
                            fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px',
                            background: style.labelBg, color: style.labelColor,
                          }}>{style.label}</span>
                          {!hasData && (
                            <span style={{ fontSize: '10px', background: '#f0f0f0', color: '#999', padding: '2px 6px', borderRadius: '10px' }}>
                              預覽
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.7, margin: 0 }}>{insight.body}</p>
                        {/* Quick link to record this metric */}
                        {hasData && insight.metric !== 'general' && (
                          <button
                            onClick={() => router.push(
                              insight.metric === 'body_fat'
                                ? '/dashboard/upload?type=body_composition'
                                : `/dashboard/upload?type=${insight.metric}`
                            )}
                            style={{
                              marginTop: '10px', fontSize: '12px', color: meta.color,
                              border: 'none', background: 'none', cursor: 'pointer',
                              fontWeight: '600', padding: 0,
                            }}
                          >
                            → 記錄新一筆 {meta.label}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom CTA when no real data */}
            {!hasData && (
              <div style={{ marginTop: '24px', textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: '#aaa', marginBottom: '12px' }}>累積 7 天以上的資料，趨勢整理會更完整</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {(['blood_pressure', 'glucose', 'weight'] as const).map(type => {
                    const meta = getTypeMeta(type);
                    return (
                      <button
                        key={type}
                        onClick={() => router.push(`/dashboard/upload?type=${type}`)}
                        style={{
                          padding: '8px 18px', borderRadius: '10px', border: '1px solid #ddd',
                          background: '#fff', color: '#555', fontSize: '13px', cursor: 'pointer',
                        }}
                      >
                        {meta.icon} 記錄{meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
