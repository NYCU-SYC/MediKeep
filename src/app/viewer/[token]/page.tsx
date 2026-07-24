'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

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

const MISSING_STORAGE_MESSAGE = '影像原始檔不存在於目前後端環境，請重新上傳 DICOM 或同步 api/uploads/dicom 檔案。';

// ── Tool button style ─────────────────────────────────────────────────────────

const TB: React.CSSProperties = {
  padding: '5px 12px', background: '#2a2a2a', color: '#ddd',
  border: '1px solid #444', borderRadius: '6px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600', flexShrink: 0,
};

function MissingStorageState() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, background: '#0a0a0a', padding: 24 }}>
      <div style={{ fontSize: 36 }}>⚠️</div>
      <div style={{ color: '#ddd', fontWeight: 800, fontSize: 15 }}>影像原始檔尚未同步</div>
      <div style={{ color: '#888', maxWidth: 520, textAlign: 'center', lineHeight: 1.7, fontSize: 13 }}>
        {MISSING_STORAGE_MESSAGE}
      </div>
      <div style={{ color: '#555', maxWidth: 520, textAlign: 'center', lineHeight: 1.6, fontSize: 12 }}>
        分享連結仍可保留索引資訊，但目前無法檢視切片。請聯絡影像擁有者重新上傳或同步後端檔案。
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

  if (!inst) return <div style={{ color: '#666', textAlign: 'center', padding: '40px' }}>無影像可顯示</div>;

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
          <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
            {inst.columns}×{inst.rows} px
          </div>
        </div>
        <button onClick={() => setZoom(z => Math.min(z * 1.25, 10))} style={TB}>+</button>
        <span style={{ color: '#777', fontSize: '12px', minWidth: '38px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.2))} style={TB}>−</button>
        <button onClick={resetView} style={TB}>↺</button>
        <button onClick={() => setFullscreen(v => !v)} style={{ ...TB, background: fullscreen ? '#1565c0' : '#2a2a2a' }}>
          {fullscreen ? '⊡' : '⊞'}
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
            <div style={{ color: '#555', fontSize: '13px' }}>載入切片中…</div>
          </div>
        )}
        {imageError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px', zIndex: 5 }}>
            <span style={{ fontSize: '32px' }}>⚠️</span>
            <span style={{ color: '#666', fontSize: '13px' }}>無法渲染此切片</span>
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
            <span style={{ color: '#555', fontSize: '11px', width: '52px', flexShrink: 0 }}>切片</span>
            <input type="range" min={0} max={sorted.length - 1} value={currentIdx}
              onChange={e => { setCurrentIdx(parseInt(e.target.value)); setImageLoading(true); setImageError(false); }}
              style={{ flex: 1, accentColor: '#3e6b7e', cursor: 'pointer' }} />
            <span style={{ color: '#666', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>
              {currentIdx + 1}/{sorted.length}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#555', fontSize: '11px', width: '52px', flexShrink: 0 }}>WC</span>
          <input type="range" min={-1000} max={3000} value={wc}
            onChange={e => handleWcChange(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: '#4caf50', cursor: 'pointer' }} />
          <span style={{ color: '#666', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>{Math.round(wc)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#555', fontSize: '11px', width: '52px', flexShrink: 0 }}>WW</span>
          <input type="range" min={1} max={4000} value={ww}
            onChange={e => handleWwChange(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: '#ff9800', cursor: 'pointer' }} />
          <span style={{ color: '#666', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>{Math.round(ww)}</span>
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
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/dicom/share/${token}/info`)
      .then(r => {
        if (r.status === 410) throw new Error('此分享連結已過期');
        if (!r.ok) throw new Error('分享連結不存在或已失效');
        return r.json();
      })
      .then((data: ShareInfo) => {
        setInfo(data);
        // Auto-select first series
        if (data.share_type === 'series' && data.series) {
          setSelectedSeriesId(data.series.id);
        } else if (data.share_type === 'study' && data.study?.series?.length) {
          setSelectedSeriesId((data.study.series.find((s) => s.storage_available !== false) ?? data.study.series[0]).id);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '無法載入'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0a0a' }}>
        <div style={{ textAlign: 'center', color: '#aaa' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>🩻</div>
          <div style={{ fontSize: '13px' }}>載入影像中…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', height: '100vh', background: '#0a0a0a' }}>
        <div style={{ fontSize: '40px' }}>⚠️</div>
        <div style={{ color: '#888', fontSize: '16px', fontWeight: '600' }}>{error}</div>
        <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', maxWidth: '320px' }}>
          此連結可能已過期或輸入有誤。請向影像擁有者索取新連結。
        </div>
      </div>
    );
  }

  if (!info) return null;

  // ── Study share: show series selector + viewer ──────────────────────────────
  if (info.share_type === 'study' && info.study) {
    const study = info.study;
    const allSeries = study.series ?? [];
    const activeSeries = allSeries.find(s => s.id === selectedSeriesId) ?? allSeries[0];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>
        {/* Study header */}
        <div style={{
          background: '#111', borderBottom: '1px solid #222',
          padding: '10px 16px', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '20px' }}>🩻</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: '#ddd' }}>
                {study.study_description || (study.modality ? `${study.modality} 影像` : '影像檢查')}
              </div>
              <div style={{ fontSize: '11px', color: '#666' }}>
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
                <button key={s.id} onClick={() => setSelectedSeriesId(s.id)} style={{
                  padding: '5px 12px', borderRadius: '6px', border: '1px solid',
                  borderColor: selectedSeriesId === s.id ? '#1565c0' : '#333',
                  background: selectedSeriesId === s.id ? '#1565c0' : '#1a1a1a',
                  color: s.storage_available === false ? '#a97614' : (selectedSeriesId === s.id ? '#fff' : '#888'),
                  fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap',
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
            請選擇一個序列
          </div>
        )}

        {/* Powered by */}
        <div style={{ background: '#111', borderTop: '1px solid #1a1a1a', padding: '6px 16px', textAlign: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '10px', color: '#333' }}>Powered by HealthKeep</span>
        </div>
      </div>
    );
  }

  // ── Series share: direct viewer ─────────────────────────────────────────────
  if (info.share_type === 'series' && info.series) {
    const series = info.series;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>
        {/* Minimal header */}
        <div style={{
          background: '#111', borderBottom: '1px solid #222',
          padding: '8px 14px', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '18px' }}>🩻</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#ccc' }}>
              {series.series_description || `序列 ${series.series_number ?? '?'}`}
            </div>
            {info.expires_at && (
              <div style={{ fontSize: '11px', color: '#555' }}>
                分享至 {new Date(info.expires_at).toLocaleDateString('zh-TW')}
              </div>
            )}
          </div>
          <span style={{ fontSize: '10px', color: '#333' }}>HealthKeep</span>
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
            無影像資料
          </div>
        )}
      </div>
    );
  }

  return null;
}
