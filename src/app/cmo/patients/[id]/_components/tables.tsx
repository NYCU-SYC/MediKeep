// Read-only display panels/tables for the CMO patient workspace (Phase 2 extraction).
import type { UnlinkedItems, MedicalTimelineItem, HealthRecord, DicomStudy } from '../page'
import { formatDate, formatRecordValue, RECORD_LABELS } from '../_lib'
import { DataSourceBadge, ReviewStatusBadge } from './badges'

export function UnlinkedItemsPanel({ items }: { items: UnlinkedItems }) {
  const total = items.conditions.length + items.medications.length
  return (
    <div className="cmo-card cmo-section" style={{ gridColumn: '1 / -1' }}>
      <div className="cmo-title-row">
        <h2 className="cmo-section-title" style={{ margin: 0 }}>Unlinked Items</h2>
        <span className="cmo-badge" style={{ background: total ? '#fdf6e3' : '#e7f4ec', color: total ? '#a97614' : '#2e8b57' }}>{total} pending</span>
      </div>
      <div className="cmo-grid-2" style={{ marginTop: 12 }}>
        <UnlinkedColumn title="Conditions" rows={items.conditions.map((item) => ({
          id: `condition-${item.id}`,
          title: item.display_name || 'Unnamed condition',
          detail: `${item.icd10_code ?? 'no ICD'} · ${item.status ?? 'status unknown'}`,
        }))} />
        <UnlinkedColumn title="Medications" rows={items.medications.map((item) => ({
          id: `medication-${item.id}`,
          title: item.drug_name || item.medication_name || 'Medication',
          detail: [item.dose, item.frequency, item.indication || item.possible_indication].filter(Boolean).join(' · ') || 'No regimen detail',
        }))} />
      </div>
      <div className="cmo-subtitle" style={{ marginTop: 12 }}>
        BACKEND_NEEDED: persistent many-to-many concept-map join tables. The current endpoint exposes unlinked rows but does not persist link/unlink yet.
      </div>
    </div>
  )
}

export function UnlinkedColumn({ title, rows }: { title: string; rows: Array<{ id: string; title: string; detail: string }> }) {
  return (
    <div>
      <div className="cmo-kpi-label" style={{ marginBottom: 8 }}>{title}</div>
      <div className="cmo-list">
        {rows.length === 0 ? <div className="cmo-muted">No unlinked {title.toLowerCase()}.</div> : rows.map((row) => (
          <div className="cmo-list-item" key={row.id}>
            <strong>{row.title}</strong>
            <div className="cmo-subtitle">{row.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TimelinePanel({ items }: { items: MedicalTimelineItem[] }) {
  return (
    <div className="cmo-card cmo-section">
      <h2 className="cmo-section-title">近期資料時間線</h2>
      <div className="cmo-list">
        {items.length === 0 ? <div className="cmo-muted">尚無近期資料。</div> : items.map((item) => (
          <div className="cmo-list-item" key={item.id} style={{ borderColor: item.important ? '#fbbf24' : '#e3e9ee', background: item.important ? '#fdf6e3' : '#fff' }}>
            <div className="cmo-row">
              <strong>{item.title}</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className="cmo-badge" style={{ background: '#eef2f5', color: '#45596a' }}>{item.kind}</span>
                <DataSourceBadge source={item.source} />
                <ReviewStatusBadge status={item.status} />
              </div>
            </div>
            <div className="cmo-subtitle">{formatDate(item.date)} · {item.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function RecordTable({ records }: { records: HealthRecord[] }) {
  return (
    <div className="cmo-card table-wrap">
      <table className="cmo-table">
        <thead><tr><th>日期</th><th>成員</th><th>類型</th><th>數值</th><th>備註</th></tr></thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}><td>{formatDate(record.recorded_at)}</td><td>{record.member_name}</td><td>{RECORD_LABELS[record.record_type] ?? record.record_type}</td><td><strong>{formatRecordValue(record)}</strong></td><td>{record.note ?? ''}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


export function ImagingTable({ studies }: { studies: DicomStudy[] }) {
  return (
    <div className="cmo-card table-wrap">
      <table className="cmo-table">
        <thead><tr><th>日期</th><th>成員</th><th>Modality</th><th>描述</th><th>影像量</th></tr></thead>
        <tbody>
          {studies.map((study) => (
            <tr key={study.id}><td>{formatDate(study.created_at ?? study.study_date)}</td><td>{study.member_name}</td><td>{study.modality ?? 'DICOM'}</td><td>{study.study_description ?? '未命名檢查'}</td><td>{study.series_count} series · {study.instance_count} images</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
