'use client';

// 病人/家屬端：產生「急診保命連結」交給現場醫師，並查看誰存取過、隨時撤銷。

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import { useToast } from '../toast-context';

type Link = {
  id: string; token: string; url: string; label: string | null;
  scope: string;
  expires_at: string | null; revoked_at: string | null; active: boolean;
  access_count: number; last_accessed_at: string | null; created_at: string | null;
};
type Access = { accessor: string; org: string | null; token: string | null; ip?: string | null; user_agent?: string | null; at: string | null };

type QrMatrix = boolean[][];

function fmt(d: string | null): string {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleString('zh-TW');
}

const QR_VERSION = 5;
const QR_SIZE = 17 + QR_VERSION * 4;
const QR_DATA_CODEWORDS = 108;
const QR_EC_CODEWORDS = 26;
const GF_EXP = (() => {
  const exp = new Array<number>(512);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  return exp;
})();
const GF_LOG = (() => {
  const log = new Array<number>(256).fill(0);
  for (let i = 0; i < 255; i += 1) log[GF_EXP[i]] = i;
  return log;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((coef, j) => {
      next[j] ^= coef;
      next[j + 1] ^= gfMul(coef, GF_EXP[i]);
    });
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const result = new Array(degree).fill(0);
  data.forEach((value) => {
    const factor = value ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < degree; i += 1) {
      result[i] ^= gfMul(gen[i + 1], factor);
    }
  });
  return result;
}

function bitsToCodewords(bits: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] ?? 0);
    out.push(value);
  }
  return out;
}

function appendBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function encodeQrPayload(text: string): number[] | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > 106) return null;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((b) => appendBits(bits, b, 8));
  const capacityBits = QR_DATA_CODEWORDS * 8;
  for (let i = 0; i < Math.min(4, capacityBits - bits.length); i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = bitsToCodewords(bits);
  for (let pad = 0xec; data.length < QR_DATA_CODEWORDS; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);
  return data;
}

function drawFinder(matrix: QrMatrix, reserved: QrMatrix, left: number, top: number): void {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const r = top + y;
      const c = left + x;
      if (r < 0 || r >= QR_SIZE || c < 0 || c >= QR_SIZE) continue;
      const inPattern = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      const dark = inPattern && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
      matrix[r][c] = dark;
      reserved[r][c] = true;
    }
  }
}

function drawAlignment(matrix: QrMatrix, reserved: QrMatrix, centerX: number, centerY: number): void {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const r = centerY + y;
      const c = centerX + x;
      const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      matrix[r][c] = dark;
      reserved[r][c] = true;
    }
  }
}

function reserveFormatAreas(reserved: QrMatrix): void {
  for (let i = 0; i <= 5; i += 1) reserved[8][i] = true;
  reserved[8][7] = true;
  reserved[8][8] = true;
  reserved[7][8] = true;
  for (let i = 9; i < 15; i += 1) reserved[14 - i][8] = true;
  for (let i = 0; i < 8; i += 1) reserved[QR_SIZE - 1 - i][8] = true;
  for (let i = 8; i < 15; i += 1) reserved[8][QR_SIZE - 15 + i] = true;
}

function drawFormatBits(matrix: QrMatrix): void {
  const eccLow = 1;
  const mask = 0;
  const data = (eccLow << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) ? 0x537 : 0);
  }
  const bits = ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) matrix[8][i] = bit(i);
  matrix[8][7] = bit(6);
  matrix[8][8] = bit(7);
  matrix[7][8] = bit(8);
  for (let i = 9; i < 15; i += 1) matrix[14 - i][8] = bit(i);
  for (let i = 0; i < 8; i += 1) matrix[QR_SIZE - 1 - i][8] = bit(i);
  for (let i = 8; i < 15; i += 1) matrix[8][QR_SIZE - 15 + i] = bit(i);
}

function makeQrMatrix(text: string): QrMatrix | null {
  const data = encodeQrPayload(text);
  if (!data) return null;
  const codewords = [...data, ...reedSolomon(data, QR_EC_CODEWORDS)];
  const matrix: QrMatrix = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));
  const reserved: QrMatrix = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));

  drawFinder(matrix, reserved, 0, 0);
  drawFinder(matrix, reserved, QR_SIZE - 7, 0);
  drawFinder(matrix, reserved, 0, QR_SIZE - 7);
  drawAlignment(matrix, reserved, 30, 30);
  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }
  matrix[QR_SIZE - 8][8] = true;
  reserved[QR_SIZE - 8][8] = true;
  reserveFormatAreas(reserved);

  const bits = codewords.flatMap((value) => Array.from({ length: 8 }, (_, i) => (value >>> (7 - i)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let col = QR_SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let rowStep = 0; rowStep < QR_SIZE; rowStep += 1) {
      const row = upward ? QR_SIZE - 1 - rowStep : rowStep;
      for (let dx = 0; dx < 2; dx += 1) {
        const c = col - dx;
        if (reserved[row][c]) continue;
        if (bitIndex < bits.length) {
          const raw = bits[bitIndex] === 1;
          const masked = (row + c) % 2 === 0 ? !raw : raw;
          matrix[row][c] = masked;
          bitIndex += 1;
        } else {
          matrix[row][c] = false;
        }
      }
    }
    upward = !upward;
  }
  drawFormatBits(matrix);
  return matrix;
}

