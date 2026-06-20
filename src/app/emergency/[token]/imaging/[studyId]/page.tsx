'use client';

// 急診專屬 DICOM viewer：所有切片都經 emergency token 代理載入。
// 連結過期 / 撤銷後，後端立即拒絕，影像也跟著失效（不依賴獨立 share 權杖）。

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

type Inst = {
  id: string; instance_number: number | null; rows: number | null; columns: number | null;
  window_center: number | null; window_width: number | null;
};
type Series = {
  id: string; series_number: number | null; series_description: string | null;
  modality: string | null; body_part: string | null; instance_count: number; instances: Inst[];
};
type StudyInfo = {
  study: { id: string; study_description: string | null; study_date: string | null; modality: string | null };
  series: Series[];
  expires_at: string;
};

function fmtDicomDate(d: string | null): string {
  if (!d) return '';
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
  return d;
}

function DicomViewer({ token, series }: { token: string; series: Series }) {
  const instances = [...series.instances].sort((a, b) => (a.instance_number ?? 0) - (b.instance_number ?? 0));
  const [idx, setIdx] = useState(0);
  const [wc, setWc] = useState(() => instances[0]?.window_center ?? 400);
  const [ww, setWw] = useState(() => instances[0]?.window_width ?? 800);
  const [appliedWc, setAppliedWc] = useState(wc);
  const [appliedWw, setAppliedWw] = useState(ww);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const wcT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wwT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inst = instances[idx];
  const frameUrl = (id: string, fwc: number, fww: number) =>
    `/api/emergency/${token}/imaging/instances/${id}/frame?wc=${Math.round(fwc)}&ww=${Math.round(fww)}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setIdx(i => { const n = Math.min(i + 1, instances.length - 1); if (n !== i) setLoading(true); return n; });
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setIdx(i => { const n = Math.max(i - 1, 0); if (n !== i) setLoading(true); return n; });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [instances.length]);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) { setZoom(z => Math.max(0.3, Math.min(8, z * (e.deltaY > 0 ? 0.9 : 1.1)))); return; }
    if (e.deltaY > 0) setIdx(i => { const n = Math.min(i + 1, instances.length - 1); if (n !== i) setLoading(true); return n; });
    else setIdx(i => { const n = Math.max(i - 1, 0); if (n !== i) setLoading(true); return n; });
  };

  const changeWc = (v: number) => { setWc(v); if (wcT.current) clearTimeout(wcT.current); wcT.current = setTimeout(() => { setAppliedWc(v); setLoading(true); }, 400); };
  const changeWw = (v: number) => { setWw(v); if (wwT.current) clearTimeout(wwT.current); wwT.current = setTimeout(() => { setAppliedWw(v); setLoading(true); }, 400); };

  if (!inst) return <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>無影像可顯示</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#000' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#111', borderBottom: '1px solid #2a2a2a', flexWrap: 'wrap' }}>
        <span style={{ background: '#1565c0', color: '#fff', padding: '1px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{series.modality ?? 'DICOM'}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>{series.series_description || `序列 ${series.series_number ?? '?'}`}</span>
        <span style={{ fontSize: 11, color: '#555' }}>{inst.columns}×{inst.rows}px</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => setZoom(z => Math.min(z * 1.25, 8))} style={TB}>＋</button>
          <span style={{ color: '#777', fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.3))} style={TB}>－</button>
          <button onClick={() => { setZoom(1); setWc(inst.window_center ?? 400); setAppliedWc(inst.window_center ?? 400); setWw(inst.window_width ?? 800); setAppliedWw(inst.window_width ?? 800); }} style={TB}>↺</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onWheel={onWheel}>
        {loading && !errored && <div style={{ position: 'absolute', color: '#555', fontSize: 13 }}>載入切片中…</div>}
        {errored && <div style={{ position: 'absolute', color: '#666', fontSize: 13 }}>⚠️ 無法載入此切片（連結可能已過期）</div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={frameUrl(inst.id, appliedWc, appliedWw)}
          src={frameUrl(inst.id, appliedWc, appliedWw)}
          alt={`切片 ${idx + 1}`}
          draggable={false}
          onLoad={() => { setLoading(false); setErrored(false); }}
          onError={() => { setLoading(false); setErrored(true); }}
          style={{ maxWidth: '100%', maxHeight: '100%', display: loading || errored ? 'none' : 'block', transform: `scale(${zoom})`, transformOrigin: 'center' }}
        />
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: '4px 14px', color: '#ddd', fontSize: 12, fontWeight: 600 }}>{idx + 1} / {instances.length}</div>
      </div>
      <div style={{ background: '#111', borderTop: '1px solid #2a2a2a', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {instances.length > 1 && (
          <Row label="切片"><input type="range" min={0} max={instances.length - 1} value={idx} onChange={e => { setIdx(parseInt(e.target.value)); setLoading(true); }} style={{ flex: 1, accentColor: '#007bff' }} /><span style={num}>{idx + 1}/{instances.length}</span></Row>
        )}
        <Row label="WC"><input type="range" min={-1000} max={3000} value={wc} onChange={e => changeWc(parseInt(e.target.value))} style={{ flex: 1, accentColor: '#4caf50' }} /><span style={num}>{Math.round(wc)}</span></Row>
        <Row label="WW"><input type="range" min={1} max={4000} value={ww} onChange={e => changeWw(parseInt(e.target.value))} style={{ flex: 1, accentColor: '#ff9800' }} /><span style={num}>{Math.round(ww)}</span></Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: '#555', fontSize: 11, width: 40 }}>{label}</span>{children}</div>;
}

export default function EmergencyImagingPage() {
  const { token, studyId } = useParams<{ token: string; studyId: string }>();
  const [accessor, setAccessor] = useState('');
  const [data, setData] = useState<StudyInfo | null>(null);
  const [activeSeries, setActiveSeries] = useState<string | null>(null);
  const [phase, setPhase] = useState<'gate' | 'loading' | 'view' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async (who: string) => {
    setPhase('loading'); setError('');
    try {
      const r = await fetch(`/api/emergency/${token}/imaging/${studyId}?accessor_name=${encodeURIComponent(who)}`);
      if (r.status === 410) throw new Error('此連結已過期或已被撤銷');
      if (r.status === 403) throw new Error('此急診連結未包含影像存取權限');
      if (!r.ok) throw new Error('無法載入影像');
      const d: StudyInfo = await r.json();
      setData(d);
      setActiveSeries(d.series[0]?.id ?? null);
      setPhase('view');
    } catch (e) { setError(e instanceof Error ? e.message : '載入失敗'); setPhase(data ? 'view' : 'error'); }
  }, [token, studyId, data]);

  useEffect(() => {
    const who = new URLSearchParams(window.location.search).get('accessor_name')?.trim() || '';
    if (who) { setAccessor(who); load(who); }
    else setPhase('gate');
  }, [load]);

  if (phase === 'gate') {
    return (
      <Centered>
        <div style={{ width: '100%', maxWidth: 360, background: '#fff', borderRadius: 16, padding: 24, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 13, color: '#be123c', fontWeight: 800 }}>HealthKeep · 急診影像</div>
          <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '8px 0 14px' }}>檢視影像前請留下您的姓名，<strong>存取會被記錄</strong>。</p>
          <input value={accessor} onChange={e => setAccessor(e.target.value)} placeholder="例：王醫師" style={{ width: '100%', border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 15 }} />
          {error && <div style={{ color: '#be123c', fontSize: 13, marginTop: 8 }}>{error}</div>}
          <button onClick={() => accessor.trim() && load(accessor.trim())} style={{ width: '100%', marginTop: 14, background: '#be123c', color: '#fff', border: 'none', borderRadius: 10, padding: 12, fontWeight: 850, fontSize: 15, cursor: 'pointer' }}>檢視影像</button>
        </div>
      </Centered>
    );
  }
  if (phase === 'loading') return <Centered><div style={{ color: '#aaa' }}>🩻 載入影像中…</div></Centered>;
  if (phase === 'error') return <Centered><div style={{ fontSize: 40 }}>⚠️</div><div style={{ marginTop: 8, fontWeight: 700, color: '#0f172a' }}>{error}</div></Centered>;

  const d = data!;
  const series = d.series.find(s => s.id === activeSeries) ?? d.series[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>
      <div style={{ background: '#111', borderBottom: '1px solid #222', padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20 }}>🩻</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ddd' }}>{d.study.study_description || (d.study.modality ? `${d.study.modality} 影像` : '影像檢查')}</div>
            <div style={{ fontSize: 11, color: '#666' }}>{fmtDicomDate(d.study.study_date)} · 影像存取有效至 {new Date(d.expires_at).toLocaleString('zh-TW')}</div>
          </div>
        </div>
        {d.series.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto' }}>
            {d.series.map(s => (
              <button key={s.id} onClick={() => setActiveSeries(s.id)} style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid',
                borderColor: activeSeries === s.id ? '#1565c0' : '#333',
                background: activeSeries === s.id ? '#1565c0' : '#1a1a1a',
                color: activeSeries === s.id ? '#fff' : '#888', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{s.series_description || `序列 ${s.series_number ?? '?'}`} ({s.instance_count})</button>
            ))}
          </div>
        )}
      </div>
      {series && series.instances.length > 0
        ? <DicomViewer key={series.id} token={token} series={series} />
        : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>此序列無影像資料</div>}
      <div style={{ background: '#111', borderTop: '1px solid #1a1a1a', padding: '6px 16px', textAlign: 'center' }}>
        <span style={{ fontSize: 10, color: '#333' }}>Powered by HealthKeep · 急診限時影像</span>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', textAlign: 'center', background: '#f1f5f9', padding: 20 }}>{children}</div>;
}

const TB: React.CSSProperties = { padding: '4px 10px', background: '#2a2a2a', color: '#ddd', border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const num: React.CSSProperties = { color: '#666', fontSize: 11, width: 52, textAlign: 'right' };
