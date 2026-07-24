'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useSync } from '@/lib/sync'

type Section = 'allergies' | 'implants' | 'mri' | 'profile' | 'family'
type Dict = Record<string, unknown>

interface Allergy {
  id: number; category: string; substance: string; reaction: string | null; reaction_description?: string | null
  severity: string | null; status?: string | null; source?: string | null; tier?: number | null; onset_date?: string | null; note: string | null
}
interface Implant { id: number; type: string; subtype?: string | null; model?: string | null; body_site: string | null; implant_date: string | null; hospital?: string | null; note: string | null }
interface FamilyHistory { id: number; relation: string; condition: string; onset_age: number | null; deceased?: boolean | null; cause_of_death?: string | null; age_at_death?: number | null; note: string | null }
interface Profile {
  blood_type: string | null; rh_factor: string | null; height_cm: number | null; weight_kg: number | null; occupation: string | null
  smoking_status: string | null; smoking_pack_years: number | null; alcohol_status: string | null; betel_nut_status: string | null
  has_hep_b: boolean | null; has_hep_c: boolean | null; egfr_value: number | null; ckd_stage: string | null; is_dialysis: boolean | null
  dialysis_modality: string | null; dialysis_schedule: string | null; emergency_contact_name: string | null; emergency_contact_relation: string | null; emergency_contact_phone: string | null
  egfr_date: string | null; blood_type_source: string | null
}
interface MriSafety {
  has_pacemaker: boolean | null; pacemaker_detail: string | null; has_fixed_denture: boolean | null; has_removable_denture: boolean | null
  has_tattoo: boolean | null; tattoo_detail: string | null; has_eyebrow_tattoo: boolean | null; eyebrow_tattoo_year: number | null
  has_hair_dye: boolean | null; has_metal_implant: boolean | null; metal_implant_detail: string | null; has_other: boolean | null; other_detail: string | null
}
interface PatientData { user: { display_name: string } }
type RzTemplate = { key: string; label: string; kind: 'allergy' | 'device' | 'profile' | 'medication'; tier?: number; payload: Record<string, unknown> }