function QrCode({ value }: { value: string }) {
  const matrix = React.useMemo(() => makeQrMatrix(value), [value]);
  if (!matrix) {
    return (
      <div style={qrFallback}>
        連結過長，請使用複製連結。
      </div>
    );
  }
  const cell = 6;
  const quiet = 4;
  const size = (matrix.length + quiet * 2) * cell;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="急診連結 QR Code" shapeRendering="crispEdges" style={{ display: 'block', background: '#fff', borderRadius: 8, maxWidth: '100%', height: 'auto' }}>
      <rect width={size} height={size} fill="#fff" />
      {matrix.flatMap((row, y) => row.map((dark, x) => dark ? (
        <rect key={`${x}-${y}`} x={(x + quiet) * cell} y={(y + quiet) * cell} width={cell} height={cell} fill="#0f172a" />
      ) : null))}
    </svg>
  );
}

function scopeLabel(scope: string): string {
  const parts = scope.split(',').map((s) => s.trim()).filter(Boolean);
  const labels: Record<string, string> = {
    red_zone: '保命紅區',
    problems: '疾病清單',
    medications: '現用藥',
    vitals: '生命徵象',
    documents: '原始文件',
    dicom: 'DICOM 影像',
  };
  return parts.map((part) => labels[part] ?? part).join('、');
}

function frontendEmergencyUrl(link: Link): string {
  if (typeof window === 'undefined' || !link.token) return link.url;
  return `${window.location.origin}/emergency/${encodeURIComponent(link.token)}`;
}

