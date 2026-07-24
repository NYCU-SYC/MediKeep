'use client'

// CMO-side document upload — the CMO uploads a source document on the patient's
// behalf. Designed for minimal typing: dropping/selecting a file auto-detects the
// document type + date from the file name, and the institution is a one-click
// chip. Posts multipart to POST /api/cmo/patients/{id}/documents.

import { useCallback, useRef, useState } from 'react'
import { extractDateFromText } from '@/lib/cmoReview'

const DOC_TYPES = [
  { value: 'lab_report', label: '🧪 檢驗報告' },
  { value: 'prescription', label: '💊 處方箋' },
  { value: 'discharge', label: '🏥 出院摘要' },
  { value: 'image', label: '🩻 影像報告' },
  { value: 'nhia_card', label: '🪪 健保快易通' },
  { value: 'other', label: '📄 其他文件' },
]

const COMMON_HOSPITALS = ['台大醫院', '臺北榮總', '林口長庚', '馬偕醫院', '北醫附醫', '亞東醫院', '成大醫院', '中國醫附醫', '高醫附醫', '花蓮慈濟']

// Heuristic: guess the document type + date from the file name so the CMO does
// not have to set them by hand. The CMO can still override both.
function inferDocMetaFromFilename(name: string): { docType?: string; docDate?: string } {
  const lower = name.toLowerCase()
  let docType: string | undefined
  if (/健保|快易通|nhi/.test(lower)) docType = 'nhia_card'
  else if (/處方|藥|prescription|\brx\b/.test(lower)) docType = 'prescription'
  else if (/出院|住院|discharge/.test(lower)) docType = 'discharge'
  else if (/\.(jpe?g|png|dcm|tiff?|bmp)$/.test(lower) || /影像|超音波|x-?ray|\bct\b|\bmri\b|echo|ultrasound/.test(lower)) docType = 'image'
  else if (/檢驗|檢查|報告|抽血|生化|lab|blood|hba1c|cbc|urine/.test(lower)) docType = 'lab_report'

  // Shared parser also understands ROC-era dates (114/07/21, 1140721).
  const docDate = extractDateFromText(name)

  return { docType, docDate }
}

// Text-extractable file extensions (NHI exports and many reports are HTML/TXT).
const TEXT_LIKE = /\.(html?|txt|csv|json|xml)$/i

