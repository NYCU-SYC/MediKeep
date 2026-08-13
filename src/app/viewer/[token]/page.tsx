'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  LoaderCircle,
  Maximize2,
  Minimize2,
  RotateCcw,
  ScanLine,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type DicomInstance = {
  id: string;
  instance_number: number | null;
  rows: number | null;
  columns: number | null;
  window_center: number | null;
  window_width: number | null;
  file_name: string;
  storage_available?: boolean;
};

type SeriesInfo = {
  id: string;
  series_number: number | null;
  series_description: string | null;
  modality: string | null;
  body_part: string | null;
  instance_count: number;
  available_instance_count?: number;
  missing_instance_count?: number;
  storage_available?: boolean;
  instances: DicomInstance[];
};

type StudyInfo = {
  id: string;
  member_name: string;
  study_date: string | null;
  study_description: string | null;
  modality: string | null;
  series: SeriesInfo[];
};

type ShareInfo = {
  share_id: string;
  share_type: 'study' | 'series';
  study?: StudyInfo;
  series?: SeriesInfo;
  expires_at: string | null;
};

const MISSING_STORAGE_MESSAGE = '影像原始檔目前尚未同步完成，請聯絡分享者重新上傳或稍後再試。';

// ── Tool button style ─────────────────────────────────────────────────────────