export default function EmergencyLinksPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [accesses, setAccesses] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [ttlHours, setTtlHours] = useState(24);
  const [incDocs, setIncDocs] = useState(false);
  const [incImaging, setIncImaging] = useState(false);
  const [newLinkId, setNewLinkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/patients/me/emergency-links') as { links: Link[]; accesses: Access[] };
      setLinks(d.links ?? []); setAccesses(d.accesses ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const created = await api.post('/api/patients/me/emergency-links', {
        ttl_hours: ttlHours,
        label: label.trim() || null,
        include_documents: incDocs,
        include_imaging: incImaging,
      }) as Link;
      setLinks(prev => [created, ...prev.filter(l => l.id !== created.id)]);
      setNewLinkId(created.id);
      setLabel('');
      await load();
      showToast(`已產生急診連結（${ttlHours} 小時有效）`, 'success');
    } catch (err) {
      const message = err instanceof ApiError && err.message && err.message !== 'Request failed'
        ? err.message
        : '請稍後再試';
      showToast(`產生失敗：${message}`, 'error');
    }
    finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('撤銷後此連結立即失效，醫師將無法再開啟。確定撤銷？')) return;
    try { await api.delete(`/api/patients/me/emergency-links/${id}`); await load(); showToast('已撤銷', 'success'); }
    catch { showToast('撤銷失敗', 'error'); }
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); showToast('已複製連結，可傳給醫師或家人', 'success'); }
    catch { showToast('複製失敗，請手動選取', 'error'); }
  };

  const toggleAdvancedScope = (kind: 'documents' | 'imaging', checked: boolean) => {
    if (!checked) {
      if (kind === 'documents') setIncDocs(false);
      else setIncImaging(false);
      return;
    }
    const ok = window.confirm(
      kind === 'documents'
        ? '開放原始文件後，持有此連結的人可在有效期限內查看檢驗、出院摘要等原始檔。請只在現場醫師需要確認 evidence 時開啟。確定開放？'
        : '開放 DICOM 後，持有此連結的人可在有效期限內查看影像 viewer。請只在現場醫師需要確認影像時開啟。確定開放？'
    );
    if (!ok) return;
    if (kind === 'documents') setIncDocs(true);
    else setIncImaging(true);
  };

  const active = links.filter(l => l.active);
  const inactive = links.filter(l => !l.active);

  return (
    <div className="page-wrap" style={{ maxWidth: 760, margin: '0 auto' }}>
      <button onClick={() => router.back()} style={back}>← 返回</button>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: '8px 0 2px' }}>急診保命連結</h1>
      <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, margin: '0 0 16px' }}>
        預設只開放保命紅區、疾病、用藥與生命徵象。醫師輸入姓名後才可檢視；
        <strong>每次存取都會記錄</strong>，你也可以隨時撤銷。只有在現場醫師明確需要時，才加開原始文件或影像。
      </p>

      <section style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>產生新連結</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="備註（選填）例：給台大急診"
            style={{ flex: 1, minWidth: 200, border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14 }} />
          <select value={ttlHours} onChange={e => setTtlHours(Number(e.target.value))}
            style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: '10px 12px', fontSize: 14, background: '#fff', color: '#334155', fontWeight: 700 }}>
            <option value={1}>1 小時</option>
            <option value={6}>6 小時</option>
            <option value={24}>24 小時</option>
            <option value={72}>72 小時</option>
          </select>
          <button onClick={create} disabled={busy}
            style={{ background: '#be123c', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 850, fontSize: 14, cursor: 'pointer' }}>
            {busy ? '產生中…' : '＋ 產生連結'}
          </button>
        </div>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 850, color: '#334155', marginBottom: 8 }}>進階開放範圍（預設關閉）</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#334155' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={incDocs} onChange={e => toggleAdvancedScope('documents', e.target.checked)} />
              一併開放原始文件（檢驗 / 出院摘要等）
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={incImaging} onChange={e => toggleAdvancedScope('imaging', e.target.checked)} />
              一併開放影像（DICOM）連結
            </label>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
            加開後，持有連結的人可在有效期限內查看更多原始資料。請只在現場醫療人員需要確認 evidence 時使用。
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
          產生後會顯示可掃描 QR Code。HealthKeep 直接在本頁產生 QR，不會把急診連結送到第三方 QR 服務。
        </div>
      </section>

      {loading ? <div style={{ color: '#64748b', padding: 16 }}>載入中…</div> : (
        <>
          <h2 style={h2}>有效連結 {active.length > 0 && <span style={{ color: '#15803d' }}>({active.length})</span>}</h2>
          {active.length === 0 ? <Empty>目前沒有有效連結。需要時按上方「產生連結」。</Empty> : active.map(l => {
            const url = frontendEmergencyUrl(l);
            return (
            <div key={l.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{l.label || '急診保命連結'}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>有效至 {fmt(l.expires_at)} · 已被開啟 {l.access_count} 次</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>範圍：{scopeLabel(l.scope)}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 999, background: newLinkId === l.id ? '#fee2e2' : '#dcfce7', color: newLinkId === l.id ? '#be123c' : '#15803d' }}>
                  {newLinkId === l.id ? '剛產生' : '有效'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px' }}>
                <code style={{ flex: 1, fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</code>
                <button onClick={() => copy(url)} style={smallBtn}>複製</button>
                <a href={url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: 'none' }}>開啟</a>
                <button onClick={() => revoke(l.id)} style={{ ...smallBtn, color: '#be123c', borderColor: '#fecaca' }}>撤銷</button>
              </div>
              <div style={qrCard}>
                <QrCode value={url} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 850, color: '#0f172a' }}>給現場醫師掃描</div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 4 }}>
                    掃描後醫師仍需留下姓名才會看到資料。若醫師要求原始文件或影像，請回到上方重新產生含文件/影像的新連結。
                  </div>
                </div>
              </div>
            </div>
          )})}

          <h2 style={h2}>誰看過保命資料</h2>
          {accesses.length === 0 ? <Empty>尚無存取紀錄。醫師開啟連結後會出現在這裡。</Empty> : (
            <div style={card}>
              {accesses.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: i < accesses.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div>
                    <strong style={{ color: '#0f172a' }}>{a.accessor}</strong>{a.org ? <span style={{ color: '#64748b', fontSize: 13 }}> · {a.org}</span> : ''}
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {a.ip ? `IP ${a.ip}` : 'IP 未記錄'}{a.user_agent ? ` · ${a.user_agent.slice(0, 80)}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>{fmt(a.at)}</div>
                </div>
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <>
              <h2 style={h2}>已失效 / 已撤銷</h2>
              <div style={card}>
                {inactive.map((l, i) => (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: i < inactive.length - 1 ? '1px solid #f1f5f9' : 'none', color: '#94a3b8' }}>
                    <span style={{ fontSize: 13 }}>{l.label || '急診保命連結'}</span>
                    <span style={{ fontSize: 12 }}>{l.revoked_at ? '已撤銷' : '已過期'} · {fmt(l.revoked_at || l.expires_at)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ ...card, color: '#64748b', fontSize: 13 }}>{children}</div>;
}

const back: React.CSSProperties = { border: '1px solid #e2e8f0', background: '#fff', color: '#334155', borderRadius: 10, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, marginBottom: 12 };
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 850, color: '#0f172a', margin: '18px 0 8px' };
const smallBtn: React.CSSProperties = { border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 8, padding: '6px 10px', fontWeight: 800, fontSize: 12, cursor: 'pointer', flexShrink: 0 };
const qrCard: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, flexWrap: 'wrap' };
const qrFallback: React.CSSProperties = { width: 180, minHeight: 180, border: '1px dashed #cbd5e1', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#64748b', fontSize: 12, padding: 12 };