// Read the actual document text and pull type/date/institution from the content —
// more accurate than the file name. Chinese-specific patterns keep false
// positives low. Scanned images / PDFs are not text and need OCR instead.
function extractDocMetaFromText(text: string): { docType?: string; docDate?: string; hospital?: string } {
  let docType: string | undefined
  if (/健保|快易通|就醫紀錄/.test(text)) docType = 'nhia_card'
  else if (/處方|藥品明細|領藥|用藥明細/.test(text)) docType = 'prescription'
  else if (/出院病歷摘要|出院摘要|入出院/.test(text)) docType = 'discharge'
  else if (/影像報告|放射科|超音波|電腦斷層|磁振造影|X\s*光/i.test(text)) docType = 'image'
  else if (/檢驗報告|檢驗數值|生化|血液常規|檢查報告/.test(text)) docType = 'lab_report'

  // Taiwanese reports commonly print 民國 dates; the shared parser covers both.
  const docDate = extractDateFromText(text)

  let hospital: string | undefined
  const known = COMMON_HOSPITALS.find((name) => text.includes(name))
  if (known) hospital = known
  else {
    const hospitalMatch = text.match(/[一-龥]{2,10}(醫院|診所|醫學中心)/)
    if (hospitalMatch) hospital = hospitalMatch[0]
  }

  return { docType, docDate, hospital }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function CmoDocumentUpload({
  patientId,
  memberName,
  onUploaded,
}: {
  patientId: string
  memberName?: string
  onUploaded?: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState('lab_report')
  const [docDate, setDocDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [hiddenFromPatient, setHiddenFromPatient] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [extractNote, setExtractNote] = useState('')

  const pickFile = useCallback((picked: File) => {
    setFile(picked)
    setExtractNote('')
    // First guess from the file name (works for any file, including images).
    const meta = inferDocMetaFromFilename(picked.name)
    if (meta.docType) setDocType(meta.docType)
    if (meta.docDate) setDocDate(meta.docDate)

    // For text-extractable files, read the content and refine type/date/院所.
    const textLike = TEXT_LIKE.test(picked.name) || picked.type.startsWith('text/') || picked.type === 'application/json'
    if (textLike && picked.size <= 2_000_000) {
      const reader = new FileReader()
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : ''
        if (!text) return
        const extracted = extractDocMetaFromText(text.slice(0, 20000))
        if (extracted.docType) setDocType(extracted.docType)
        if (extracted.docDate) setDocDate(extracted.docDate)
        const hospital = extracted.hospital
        if (hospital) setNote((prev) => (prev.trim() ? prev : hospital))
        setExtractNote('已讀取文件內容，自動帶入類型／日期／院所（可修改）')
      }
      reader.readAsText(picked)
    } else {
      setExtractNote('影像／掃描檔僅能依檔名判斷；內容辨識需另接 OCR')
    }
  }, [])

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('member_name', memberName || '本人')
      fd.append('doc_type', docType)
      if (note.trim()) fd.append('note', note.trim())
      if (docDate) fd.append('doc_date', new Date(docDate).toISOString())
      fd.append('hidden_from_patient', hiddenFromPatient ? 'true' : 'false')

      const token = typeof window !== 'undefined' ? window.localStorage.getItem('healthkeep_cmo_session_token') : null
      const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `idem_${Date.now()}_${Math.random()}`
      const res = await fetch(`/api/cmo/patients/${patientId}/documents`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Idempotency-Key': idempotencyKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        const detail = err && typeof err === 'object'
          ? (err.detail || err?.error?.message)
          : null
        throw new Error(typeof detail === 'string' ? detail : '上傳失敗')
      }
      setFile(null)
      setNote('')
      setDocType('lab_report')
      setDocDate(todayISO())
      setMessage('已上傳文件到來源資料。')
      onUploaded?.()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上傳失敗，請稍後再試。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cmo-card cmo-section">
      <div className="cmo-title-row" style={{ marginBottom: 8 }}>
        <div>
          <div className="cmo-kpi-label">CMO 上傳文件</div>
          <h3 className="cmo-section-title" style={{ margin: '2px 0 0' }}>代病人上傳來源文件</h3>
          <div className="cmo-subtitle">選檔後自動判斷類型與日期；院所點選即可，不用打字。</div>
        </div>
      </div>

      <div
        onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => { event.preventDefault(); setDragOver(false); const dropped = event.dataTransfer.files[0]; if (dropped) pickFile(dropped) }}
        onClick={() => inputRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? '#3e6b7e' : file ? '#2e8b57' : '#c8d4dc'}`, borderRadius: 12, padding: '22px 16px', textAlign: 'center', background: file ? '#f0fff4' : '#fafcfd', cursor: 'pointer' }}
      >
        {file ? (
          <div>
            <div style={{ fontWeight: 800, color: '#22313f' }}>📄 {file.name}</div>
            <div className="cmo-subtitle">{(file.size / 1024).toFixed(1)} KB · 點擊更換</div>
          </div>
        ) : (
          <div className="cmo-subtitle">拖曳或點擊選擇文件（PDF／JPG／PNG／DOC…）</div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.html,.htm,.jpg,.jpeg,.png,.doc,.docx"
        style={{ display: 'none' }}
        onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) pickFile(chosen) }}
      />
      {extractNote && <div className="cmo-subtitle" style={{ marginTop: 6, color: '#33596a' }}>🔎 {extractNote}</div>}

      <div className="cmo-form-grid" style={{ marginTop: 12 }}>
        <label>
          <span className="cmo-kpi-label">文件類型（自動判斷）</span>
          <select className="cmo-select" value={docType} onChange={(event) => setDocType(event.target.value)}>
            {DOC_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
          </select>
        </label>
        <label>
          <span className="cmo-kpi-label">文件日期（自動判斷）</span>
          <input className="cmo-input" type="date" value={docDate} onChange={(event) => setDocDate(event.target.value)} />
        </label>
      </div>

      <div style={{ marginTop: 10 }}>
        <span className="cmo-kpi-label">院所 / 備註 · 點選免打字</span>
        <div className="cmo-chipbar" style={{ margin: '6px 0' }}>
          {COMMON_HOSPITALS.map((hospital) => (
            <button key={hospital} type="button" className="cmo-chip" onClick={() => setNote(note.trim() ? `${note.trim()} ${hospital}` : hospital)}>＋ {hospital}</button>
          ))}
        </div>
        <input className="cmo-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：台大醫院 2025/01 健檢報告" />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={hiddenFromPatient} onChange={(event) => setHiddenFromPatient(event.target.checked)} />
        <span className="cmo-kpi-label" style={{ margin: 0 }}>先不顯示給病人（CMO 整理後再決定）</span>
      </label>

      <div className="cmo-chipbar" style={{ marginTop: 12, alignItems: 'center' }}>
        <button type="button" className="cmo-button primary" disabled={!file || busy} onClick={() => void submit()}>
          {busy ? '上傳中…' : '上傳文件'}
        </button>
        {message && <span className="cmo-subtitle" style={{ color: message.includes('失敗') ? '#a03a30' : '#2e8b57' }}>{message}</span>}
      </div>
    </section>
  )
}
