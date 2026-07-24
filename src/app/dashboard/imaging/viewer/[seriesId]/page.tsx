'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getPatientSessionToken } from '@/lib/api';

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

type SeriesDetail = {
  id: string;
  study_id: string;
  series_number: number | null;
  series_description: string | null;
  modality: string | null;
  body_part: string | null;
  instance_count: number;
  available_instance_count: number;
  missing_instance_count: number;
  storage_available: boolean;
  instances: DicomInstance[];
};

type ShareResult = { share_url: string; expires_at: string | null };
const SHARE_EXPIRY_HOURS = 24;

type ErrorPayload = {
  detail?: unknown;
  error?: { message?: string; code?: string; details?: unknown };
};

const MISSING_STORAGE_MESSAGE = '影像原始檔不存在於目前後端環境，請重新上傳 DICOM 或同步 api/uploads/dicom 檔案。';

function authHeaders(): HeadersInit {
  const token = getPatientSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const payload = await res.json().catch(() => null) as ErrorPayload | null;
  if (payload?.error?.message) return payload.error.message;
  if (typeof payload?.detail === 'string') return payload.detail;
  if (res.status === 401) return '登入狀態已過期，請重新登入後再查看影像。';
  return fallback;
}

async function fetchFrameObjectUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include', headers: authHeaders() });
  if (!res.ok) {
    throw new Error(await readApiError(res, '無法載入此切片。'));
  }
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('後端未回傳可顯示的影像格式。');
  }
  return URL.createObjectURL(blob);
}

// ── Tool button style ─────────────────────────────────────────────────────────

const TB: React.CSSProperties = {
  padding: '5px 12px', background: '#2a2a2a', color: '#ddd',
  border: '1px solid #444', borderRadius: '6px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600', flexShrink: 0,
};