const blankProfile: Profile = {
  blood_type: '', rh_factor: '', height_cm: null, weight_kg: null, occupation: '', smoking_status: '', smoking_pack_years: null,
  alcohol_status: '', betel_nut_status: '', has_hep_b: false, has_hep_c: false, egfr_value: null, ckd_stage: '', is_dialysis: false,
  dialysis_modality: '', dialysis_schedule: '', emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '',
  egfr_date: '', blood_type_source: '',
}
const blankMri: MriSafety = {
  has_pacemaker: false, pacemaker_detail: '', has_fixed_denture: false, has_removable_denture: false, has_tattoo: false, tattoo_detail: '',
  has_eyebrow_tattoo: false, eyebrow_tattoo_year: null, has_hair_dye: false, has_metal_implant: false, metal_implant_detail: '', has_other: false, other_detail: '',
}
const allergyLabels: Record<string, string> = { drug: '藥物', medication: '藥物', food: '食物', environment: '環境', environmental: '環境', other: '其他/顯影劑', contrast_agent: '顯影劑' }
const severityLabels: Record<string, string> = { mild: '輕微', moderate: '中等', severe: '嚴重', anaphylaxis: '過敏性休克' }
const allergyStatusLabels: Record<string, string> = { confirmed: '確認', suspected: '疑似', not_sure: '不確定', ruled_out: '已排除' }

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    return res.ok ? await res.json() as T : fallback
  } catch { return fallback }
}
function clean(obj: Dict) {
  const out: Dict = {}
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) out[k] = v })
  return out
}
function idempotencyKey(scope: string) {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function dangerMri(mri: MriSafety) {
  return ['has_pacemaker', 'has_metal_implant', 'has_fixed_denture', 'has_other'].filter((key) => Boolean((mri as unknown as Dict)[key])).length
}

export default function RedzoneEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const sync = useSync()
  const patientSyncVersion = useMemo(() => sync.events.reduce((latest, event) => {
    if (event.patient_id !== id || !event.affected_views?.includes('cmo_red_zone')) return latest
    return Math.max(latest, event.id)
  }, 0), [id, sync.events])
  const [section, setSection] = useState<Section>('allergies')
  const [patientName, setPatientName] = useState('')
  const [allergies, setAllergies] = useState<Allergy[]>([])
  const [implants, setImplants] = useState<Implant[]>([])
  const [family, setFamily] = useState<FamilyHistory[]>([])
  const [profile, setProfile] = useState<Profile>(blankProfile)
  const [mri, setMri] = useState<MriSafety>(blankMri)
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)
  const [newAllergy, setNewAllergy] = useState({ category: 'drug', substance: '', reaction: '', severity: 'moderate', status: 'confirmed', source: 'cmo_entry', onset_date: '', note: '' })
  const [newImplant, setNewImplant] = useState({ type: '', subtype: '', model: '', body_site: '', implant_date: '', hospital: '', note: '' })
  const [newFamily, setNewFamily] = useState({ relation: '', condition: '', onset_age: '', deceased: false, cause_of_death: '', age_at_death: '', note: '' })
  const [templates, setTemplates] = useState<RzTemplate[]>([])

  const notify = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(''), 1600) }
  const fetchRedzone = useCallback(async () => {
    const [patient, a, i, f, p, m] = await Promise.all([
      getJson<PatientData | null>(`/api/cmo/patients/${id}`, null),
      getJson<Allergy[]>(`/api/cmo/patients/${id}/allergies`, []),
      getJson<Implant[]>(`/api/cmo/patients/${id}/implants`, []),
      getJson<FamilyHistory[]>(`/api/cmo/patients/${id}/family-history`, []),
      getJson<Profile | null>(`/api/cmo/patients/${id}/profile`, null),
      getJson<MriSafety | null>(`/api/cmo/patients/${id}/mri-safety`, null),
    ])
    return { patient, allergies: a, implants: i, family: f, profile: p, mri: m }
  }, [id])

  const applyRedzone = useCallback((data: Awaited<ReturnType<typeof fetchRedzone>>) => {
    const { patient, allergies: a, implants: i, family: f, profile: p, mri: m } = data
    setPatientName(patient?.user.display_name ?? '')
    setAllergies(Array.isArray(a) ? a : [])
    setImplants(Array.isArray(i) ? i : [])
    setFamily(Array.isArray(f) ? f : [])
    setProfile({ ...blankProfile, ...(p ?? {}) })
    setMri({ ...blankMri, ...(m ?? {}) })
  }, [])

  const refresh = useCallback(async () => {
    applyRedzone(await fetchRedzone())
  }, [applyRedzone, fetchRedzone])

  useEffect(() => {
    let alive = true
    fetchRedzone().then((data) => { if (alive) applyRedzone(data) })
    return () => { alive = false }
  }, [applyRedzone, fetchRedzone, patientSyncVersion])

  useEffect(() => {
    let alive = true
    getJson<RzTemplate[]>('/api/cmo/red-zone/templates', []).then((t) => { if (alive) setTemplates(Array.isArray(t) ? t : []) })
    return () => { alive = false }
  }, [])

  // Pick a template → prefill the matching section form so the CMO only confirms.
  const applyTemplate = (t: RzTemplate) => {
    if (t.kind === 'allergy') {
      setNewAllergy({ category: 'drug', substance: '', reaction: '', severity: 'moderate', status: 'confirmed', source: 'cmo_entry', onset_date: '', note: '', ...(t.payload as Partial<typeof newAllergy>) })
      setSection('allergies'); notify(`已套用範本：${t.label}，確認後按新增`)
    } else if (t.kind === 'device') {
      setNewImplant({ type: '', subtype: '', model: '', body_site: '', implant_date: '', hospital: '', note: '', ...(t.payload as Partial<typeof newImplant>) })
      setSection('implants'); notify(`已套用範本：${t.label}，確認後按新增`)
    } else if (t.kind === 'profile') {
      setProfile((prev) => ({ ...prev, ...(t.payload as Partial<Profile>) }))
      setSection('profile'); notify(`已套用範本：${t.label}，請確認後儲存`)
    } else {
      notify('抗凝血等高風險用藥，請於用藥編輯器新增')
    }
  }

  const handoff = useMemo(() => {
    const allergyText = allergies.map((a) => `${allergyLabels[a.category] ?? a.category}:${a.substance}${a.reaction ? `(${a.reaction})` : ''}`).join('；') || '未記錄'
    const implantText = implants.map((i) => `${i.type}${i.model ? ` ${i.model}` : ''}${i.body_site ? `/${i.body_site}` : ''}`).join('；') || '未記錄'
    const renal = profile.egfr_value || profile.ckd_stage || profile.is_dialysis ? `eGFR ${profile.egfr_value ?? '-'}，CKD ${profile.ckd_stage ?? '-'}${profile.is_dialysis ? `，透析 ${profile.dialysis_schedule || ''}` : ''}` : '未記錄'
    const emergency = profile.emergency_contact_name ? `${profile.emergency_contact_name} ${profile.emergency_contact_relation || ''} ${profile.emergency_contact_phone || ''}` : '未記錄'
    return [`${patientName || id} 保命紅區`, `過敏：${allergyText}`, `植入物：${implantText}`, `MRI 風險：${dangerMri(mri)} 項`, `腎功能：${renal}`, `血型：${profile.blood_type || '-'}${profile.rh_factor || ''}`, `緊急聯絡：${emergency}`].join('\n')
  }, [allergies, id, implants, mri, patientName, profile])

  const highRisk = allergies.filter((a) => ['severe', 'anaphylaxis'].includes(a.severity ?? '')).length + implants.length + dangerMri(mri) + (profile.is_dialysis ? 1 : 0)
  const completeness = [allergies.length > 0, implants.length > 0, Boolean(profile.blood_type), Boolean(profile.emergency_contact_phone), Boolean(profile.egfr_value || profile.ckd_stage), family.length > 0].filter(Boolean).length
  const allergyDisabledReason = !newAllergy.substance.trim()
    ? '請先填「物質」。高風險紅區必須有明確 target，才能寫入 audit/history。'
    : ''
  const implantDisabledReason = !newImplant.type.trim()
    ? '請先填「類型」。植入物會影響急診/MRI 判讀，需保留明確 target。'
    : ''
  const familyDisabledReason = !newFamily.relation.trim() || !newFamily.condition.trim()
    ? '請先填「關係」與「疾病」。家族史需要完整 target 才能追溯。'
    : ''

  const addAllergy = async () => {
    if (!newAllergy.substance.trim()) return
    setBusy(true)
    const payload = clean({
      ...newAllergy,
      patient_id: id,
      member_name: '本人',
      tier: ['severe', 'anaphylaxis'].includes(newAllergy.severity) ? 1 : 2,
      source: newAllergy.source || 'cmo_entry',
    })
    const res = await fetch('/api/cmo/red-zone', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('red-zone-create') },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (res.ok) {
      setNewAllergy({ category: 'drug', substance: '', reaction: '', severity: 'moderate', status: 'confirmed', source: 'cmo_entry', onset_date: '', note: '' })
      await refresh()
      notify(`已新增紅區 · ${newAllergy.substance}`)
    } else {
      notify('新增失敗：請確認物質與來源欄位')
    }
  }
  const addImplant = async () => {
    if (!newImplant.type.trim()) return
    setBusy(true)
    const res = await fetch(`/api/cmo/patients/${id}/implants`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean(newImplant)) })
    setBusy(false)
    if (res.ok) { setNewImplant({ type: '', subtype: '', model: '', body_site: '', implant_date: '', hospital: '', note: '' }); await refresh(); notify('已新增植入物') }
  }
  const addFamily = async () => {
    if (!newFamily.relation.trim() || !newFamily.condition.trim()) return
    const payload = clean({ ...newFamily, onset_age: newFamily.onset_age ? Number(newFamily.onset_age) : undefined, age_at_death: newFamily.age_at_death ? Number(newFamily.age_at_death) : undefined })
    setBusy(true)
    const res = await fetch(`/api/cmo/patients/${id}/family-history`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setBusy(false)
    if (res.ok) { setNewFamily({ relation: '', condition: '', onset_age: '', deceased: false, cause_of_death: '', age_at_death: '', note: '' }); await refresh(); notify('已新增家族史') }
  }
  const saveProfile = async () => {
    setBusy(true)
    const res = await fetch(`/api/cmo/patients/${id}/profile`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean(profile as unknown as Dict)) })
    setBusy(false)
    if (res.ok) { await refresh(); notify('已儲存基本與腎功能資料') }
  }
  const saveMri = async () => {
    setBusy(true)
    const res = await fetch(`/api/cmo/patients/${id}/mri-safety`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean(mri as unknown as Dict)) })
    setBusy(false)
    if (res.ok) { await refresh(); notify('已儲存 MRI 安全資料') }
  }
  const markAllergy = async (allergyId: number, mark: 'active' | 'inactive' | 'resolved' | 'outdated', label: string) => {
    const confirmed = window.confirm(`${label}這筆紅區資料？此操作會寫入 audit/history，User 端會同步更新。`)
    if (!confirmed) return
    setBusy(true)
    const res = await fetch(`/api/cmo/red-zone/${allergyId}/mark-${mark}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': idempotencyKey(`red-zone-${mark}`) },
    })
    setBusy(false)
    if (res.ok) {
      await refresh()
      notify(`已${label}紅區資料`)
    } else {
      notify(`操作失敗：無法${label}`)
    }
  }
  const revertAllergy = async (allergyId: number) => {
    const confirmed = window.confirm('還原這筆紅區資料到上一版？此操作會寫入 audit/history，User 端會同步更新。')
    if (!confirmed) return
    setBusy(true)
    const res = await fetch(`/api/cmo/red-zone/${allergyId}/revert`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': idempotencyKey('red-zone-revert') },
    })
    setBusy(false)
    if (res.ok) {
      await refresh()
      notify('已還原上一版紅區資料')
    } else if (res.status === 409) {
      notify('沒有可還原的上一版')
    } else {
      notify('還原失敗')
    }
  }

  return (
    <div className="cmo-page">
      <header className="cmo-title-row">
        <div>
          <button type="button" className="cmo-button" onClick={() => router.push(`/cmo/patients/${id}`)}>返回病患資料</button>
          <h1 className="cmo-title" style={{ marginTop: 12 }}>保命紅區</h1>
          <div className="cmo-subtitle">{patientName || id} · 急診、住院、影像檢查前必讀資訊 · 新增或儲存後會立即同步到 User 紅區</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {flash && <span className="cmo-badge" style={{ background: '#e7f4ec', color: '#2e8b57' }}>{flash}</span>}
          <button className="cmo-button" onClick={() => navigator.clipboard.writeText(handoff).then(() => notify('已複製紅區摘要'))}>複製摘要</button>
          <Link className="cmo-button primary" href={`/cmo/patients/${id}`}>回 Patient POV</Link>
        </div>
      </header>

      <section className="cmo-kpi-grid">
        <Kpi label="高風險項目" value={highRisk} note="嚴重過敏、植入物、MRI 禁忌、透析" tone="#a03a30" />
        <Kpi label="過敏紀錄" value={allergies.length} note={`${allergies.filter((a) => ['drug', 'medication'].includes(a.category)).length} 筆藥物`} tone="#c0453a" />
        <Kpi label="植入物" value={implants.length} note="含節律器、支架、Port-A 等" tone="#7a5fc0" />
        <Kpi label="MRI 風險" value={dangerMri(mri)} note="需檢查相容性或補問診" tone="#a97614" />
        <Kpi label="腎功能" value={profile.is_dialysis ? 'HD/PD' : profile.egfr_value ?? '-'} note={profile.ckd_stage ? `CKD ${profile.ckd_stage}` : 'eGFR / CKD'} tone="#3e6b7e" />
        <Kpi label="完整度" value={`${completeness}/6`} note="關鍵欄位補齊程度" tone="#3e6b7e" />
      </section>

      {templates.length > 0 && (
        <section className="cmo-card cmo-section" style={{ marginBottom: 14 }}>
          <div className="cmo-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 className="cmo-section-title" style={{ margin: 0 }}>紅區快速範本</h2>
            <span className="cmo-subtitle">點一下套用 → 確認 → 新增（少打字）</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {templates.map((t) => (
              <button key={t.key} type="button" className="cmo-button" onClick={() => applyTemplate(t)} title={`套用 ${t.label}`}>
                + {t.label}
                {t.tier ? <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: t.tier === 1 ? '#a03a30' : '#a97614' }}>T{t.tier}</span> : null}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="cmo-grid-2" style={{ alignItems: 'start' }}>
        <aside className="cmo-card cmo-section">
          <h2 className="cmo-section-title">CMO 快速判讀</h2>
          <textarea className="cmo-textarea" rows={8} readOnly value={handoff} />
          <div className="cmo-list" style={{ marginTop: 12 }}>
            <RiskLine ok={allergies.length > 0} label="過敏與反應已登錄" />
            <RiskLine ok={Boolean(profile.emergency_contact_phone)} label="緊急聯絡人可撥打" />
            <RiskLine ok={Boolean(profile.egfr_value || profile.ckd_stage)} label="腎功能與顯影劑風險已評估" />
            <RiskLine ok={dangerMri(mri) === 0} label="MRI 禁忌未見明確風險" reverse />
          </div>
        </aside>

        <main className="cmo-card cmo-section">
          <div className="cmo-tabs" style={{ marginBottom: 14 }}>
            {[
              ['allergies', '過敏'],
              ['implants', '植入物'],
              ['mri', 'MRI 安全'],
              ['profile', '基本/腎功能'],
              ['family', '家族史'],
            ].map(([key, label]) => <button key={key} className={`cmo-tab ${section === key ? 'active' : ''}`} onClick={() => setSection(key as Section)}>{label}</button>)}
          </div>

          {section === 'allergies' && <AllergySection items={allergies} form={newAllergy} setForm={setNewAllergy} busy={busy} add={addAllergy} disabledReason={allergyDisabledReason} mark={markAllergy} revert={revertAllergy} />}
          {section === 'implants' && <ImplantSection items={implants} form={newImplant} setForm={setNewImplant} busy={busy} add={addImplant} disabledReason={implantDisabledReason} />}
          {section === 'mri' && <MriSection mri={mri} setMri={setMri} save={saveMri} busy={busy} />}
          {section === 'profile' && <ProfileSection profile={profile} setProfile={setProfile} save={saveProfile} busy={busy} />}
          {section === 'family' && <FamilySection items={family} form={newFamily} setForm={setNewFamily} busy={busy} add={addFamily} disabledReason={familyDisabledReason} />}
        </main>
      </section>
    </div>
  )
}

function Kpi({ label, value, note, tone }: { label: string; value: string | number; note: string; tone: string }) {
  return <div className="cmo-card cmo-kpi"><div className="cmo-kpi-label">{label}</div><div className="cmo-kpi-value" style={{ color: tone }}>{value}</div><div className="cmo-subtitle">{note}</div></div>
}
function RiskLine({ ok, label, reverse }: { ok: boolean; label: string; reverse?: boolean }) {
  const good = reverse ? !ok : ok
  return <div className="cmo-list-item cmo-row"><span>{label}</span><span className="cmo-badge" style={{ background: good ? '#e7f4ec' : '#faecea', color: good ? '#2e8b57' : '#a03a30' }}>{good ? '完成' : '需補齊'}</span></div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><div className="cmo-kpi-label" style={{ marginBottom: 6 }}>{label}</div>{children}</label>
}
function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className="cmo-input" /> }
function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className="cmo-select" /> }

function AllergySection({
  items, form, setForm, busy, add, disabledReason, mark, revert,
}: {
  items: Allergy[]
  form: { category: string; substance: string; reaction: string; severity: string; status: string; source: string; onset_date: string; note: string }
  setForm: (v: typeof form) => void
  busy: boolean
  add: () => void
  disabledReason: string
  mark: (id: number, mark: 'active' | 'inactive' | 'resolved' | 'outdated', label: string) => void
  revert: (id: number) => void
}) {
  return <div><h2 className="cmo-section-title">過敏與禁忌</h2><div className="cmo-grid-3">
    <Field label="類型"><SelectInput value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="drug">藥物</option><option value="food">食物</option><option value="environment">環境</option><option value="other">其他/顯影劑</option></SelectInput></Field>
    <Field label="物質"><TextInput value={form.substance} onChange={(e) => setForm({ ...form, substance: e.target.value })} placeholder="Penicillin / Iodine" /></Field>
    <Field label="嚴重度"><SelectInput value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}><option value="mild">輕微</option><option value="moderate">中等</option><option value="severe">嚴重</option><option value="anaphylaxis">過敏性休克</option></SelectInput></Field>
    <Field label="狀態"><SelectInput value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="confirmed">確認</option><option value="suspected">疑似</option><option value="not_sure">不確定</option><option value="ruled_out">已排除</option></SelectInput></Field>
    <Field label="反應"><TextInput value={form.reaction} onChange={(e) => setForm({ ...form, reaction: e.target.value })} placeholder="皮疹、呼吸困難、休克" /></Field>
    <Field label="發生日期"><TextInput type="date" value={form.onset_date} onChange={(e) => setForm({ ...form, onset_date: e.target.value })} /></Field>
    <Field label="備註"><TextInput value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
  </div>
    <button className="cmo-button primary" disabled={busy || Boolean(disabledReason)} title={disabledReason || '新增紅區並寫入 audit/history'} onClick={add} style={{ marginTop: 12 }}>新增紅區過敏</button>
    {disabledReason && <div className="cmo-subtitle" style={{ marginTop: 6 }}>{disabledReason}</div>}
    <RecordList empty="尚未登錄過敏；可用上方範本快速新增，新增後會同步到 User 保命紅區。">{items.map((a) => {
      const isInactive = a.status === 'ruled_out'
      return (
        <div className="cmo-list-item" key={a.id}>
          <div className="cmo-row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <strong>{a.substance}</strong>
              <div className="cmo-subtitle">
                Tier {a.tier ?? (['severe', 'anaphylaxis'].includes(a.severity ?? '') ? 1 : 2)}
                {' · '}{allergyLabels[a.category] ?? a.category}
                {' · '}{allergyStatusLabels[a.status ?? ''] ?? a.status ?? '未標狀態'}
                {' · '}{severityLabels[a.severity ?? ''] ?? a.severity ?? '未分級'}
                {' · '}{a.reaction || a.reaction_description || '未填反應'}
              </div>
              <div className="cmo-subtitle">source: {a.source || 'cmo_entry'} · {a.onset_date || '未填日期'}{a.note ? ` · ${a.note}` : ''}</div>
            </div>
            <span className="cmo-badge" style={{ background: isInactive ? '#eef2f5' : '#faecea', color: isInactive ? '#6b7c8c' : '#a03a30' }}>
              {isInactive ? 'inactive/resolved' : 'active'}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {isInactive ? (
              <button className="cmo-button" disabled={busy} onClick={() => mark(a.id, 'active', '標記 active')}>標記 Active</button>
            ) : (
              <>
                <button className="cmo-button" disabled={busy} onClick={() => mark(a.id, 'inactive', '標記停用')}>標記停用</button>
                <button className="cmo-button" disabled={busy} onClick={() => mark(a.id, 'resolved', '標記已解決')}>已解決</button>
              </>
            )}
            <button className="cmo-button" disabled={busy} onClick={() => mark(a.id, 'outdated', '標記過期/待確認')}>過期/待確認</button>
            <button className="cmo-button" disabled={busy} onClick={() => revert(a.id)}>還原上一版</button>
          </div>
        </div>
      )
    })}</RecordList></div>
}

function ImplantSection({ items, form, setForm, busy, add, disabledReason }: { items: Implant[]; form: { type: string; subtype: string; model: string; body_site: string; implant_date: string; hospital: string; note: string }; setForm: (v: typeof form) => void; busy: boolean; add: () => void; disabledReason: string }) {
  return <div><h2 className="cmo-section-title">植入物與裝置</h2><div className="cmo-grid-3">
    {(['type', 'subtype', 'model', 'body_site', 'implant_date', 'hospital'] as const).map((key) => <Field key={key} label={{ type: '類型', subtype: '子類型', model: '型號', body_site: '部位', implant_date: '日期', hospital: '醫院' }[key]}><TextInput type={key === 'implant_date' ? 'date' : 'text'} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>)}
  </div><Field label="備註"><textarea className="cmo-textarea" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field><button className="cmo-button primary" disabled={busy || Boolean(disabledReason)} title={disabledReason || '新增植入物'} onClick={add}>新增植入物</button>
    {disabledReason && <div className="cmo-subtitle" style={{ marginTop: 6 }}>{disabledReason}</div>}
    <RecordList empty="尚未登錄植入物；若有節律器、支架、Port-A、管路或呼吸器，請用範本快速新增。">{items.map((i) => <div className="cmo-list-item cmo-row" key={i.id}><div><strong>{i.type}{i.model ? ` · ${i.model}` : ''}</strong><div className="cmo-subtitle">{i.body_site || '未填部位'} · {i.implant_date || '未填日期'} · {i.hospital || '未填醫院'}</div></div><button className="cmo-button" disabled title="尚未提供植入物 audited revert；請改用備註標記過期或待確認。">不可直接刪除</button></div>)}</RecordList></div>
}

function MriSection({ mri, setMri, save, busy }: { mri: MriSafety; setMri: (v: MriSafety) => void; save: () => void; busy: boolean }) {
  const toggles: Array<[keyof MriSafety, string]> = [['has_pacemaker', '心律調節器'], ['has_metal_implant', '金屬植入物'], ['has_fixed_denture', '固定假牙'], ['has_removable_denture', '活動假牙'], ['has_tattoo', '刺青'], ['has_eyebrow_tattoo', '眉眼線紋繡'], ['has_hair_dye', '染髮'], ['has_other', '其他風險']]
  return <div><h2 className="cmo-section-title">MRI 安全問診</h2><div className="cmo-list">{toggles.map(([key, label]) => <label className="cmo-list-item cmo-row" key={String(key)}><span>{label}</span><input type="checkbox" checked={Boolean(mri[key])} onChange={(e) => setMri({ ...mri, [key]: e.target.checked })} /></label>)}</div><div className="cmo-grid-3" style={{ marginTop: 12 }}>
    <Field label="節律器細節"><TextInput value={mri.pacemaker_detail || ''} onChange={(e) => setMri({ ...mri, pacemaker_detail: e.target.value })} /></Field>
    <Field label="金屬植入物細節"><TextInput value={mri.metal_implant_detail || ''} onChange={(e) => setMri({ ...mri, metal_implant_detail: e.target.value })} /></Field>
    <Field label="其他說明"><TextInput value={mri.other_detail || ''} onChange={(e) => setMri({ ...mri, other_detail: e.target.value })} /></Field>
  </div><button className="cmo-button primary" disabled={busy} onClick={save} style={{ marginTop: 12 }}>儲存 MRI 安全資料</button></div>
}

function ProfileSection({ profile, setProfile, save, busy }: { profile: Profile; setProfile: (v: Profile) => void; save: () => void; busy: boolean }) {
  return <div><h2 className="cmo-section-title">基本資料、腎功能、緊急聯絡</h2><div className="cmo-grid-3">
    <Field label="血型"><SelectInput value={profile.blood_type || ''} onChange={(e) => setProfile({ ...profile, blood_type: e.target.value })}><option value="">未填</option><option>A</option><option>B</option><option>AB</option><option>O</option></SelectInput></Field>
    <Field label="Rh"><SelectInput value={profile.rh_factor || ''} onChange={(e) => setProfile({ ...profile, rh_factor: e.target.value })}><option value="">未填</option><option>+</option><option>-</option></SelectInput></Field>
    <Field label="血型來源"><SelectInput value={profile.blood_type_source || ''} onChange={(e) => setProfile({ ...profile, blood_type_source: e.target.value })}><option value="">未確認（顯示為自述）</option><option value="self_reported">病人自述</option><option value="lab_confirmed">院檢確認</option></SelectInput></Field>
    <Field label="eGFR"><TextInput type="number" value={profile.egfr_value ?? ''} onChange={(e) => setProfile({ ...profile, egfr_value: e.target.value ? Number(e.target.value) : null })} /></Field>
    <Field label="eGFR 測量日"><TextInput type="date" value={profile.egfr_date || ''} onChange={(e) => setProfile({ ...profile, egfr_date: e.target.value })} /></Field>
    <Field label="CKD Stage"><TextInput value={profile.ckd_stage || ''} onChange={(e) => setProfile({ ...profile, ckd_stage: e.target.value })} /></Field>
    <Field label="透析方式"><TextInput value={profile.dialysis_modality || ''} onChange={(e) => setProfile({ ...profile, dialysis_modality: e.target.value })} /></Field>
    <Field label="透析時間"><TextInput value={profile.dialysis_schedule || ''} onChange={(e) => setProfile({ ...profile, dialysis_schedule: e.target.value })} /></Field>
    <Field label="身高 cm"><TextInput type="number" value={profile.height_cm ?? ''} onChange={(e) => setProfile({ ...profile, height_cm: e.target.value ? Number(e.target.value) : null })} /></Field>
    <Field label="體重 kg"><TextInput type="number" value={profile.weight_kg ?? ''} onChange={(e) => setProfile({ ...profile, weight_kg: e.target.value ? Number(e.target.value) : null })} /></Field>
    <Field label="職業"><TextInput value={profile.occupation || ''} onChange={(e) => setProfile({ ...profile, occupation: e.target.value })} /></Field>
    <Field label="緊急聯絡人"><TextInput value={profile.emergency_contact_name || ''} onChange={(e) => setProfile({ ...profile, emergency_contact_name: e.target.value })} /></Field>
    <Field label="關係"><TextInput value={profile.emergency_contact_relation || ''} onChange={(e) => setProfile({ ...profile, emergency_contact_relation: e.target.value })} /></Field>
    <Field label="電話"><TextInput value={profile.emergency_contact_phone || ''} onChange={(e) => setProfile({ ...profile, emergency_contact_phone: e.target.value })} /></Field>
  </div><div className="cmo-chipbar" style={{ marginTop: 12 }}><label className="cmo-chip"><input type="checkbox" checked={Boolean(profile.is_dialysis)} onChange={(e) => setProfile({ ...profile, is_dialysis: e.target.checked })} />透析</label><label className="cmo-chip"><input type="checkbox" checked={Boolean(profile.has_hep_b)} onChange={(e) => setProfile({ ...profile, has_hep_b: e.target.checked })} />B 肝</label><label className="cmo-chip"><input type="checkbox" checked={Boolean(profile.has_hep_c)} onChange={(e) => setProfile({ ...profile, has_hep_c: e.target.checked })} />C 肝</label></div><button className="cmo-button primary" disabled={busy} onClick={save} style={{ marginTop: 12 }}>儲存基本資料</button></div>
}

function FamilySection({ items, form, setForm, busy, add, disabledReason }: { items: FamilyHistory[]; form: { relation: string; condition: string; onset_age: string; deceased: boolean; cause_of_death: string; age_at_death: string; note: string }; setForm: (v: typeof form) => void; busy: boolean; add: () => void; disabledReason: string }) {
  return <div><h2 className="cmo-section-title">家族史</h2><div className="cmo-grid-3"><Field label="關係"><TextInput value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} /></Field><Field label="疾病"><TextInput value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} /></Field><Field label="發病年齡"><TextInput type="number" value={form.onset_age} onChange={(e) => setForm({ ...form, onset_age: e.target.value })} /></Field><Field label="死因"><TextInput value={form.cause_of_death} onChange={(e) => setForm({ ...form, cause_of_death: e.target.value })} /></Field><Field label="死亡年齡"><TextInput type="number" value={form.age_at_death} onChange={(e) => setForm({ ...form, age_at_death: e.target.value })} /></Field><label className="cmo-chip" style={{ alignSelf: 'end' }}><input type="checkbox" checked={form.deceased} onChange={(e) => setForm({ ...form, deceased: e.target.checked })} />已故</label></div><Field label="備註"><textarea className="cmo-textarea" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field><button className="cmo-button primary" disabled={busy || Boolean(disabledReason)} title={disabledReason || '新增家族史'} onClick={add}>新增家族史</button>{disabledReason && <div className="cmo-subtitle" style={{ marginTop: 6 }}>{disabledReason}</div>}<RecordList empty="尚未登錄家族史；若與 Problem 風險評估相關，請新增並在備註標明來源。">{items.map((f) => <div className="cmo-list-item cmo-row" key={f.id}><div><strong>{f.relation} · {f.condition}</strong><div className="cmo-subtitle">發病 {f.onset_age ?? '-'} 歲{f.deceased ? ` · 已故 ${f.age_at_death ?? '-'} 歲` : ''}</div></div><button className="cmo-button" disabled title="家族史目前未提供 audited revert；請用備註保留修正脈絡。">不可直接刪除</button></div>)}</RecordList></div>
}

function RecordList({ children, empty }: { children: React.ReactNode; empty: string }) {
  return <div className="cmo-list" style={{ marginTop: 14 }}>{Array.isArray(children) && children.length === 0 ? <div className="cmo-list-item cmo-muted">{empty}</div> : children}</div>
}