const TB: React.CSSProperties = {
  width: 44, height: 44, padding: 0, background: '#2a2a2a', color: '#ddd',
  border: '1px solid #444', borderRadius: '6px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function MissingStorageState() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, background: '#0a0a0a', padding: 24 }}>
      <TriangleAlert aria-hidden="true" size={36} style={{ color: '#d99a2b' }} />
      <div style={{ color: '#ddd', fontWeight: 800, fontSize: 15 }}>影像原始檔尚未同步</div>
      <div style={{ color: '#888', maxWidth: 520, textAlign: 'center', lineHeight: 1.7, fontSize: 13 }}>
        {MISSING_STORAGE_MESSAGE}
      </div>
      <div style={{ color: '#999', maxWidth: 520, textAlign: 'center', lineHeight: 1.6, fontSize: 12 }}>
        分享連結仍會保留，但目前無法檢視切片；完成重新上傳後即可再次開啟。
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDicomDate(d: string | null): string {
  if (!d || d.length < 8) return '';
  return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
}

// ── Viewer (shared component logic) ──────────────────────────────────────────

function DicomViewer({
  instances,
  token,
  title,
  modality,
}: {
  instances: DicomInstance[];
  token: string;
  title: string;
  modality?: string | null;
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [wc, setWc] = useState(() => instances[0]?.window_center ?? 400);
  const [ww, setWw] = useState(() => instances[0]?.window_width  ?? 800);
  const [appliedWc, setAppliedWc] = useState(() => instances[0]?.window_center ?? 400);
  const [appliedWw, setAppliedWw] = useState(() => instances[0]?.window_width  ?? 800);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const wcDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wwDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sort instances by instance_number
  const sorted = [...instances].sort((a, b) => (a.instance_number ?? 0) - (b.instance_number ?? 0));
  const inst = sorted[currentIdx];

  const frameUrl = (id: string, fwc: number, fww: number) =>
    `/api/dicom/share/${token}/instances/${id}/frame?wc=${Math.round(fwc)}&ww=${Math.round(fww)}`;

  const handleWcChange = (val: number) => {
    setWc(val);
    if (wcDebounce.current) clearTimeout(wcDebounce.current);
    wcDebounce.current = setTimeout(() => { setAppliedWc(val); setImageLoading(true); }, 500);
  };
  const handleWwChange = (val: number) => {
    setWw(val);
    if (wwDebounce.current) clearTimeout(wwDebounce.current);
    wwDebounce.current = setTimeout(() => { setAppliedWw(val); setImageLoading(true); }, 500);
  };

  // Keyboard navigation
  useEffect(() => {
    const total = sorted.length;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentIdx(i => { const n = Math.min(i + 1, total - 1); if (n !== i) setImageLoading(true); return n; });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentIdx(i => { const n = Math.max(i - 1, 0); if (n !== i) setImageLoading(true); return n; });
      } else if (e.key === 'f' || e.key === 'F') {
        setFullscreen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sorted.length]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      setZoom(z => Math.max(0.2, Math.min(10, z * (e.deltaY > 0 ? 0.9 : 1.1))));
    } else {
      const total = sorted.length;
      if (e.deltaY > 0) setCurrentIdx(i => { const n = Math.min(i + 1, total - 1); if (n !== i) setImageLoading(true); return n; });
      else setCurrentIdx(i => { const n = Math.max(i - 1, 0); if (n !== i) setImageLoading(true); return n; });
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart({ ...pan });
  };
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: panStart.x + (e.clientX - dragStart.x) / zoom,
      y: panStart.y + (e.clientY - dragStart.y) / zoom,
    });
  }, [isDragging, dragStart, panStart, zoom]);
  const onMouseUp = useCallback(() => setIsDragging(false), []);

  const resetView = () => {
    setZoom(1); setPan({ x: 0, y: 0 });
    const init = instances[0];
    if (init) {
      setWc(init.window_center ?? 400); setAppliedWc(init.window_center ?? 400);
      setWw(init.window_width  ?? 800); setAppliedWw(init.window_width  ?? 800);
    }
  };

  if (!inst) return <div style={{ color: '#999', textAlign: 'center', padding: '40px' }}>無影像可顯示</div>;

  const curUrl  = frameUrl(inst.id, appliedWc, appliedWw);
  const prevUrl = sorted[currentIdx - 1] ? frameUrl(sorted[currentIdx - 1].id, appliedWc, appliedWw) : null;
  const nextUrl = sorted[currentIdx + 1] ? frameUrl(sorted[currentIdx + 1].id, appliedWc, appliedWw) : null;

  const viewerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#000' };

  return (
    <div style={viewerStyle}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px',
        background: '#111', borderBottom: '1px solid #2a2a2a', flexWrap: 'wrap', flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {modality && (
              <span style={{ background: '#1565c0', color: '#fff', padding: '1px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>
                {modality}
              </span>
            )}
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#ddd' }}>{title}</span>
          </div>
          <div style={{ fontSize: '11px', color: '#999', marginTop: '2px' }}>
            {inst.columns}×{inst.rows} px
          </div>
        </div>
        <button type="button" aria-label="放大影像" title="放大影像" onClick={() => setZoom(z => Math.min(z * 1.25, 10))} style={TB}><ZoomIn aria-hidden="true" size={20} /></button>
        <span style={{ color: '#aaa', fontSize: '12px', minWidth: '38px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="縮小影像" title="縮小影像" onClick={() => setZoom(z => Math.max(z * 0.8, 0.2))} style={TB}><ZoomOut aria-hidden="true" size={20} /></button>
        <button type="button" aria-label="重設影像檢視" title="重設影像檢視" onClick={resetView} style={TB}><RotateCcw aria-hidden="true" size={20} /></button>
        <button type="button" aria-label={fullscreen ? '離開全螢幕' : '進入全螢幕'} title={fullscreen ? '離開全螢幕' : '進入全螢幕'} onClick={() => setFullscreen(v => !v)} style={{ ...TB, background: fullscreen ? '#1565c0' : '#2a2a2a' }}>
          {fullscreen ? <Minimize2 aria-hidden="true" size={20} /> : <Maximize2 aria-hidden="true" size={20} />}
        </button>
      </div>

      {/* Image area */}
      <div
        style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', minHeight: 0 }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {imageLoading && !imageError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, pointerEvents: 'none' }}>
            <div style={{ color: '#999', fontSize: '13px' }}>載入切片中…</div>
          </div>
        )}
        {imageError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px', zIndex: 5 }}>
            <TriangleAlert aria-hidden="true" size={32} style={{ color: '#d99a2b' }} />
            <span style={{ color: '#999', fontSize: '13px' }}>無法渲染此切片</span>
          </div>
        )}
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            key={curUrl}
            src={curUrl}
            alt={`切片 ${currentIdx + 1}`}
            draggable={false}
            onLoad={() => { setImageLoading(false); setImageError(false); }}
            onError={() => { setImageLoading(false); setImageError(true); }}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              display: (imageLoading || imageError) ? 'none' : 'block',
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: 'center center',
            }}
          />
        </div>
        {prevUrl && <img src={prevUrl} alt="" style={{ display: 'none' }} />}
        {nextUrl && <img src={nextUrl} alt="" style={{ display: 'none' }} />}
        <div style={{
          position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.55)', borderRadius: '12px', padding: '4px 14px',
          color: '#ddd', fontSize: '12px', fontWeight: '600', pointerEvents: 'none',
        }}>
          {currentIdx + 1} / {sorted.length}
        </div>
      </div>

      {/* Controls */}
      <div style={{ background: '#111', borderTop: '1px solid #2a2a2a', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
        {sorted.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label htmlFor="dicom-slice" style={{ color: '#aaa', fontSize: '11px', width: '52px', flexShrink: 0 }}>切片</label>
            <input id="dicom-slice" type="range" min={0} max={sorted.length - 1} value={currentIdx}
              onChange={e => { setCurrentIdx(parseInt(e.target.value)); setImageLoading(true); setImageError(false); }}
              style={{ flex: 1, accentColor: '#3e6b7e', cursor: 'pointer' }} />
            <span style={{ color: '#999', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>
              {currentIdx + 1}/{sorted.length}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label htmlFor="dicom-window-center" style={{ color: '#aaa', fontSize: '11px', width: '52px', flexShrink: 0 }}>窗位</label>
          <input id="dicom-window-center" type="range" min={-1000} max={3000} value={wc}
            onChange={e => handleWcChange(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: '#4caf50', cursor: 'pointer' }} />
          <span style={{ color: '#999', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>{Math.round(wc)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label htmlFor="dicom-window-width" style={{ color: '#aaa', fontSize: '11px', width: '52px', flexShrink: 0 }}>窗寬</label>
          <input id="dicom-window-width" type="range" min={1} max={4000} value={ww}
            onChange={e => handleWwChange(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: '#ff9800', cursor: 'pointer' }} />
          <span style={{ color: '#999', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>{Math.round(ww)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PublicViewerPage() {
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/dicom/share/${token}/info`)
      .then(r => {
        if (!r.ok) {
          const rawRetryAfter = r.headers.get('retry-after');
          const seconds = rawRetryAfter ? Number.parseInt(rawRetryAfter, 10) : Number.NaN;
          const parsedRetryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : null;
          const message = r.status === 410
            ? '此分享連結已過期或已被撤銷'
            : r.status === 429
              ? `目前查詢次數過多${parsedRetryAfter ? `，約 ${parsedRetryAfter} 秒後可重試` : ''}`
              : [502, 503].includes(r.status)
                ? '影像服務暫時無法使用，請稍後重試'
                : '分享連結不存在或已失效';
          const failure = new Error(message) as Error & { retryable?: boolean; retryAfter?: number | null };
          failure.retryable = [429, 502, 503].includes(r.status);
          failure.retryAfter = parsedRetryAfter;
          throw failure;
        }
        return r.json();
      })
      .then((data: ShareInfo) => {
        setInfo(data);
        setRetryable(false);
        setRetryAfter(null);
        // Auto-select first series
        if (data.share_type === 'series' && data.series) {
          setSelectedSeriesId(data.series.id);
        } else if (data.share_type === 'study' && data.study?.series?.length) {
          setSelectedSeriesId((data.study.series.find((s) => s.storage_available !== false) ?? data.study.series[0]).id);
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '無法載入');
        setRetryable(e instanceof TypeError || Boolean((e as { retryable?: boolean })?.retryable));
        setRetryAfter((e as { retryAfter?: number | null })?.retryAfter ?? null);
      })
      .finally(() => setLoading(false));
  }, [retryAttempt, token]);

  if (loading) {
    return (
      <main aria-busy="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a' }}>
        <div style={{ textAlign: 'center', color: '#aaa' }}>
          <LoaderCircle aria-hidden="true" className="hk-viewer-spinner" size={32} style={{ margin: '0 auto 10px' }} />
          <h1 style={{ fontSize: '16px', margin: 0 }}>正在載入分享影像</h1>
          <style>{`
            .hk-viewer-spinner { animation: viewer-spin 0.8s linear infinite; }
            @keyframes viewer-spin { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) { .hk-viewer-spinner { animation: none; } }
          `}</style>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', height: '100vh', background: '#0a0a0a', padding: 24 }}>
        <TriangleAlert aria-hidden="true" size={40} style={{ color: '#d99a2b' }} />
        <h1 style={{ color: '#ddd', fontSize: '20px', margin: 0 }}>無法開啟分享影像</h1>
        <div role="alert" style={{ color: '#aaa', fontSize: '16px', fontWeight: '600' }}>{error}</div>
        <div style={{ color: '#999', fontSize: '13px', textAlign: 'center', maxWidth: '320px' }}>
          {retryable ? (retryAfter ? `服務稍後可恢復，建議約 ${retryAfter} 秒後再試。` : '服務稍後可恢復，請保留此畫面並重新嘗試。') : '此連結可能已過期、撤銷或輸入有誤。請向影像擁有者索取新連結。'}
        </div>
        {retryable && <button type="button" onClick={() => { setLoading(true); setError(''); setRetryAttempt((value) => value + 1); }} style={{ border: '1px solid #555', borderRadius: 8, background: '#222', color: '#ddd', padding: '9px 13px', minHeight: 44, fontWeight: 800, cursor: 'pointer' }}>重新載入</button>}
      </main>
    );
  }

  if (!info) {
    return (
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, height: '100vh', background: '#0a0a0a', color: '#ddd' }}>
        <TriangleAlert aria-hidden="true" size={36} style={{ color: '#d99a2b' }} />
        <h1 style={{ fontSize: 20, margin: 0 }}>無法顯示分享影像</h1>
      </main>
    );
  }

  // ── Study share: show series selector + viewer ──────────────────────────────
  if (info.share_type === 'study' && info.study) {
    const study = info.study;
    const allSeries = study.series ?? [];
    const activeSeries = allSeries.find(s => s.id === selectedSeriesId) ?? allSeries[0];

    return (
      <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>
        {/* Study header */}
        <div style={{
          background: '#111', borderBottom: '1px solid #222',
          padding: '10px 16px', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <ScanLine aria-hidden="true" size={22} style={{ color: '#8bbbd5' }} />
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#ddd', margin: 0 }}>
                {study.study_description || (study.modality ? `${study.modality} 影像` : '影像檢查')}
              </h1>
              <div style={{ fontSize: '11px', color: '#999' }}>
                {formatDicomDate(study.study_date)}
                {study.series.length > 1 ? ` · ${study.series.length} 個序列` : ''}
                {info.expires_at && (
                  <span style={{ marginLeft: '8px' }}>
                    · 分享至 {new Date(info.expires_at).toLocaleDateString('zh-TW')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Series tabs (if multiple series) */}
          {allSeries.length > 1 && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', overflowX: 'auto', paddingBottom: '2px' }}>
              {allSeries.map(s => (
                <button key={s.id} type="button" aria-pressed={selectedSeriesId === s.id} onClick={() => setSelectedSeriesId(s.id)} style={{
                  padding: '5px 12px', borderRadius: '6px', border: '1px solid',
                  borderColor: selectedSeriesId === s.id ? '#1565c0' : '#333',
                  background: selectedSeriesId === s.id ? '#1565c0' : '#1a1a1a',
                  color: s.storage_available === false ? '#a97614' : (selectedSeriesId === s.id ? '#fff' : '#888'),
                  fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 44,
                }}>
                  {s.series_description || `序列 ${s.series_number ?? '?'}`}
                  <span style={{ marginLeft: '4px', opacity: 0.7 }}>({s.instance_count})</span>
                  {s.storage_available === false && <span style={{ marginLeft: 6 }}>需補檔</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Viewer */}
        {activeSeries?.storage_available === false ? (
          <MissingStorageState />
        ) : activeSeries && activeSeries.instances && activeSeries.instances.length > 0 ? (
          <DicomViewer
            key={activeSeries.id}
            instances={activeSeries.instances}
            token={token}
            title={activeSeries.series_description || `序列 ${activeSeries.series_number ?? '?'}`}
            modality={activeSeries.modality}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            請選擇一個序列
          </div>
        )}

        {/* Powered by */}
        <div style={{ background: '#111', borderTop: '1px solid #1a1a1a', padding: '6px 16px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', color: '#8f8f8f' }}>Powered by HealthKeep</span>
        </div>
      </main>
    );
  }

  // ── Series share: direct viewer ─────────────────────────────────────────────
  if (info.share_type === 'series' && info.series) {
    const series = info.series;
    return (
      <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>
        {/* Minimal header */}
        <div style={{
          background: '#111', borderBottom: '1px solid #222',
          padding: '8px 14px', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <ScanLine aria-hidden="true" size={20} style={{ color: '#8bbbd5' }} />
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '17px', fontWeight: '700', color: '#ddd', margin: 0 }}>
              {series.series_description || `序列 ${series.series_number ?? '?'}`}
            </h1>
            {info.expires_at && (
              <div style={{ fontSize: '11px', color: '#999' }}>
                分享至 {new Date(info.expires_at).toLocaleDateString('zh-TW')}
              </div>
            )}
          </div>
          <span style={{ fontSize: '10px', color: '#8f8f8f' }}>HealthKeep</span>
        </div>

        {series.storage_available === false ? (
          <MissingStorageState />
        ) : series.instances && series.instances.length > 0 ? (
          <DicomViewer
            instances={series.instances}
            token={token}
            title={series.series_description || `序列 ${series.series_number ?? '?'}`}
            modality={series.modality}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            無影像資料
          </div>
        )}
      </main>
    );
  }

  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, height: '100vh', background: '#0a0a0a', color: '#ddd' }}>
      <TriangleAlert aria-hidden="true" size={36} style={{ color: '#d99a2b' }} />
      <h1 style={{ fontSize: 20, margin: 0 }}>分享影像格式無法辨識</h1>
    </main>
  );
}