function MissingStorageState({ onBack, onUpload }: { onBack: () => void; onUpload: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', height: '100vh', background: '#000', padding: 24 }}>
      <div style={{ fontSize: '36px' }}>⚠️</div>
      <div style={{ color: '#ddd', fontWeight: 800, fontSize: 16 }}>影像原始檔尚未同步</div>
      <div style={{ color: '#aaa', maxWidth: 520, textAlign: 'center', lineHeight: 1.7, fontSize: 13 }}>
        {MISSING_STORAGE_MESSAGE}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={onBack} style={{ ...TB, marginTop: 0 }}>返回影像庫</button>
        <button onClick={onUpload} style={{ ...TB, marginTop: 0, background: '#1565c0', borderColor: '#1565c0', color: '#fff' }}>重新上傳 DICOM</button>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DicomViewerPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const router = useRouter();

  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Viewer state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [wc, setWc] = useState(400);
  const [ww, setWw] = useState(800);
  const [appliedWc, setAppliedWc] = useState(400);
  const [appliedWw, setAppliedWw] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  // Image display state — use "background load" pattern to prevent flicker:
  // displayedUrl = currently visible image (stays until new one is ready)
  // pendingUrl   = URL being loaded in background
  // showSpinner  = only true after 200 ms of waiting (avoids spinner flash on fast loads)
  const [displayedUrl, setDisplayedUrl] = useState('');
  const [pendingUrl, setPendingUrl] = useState('');
  const [imageError, setImageError] = useState(false);
  const [imageErrorMessage, setImageErrorMessage] = useState('');
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const loadSeqRef = useRef(0);
  const displayedUrlRef = useRef('');

  // Share state
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);

  const wcDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wwDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touch state
  const touchStartRef = useRef<{ x: number; y: number; dist: number | null } | null>(null);
  const touchPanStartRef = useRef({ x: 0, y: 0 });

  // ── Load series ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!seriesId) return;
    setLoading(true);
    fetch(`/api/dicom/series/${seriesId}`, { credentials: 'include', headers: authHeaders() })
      .then(async r => r.ok ? r.json() : Promise.reject(await readApiError(r, '載入失敗')))
      .then((data: SeriesDetail) => {
        data.instances.sort((a, b) => (a.instance_number ?? 0) - (b.instance_number ?? 0));
        setSeries(data);
        const first = data.instances[0];
        if (first) {
          const initWc = first.window_center ?? 400;
          const initWw = first.window_width ?? 800;
          setWc(initWc); setAppliedWc(initWc);
          setWw(initWw); setAppliedWw(initWw);
        }
      })
      .catch((e: unknown) => setError(typeof e === 'string' ? e : '載入失敗'))
      .finally(() => setLoading(false));
  }, [seriesId]);

  // ── Frame URL builder ───────────────────────────────────────────────────────

  const frameUrl = useCallback((instanceId: string, fwc: number, fww: number) =>
    `/api/dicom/instances/${instanceId}/frame?wc=${Math.round(fwc)}&ww=${Math.round(fww)}`,
  []);

  // ── Background image loader — no flicker ────────────────────────────────────
  // When the target URL changes, load it silently in the background.
  // Only swap the visible image once the new one is fully decoded.
  // Only show spinner after 200 ms so cached loads look instant.

  const loadFrame = useCallback((url: string) => {
    if (!url) return;
    const seq = ++loadSeqRef.current;
    setPendingUrl(url);
    setImageError(false);
    setImageErrorMessage('');

    // Delayed spinner — only appears if load takes > 200 ms
    if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
    setShowSpinner(false);
    spinnerTimer.current = setTimeout(() => setShowSpinner(true), 200);

    // Cancel previous background load
    if (bgImgRef.current) {
      bgImgRef.current.onload = null;
      bgImgRef.current.onerror = null;
    }

    fetchFrameObjectUrl(url)
      .then((objectUrl) => {
        if (seq !== loadSeqRef.current) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        const img = new window.Image();
        bgImgRef.current = img;
        img.onload = () => {
          if (seq !== loadSeqRef.current) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
          setShowSpinner(false);
          setDisplayedUrl((prev) => {
            if (prev.startsWith('blob:') && prev !== objectUrl) URL.revokeObjectURL(prev);
            return objectUrl;
          });
          setPendingUrl('');
          setImageError(false);
          setImageErrorMessage('');
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
          setShowSpinner(false);
          setImageError(true);
          setImageErrorMessage('切片已下載，但瀏覽器無法顯示此影像格式。');
          setPendingUrl('');
        };
        img.src = objectUrl;
      })
      .catch((err: unknown) => {
        if (seq !== loadSeqRef.current) return;
        if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
        setShowSpinner(false);
        setImageError(true);
        setImageErrorMessage(err instanceof Error ? err.message : '無法載入此切片。');
        setPendingUrl('');
      });
  }, []);

  useEffect(() => {
    displayedUrlRef.current = displayedUrl;
  }, [displayedUrl]);

  useEffect(() => () => {
    if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
    if (displayedUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(displayedUrlRef.current);
  }, []);

  // ── Preload surrounding frames ───────────────────────────────────────────────
  // Use authenticated fetch so localStorage-only sessions can still preload.

  const preloadAround = useCallback((idx: number, instances: DicomInstance[], fwc: number, fww: number) => {
    const lo = Math.max(0, idx - 1);
    const hi = Math.min(instances.length - 1, idx + 4);
    for (let i = lo; i <= hi; i++) {
      if (i === idx) continue;
      const url = frameUrl(instances[i].id, fwc, fww);
      void fetch(url, { credentials: 'include', headers: authHeaders() }).catch(() => {});
    }
  }, [frameUrl]);

  // ── When target frame changes, trigger background load ──────────────────────

  useEffect(() => {
    if (!series || series.instances.length === 0) return;
    if (series.storage_available === false) return;
    const inst = series.instances[currentIdx];
    if (!inst) return;
    const url = frameUrl(inst.id, appliedWc, appliedWw);
    loadFrame(url);
    preloadAround(currentIdx, series.instances, appliedWc, appliedWw);
  }, [currentIdx, appliedWc, appliedWw, series, frameUrl, loadFrame, preloadAround]);

  // ── Windowing with debounce ─────────────────────────────────────────────────

  const handleWcChange = (val: number) => {
    setWc(val);
    if (wcDebounce.current) clearTimeout(wcDebounce.current);
    wcDebounce.current = setTimeout(() => setAppliedWc(val), 500);
  };
  const handleWwChange = (val: number) => {
    setWw(val);
    if (wwDebounce.current) clearTimeout(wwDebounce.current);
    wwDebounce.current = setTimeout(() => setAppliedWw(val), 500);
  };

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!series) return;
    const onKey = (e: KeyboardEvent) => {
      const total = series.instances.length;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setCurrentIdx(i => Math.min(i + 1, total - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setCurrentIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'f' || e.key === 'F') {
        setFullscreen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [series]);

  // ── Mouse wheel ─────────────────────────────────────────────────────────────

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!series) return;
    if (e.ctrlKey || e.metaKey) {
      setZoom(z => Math.max(0.2, Math.min(10, z * (e.deltaY > 0 ? 0.9 : 1.1))));
    } else {
      const total = series.instances.length;
      if (e.deltaY > 0) setCurrentIdx(i => Math.min(i + 1, total - 1));
      else              setCurrentIdx(i => Math.max(i - 1, 0));
    }
  }, [series]);

  // ── Mouse drag (pan) ─────────────────────────────────────────────────────────

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

  // ── Touch gestures ──────────────────────────────────────────────────────────

  const getTouchDist = (touches: React.TouchList): number => {
    if (touches.length < 2) return 0;
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  };

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: null };
      touchPanStartRef.current = { ...pan };
    } else if (e.touches.length === 2) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: getTouchDist(e.touches) };
    }
  }, [pan]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touchStartRef.current || !series) return;
    if (e.touches.length === 2 && touchStartRef.current.dist != null) {
      const newDist = getTouchDist(e.touches);
      const scale = newDist / touchStartRef.current.dist;
      setZoom(z => Math.max(0.2, Math.min(10, z * scale)));
      touchStartRef.current = { ...touchStartRef.current, dist: newDist };
    } else if (e.touches.length === 1 && touchStartRef.current.dist === null) {
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      setPan({
        x: touchPanStartRef.current.x + dx / zoom,
        y: touchPanStartRef.current.y + dy / zoom,
      });
    }
  }, [series, zoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !series) return;
    const start = touchStartRef.current;
    if (e.changedTouches.length === 1 && start.dist === null) {
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        const total = series.instances.length;
        setCurrentIdx(i => dx < 0 ? Math.min(i + 1, total - 1) : Math.max(i - 1, 0));
      }
    }
    touchStartRef.current = null;
  }, [series]);

  // ── Reset view ──────────────────────────────────────────────────────────────

  const resetView = () => {
    setZoom(1); setPan({ x: 0, y: 0 });
    const first = series?.instances[0];
    if (first) {
      const wc0 = first.window_center ?? 400;
      const ww0 = first.window_width ?? 800;
      setWc(wc0); setAppliedWc(wc0);
      setWw(ww0); setAppliedWw(ww0);
    }
  };

  // ── Share — build URL from window.location so protocol/host are always correct

  const handleShare = async () => {
    if (!series) return;
    setSharing(true);
    try {
      const r = await fetch('/api/dicom/share', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ series_id: series.id, expiry_hours: SHARE_EXPIRY_HOURS }),
      });
      if (r.ok) {
        const data = await r.json();
        // Build URL from current window origin — avoids backend returning wrong host/port/protocol
        const shareUrl = `${window.location.origin}/viewer/${data.share_token}`;
        setShareResult({ share_url: shareUrl, expires_at: data.expires_at });
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 3000);
      }
    } finally {
      setSharing(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000' }}>
        <div style={{ color: '#aaa', fontSize: '14px' }}>載入影像中...</div>
      </div>
    );
  }

  if (error || !series) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', height: '100vh', background: '#000' }}>
        <div style={{ fontSize: '36px' }}>⚠️</div>
        <div style={{ color: '#aaa' }}>{error || '找不到此序列'}</div>
        <button onClick={() => router.back()} style={{ ...TB, marginTop: '8px' }}>返回</button>
      </div>
    );
  }

  if (series.storage_available === false) {
    return <MissingStorageState onBack={() => router.push('/dashboard/imaging')} onUpload={() => router.push('/dashboard/imaging/upload')} />;
  }

  const instances = series.instances;
  const inst = instances[currentIdx];
  if (!inst) return null;

  const isLoading = !!pendingUrl && !imageError;

  const viewerStyle: React.CSSProperties = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexDirection: 'column', height: '100vh', background: '#000' };

  return (
    <div style={viewerStyle}>

      {/* ── Top toolbar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px',
        background: '#111', borderBottom: '1px solid #333', flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        <button onClick={() => router.back()} style={TB}>← 返回</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {series.modality && (
              <span style={{
                background: '#1565c0', color: '#fff', padding: '1px 7px',
                borderRadius: '4px', fontSize: '11px', fontWeight: '700',
              }}>
                {series.modality}
              </span>
            )}
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#ddd' }}>
              {series.series_description || `序列 ${series.series_number ?? '?'}`}
            </span>
            {/* Subtle loading dot in toolbar — doesn't obscure the image */}
            {isLoading && showSpinner && (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4caf50', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite' }} />
            )}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
            {inst.columns}×{inst.rows} px
            {series.body_part ? ` · ${series.body_part}` : ''}
            {' · '}分享預設 24 小時；急診請用急診保命連結
          </div>
        </div>

        <button onClick={() => setZoom(z => Math.min(z * 1.25, 10))} style={TB}>+</button>
        <span style={{ color: '#888', fontSize: '12px', minWidth: '38px', textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom(z => Math.max(z * 0.8, 0.2))} style={TB}>−</button>
        <button onClick={resetView} style={TB} title="重設視角">↺</button>
        <button
          onClick={() => setFullscreen(v => !v)}
          style={{ ...TB, background: fullscreen ? '#1565c0' : '#2a2a2a' }}
          title="全螢幕 (F)"
        >
          {fullscreen ? '⊡' : '⊞'}
        </button>
        <button
          onClick={handleShare}
          disabled={sharing}
          title="建立分享連結"
          style={{ ...TB, background: sharing ? '#333' : '#1565c0', borderColor: '#1565c0' }}
        >
          {sharing ? '...' : shareUrlCopied ? '✓ 已複製' : '🔗 分享'}
        </button>
      </div>

      {/* Share URL banner */}
      {shareResult && (
        <div style={{
          background: '#1a2744', borderBottom: '1px solid #2a3a6a',
          padding: '8px 14px', display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0,
        }}>
          <span style={{ color: '#7cb3ff', fontSize: '12px', flex: 1, wordBreak: 'break-all' }}>
            🔗 {shareResult.share_url}
            <span style={{ color: '#a6b8d8' }}> · 24 小時有效；此連結只開放影像，不含急診紅區或 break-glass 稽核。</span>
          </span>
          <button onClick={async () => {
            await navigator.clipboard.writeText(shareResult.share_url);
            setShareUrlCopied(true);
            setTimeout(() => setShareUrlCopied(false), 2000);
          }} style={{ ...TB, flexShrink: 0 }}>
            {shareUrlCopied ? '✓' : '複製'}
          </button>
          <button onClick={() => setShareResult(null)} style={{ ...TB, flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* ── Image canvas ─────────────────────────────────────────────────────── */}
      <div
        style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Error overlay */}
        {imageError && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column', gap: '8px', zIndex: 5,
          }}>
            <span style={{ fontSize: '32px' }}>⚠️</span>
            <span style={{ color: '#aaa', fontSize: '13px', maxWidth: 360, textAlign: 'center', lineHeight: 1.6 }}>
              {imageErrorMessage || '無法渲染此切片'}
            </span>
          </div>
        )}

        {/* Frame image — always visible; never unmounted.
            The image stays at full opacity showing the previous frame
            while the next one loads in the background.
            A subtle dim (opacity 0.6) signals loading is in progress. */}
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {displayedUrl && !imageError && (
            <img
              src={displayedUrl}
              alt={`切片 ${currentIdx + 1}`}
              draggable={false}
              style={{
                maxWidth: '100%', maxHeight: '100%',
                // Dim slightly while loading next — keeps the old image visible
                opacity: isLoading && showSpinner ? 0.55 : 1,
                transition: 'opacity 0.15s ease',
                transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: 'center center',
              }}
            />
          )}
          {/* Show placeholder while very first frame loads */}
          {!displayedUrl && !imageError && (
            <div style={{ color: '#444', fontSize: '13px' }}>載入第一張切片中…</div>
          )}
        </div>

        {/* Slice counter */}
        <div style={{
          position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.55)', borderRadius: '12px', padding: '4px 14px',
          color: '#ddd', fontSize: '12px', fontWeight: '600', pointerEvents: 'none',
        }}>
          {currentIdx + 1} / {instances.length}
        </div>

        {/* Instance number (top-left) */}
        {inst.instance_number != null && (
          <div style={{
            position: 'absolute', top: '14px', left: '14px',
            color: '#555', fontSize: '11px', pointerEvents: 'none',
          }}>
            IM #{inst.instance_number}
          </div>
        )}
      </div>

      {/* ── Bottom controls ───────────────────────────────────────────────────── */}
      <div style={{
        background: '#111', borderTop: '1px solid #333',
        padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: '8px',
        flexShrink: 0,
      }}>
        {instances.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ color: '#666', fontSize: '11px', width: '52px', flexShrink: 0 }}>切片</span>
            <input
              type="range" min={0} max={instances.length - 1} value={currentIdx}
              onChange={e => setCurrentIdx(parseInt(e.target.value))}
              style={{ flex: 1, accentColor: '#3e6b7e', cursor: 'pointer' }}
            />
            <span style={{ color: '#666', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>
              {currentIdx + 1}/{instances.length}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#555', fontSize: '11px', width: '52px', flexShrink: 0 }}>WC</span>
          <input
            type="range" min={-1000} max={3000} value={wc}
            onChange={e => handleWcChange(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: '#4caf50', cursor: 'pointer' }}
          />
          <span style={{ color: '#666', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>
            {Math.round(wc)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#555', fontSize: '11px', width: '52px', flexShrink: 0 }}>WW</span>
          <input
            type="range" min={1} max={4000} value={ww}
            onChange={e => handleWwChange(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: '#ff9800', cursor: 'pointer' }}
          />
          <span style={{ color: '#666', fontSize: '11px', width: '52px', textAlign: 'right', flexShrink: 0 }}>
            {Math.round(ww)}
          </span>
        </div>

        <div style={{ color: '#3a3a3a', fontSize: '10px', textAlign: 'center' }}>
          ← → 切換切片 · 滾輪切換 · Ctrl+滾輪縮放 · 拖曳平移 · F 全螢幕 · 觸控：滑動切片 · 雙指縮放
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
