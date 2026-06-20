// Mock clinical cohort for CMO Workbench demo / fallback.
// 16 patients spanning the scenarios required by spec.
//
// IMPORTANT design rules:
// - Every mock patient has `isDemoData: true` so the UI can mark it.
// - User IDs prefixed with `mock-` so they never collide with real UUIDs
//   and are easy to detect (Patient Snapshot disables "Open chart" nav).
// - Data shape matches the real queue endpoint, plus a `demoOverrides`
//   block letting us explicitly set risk / cohorts / abnormalFindings.
// - Real API patients have no overrides, so they still go through the
//   heuristic deriveClinical() — both sources flow through the SAME
//   pipeline downstream, so KPIs/filters/sorts are consistent.

import type { QueueItem, AbnormalFinding } from './clinical'
import type { Problem, SourceDocument, Allergy, QueueCategory } from './healthkeepTypes'

// Helper: ISO date N days ago.
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function af(item: string, value: string, severity: AbnormalFinding['severity'], reference?: string, ago = 14): AbnormalFinding {
  return { item, value, severity, reference, detectedAt: daysAgo(ago) }
}

// Each entry combines minimal QueueItem fields + demoOverrides that fully
// specify clinical signals (so the dashboard renders without depending on
// heuristic inference of abnormal labs etc.).
export const MOCK_PATIENTS: QueueItem[] = [
  // ── 3 Critical ──
  {
    user_id: 'mock-001', display_name: '王秋華 · 67F',
    pending_drafts: 8, tier1_drafts: 3, unpublished_problems: 2,
    records_count: 42, documents_count: 6, dicom_count: 1,
    last_activity: daysAgo(110), queue_type: 'high_priority',
    next_action: 'Schedule follow-up', highest_priority_tier: 1,
    highest_problem_name: '高血壓合併第二型糖尿病 (uncontrolled)',
    isDemoData: true,
    demoOverrides: {
      age: 67, sex: 'Female',
      cohorts: ['diabetes', 'hypertension', 'overdue', 'worsening'],
      riskLevel: 'critical', riskScore: 92, trend: 'worsening',
      abnormalFindings: [
        af('Blood pressure', '192/108 mmHg', 'critical', '<130/80', 5),
        af('HbA1c', '10.4 %', 'critical', '<7.0', 21),
        af('Fasting glucose', '218 mg/dL', 'high', '70-99', 21),
      ],
    },
  },
  {
    user_id: 'mock-002', display_name: '林志強 · 72M',
    pending_drafts: 5, tier1_drafts: 2, unpublished_problems: 1,
    records_count: 18, documents_count: 4, dicom_count: 2,
    last_activity: daysAgo(8), queue_type: 'high_priority',
    next_action: 'Review critical alert', highest_priority_tier: 1,
    highest_problem_name: 'Suspected atrial fibrillation · 心房顫動疑似',
    isDemoData: true,
    demoOverrides: {
      age: 72, sex: 'Male',
      cohorts: ['cardiovasc', 'worsening'],
      riskLevel: 'critical', riskScore: 88, trend: 'worsening',
      abnormalFindings: [
        af('Heart rhythm (ECG)', 'Irregular RR, AF cannot be excluded', 'critical', 'Sinus', 8),
        af('Resting heart rate', '128 bpm', 'high', '60-100', 8),
      ],
    },
  },
  {
    user_id: 'mock-012', display_name: '簡明峰 · 64M',
    pending_drafts: 11, tier1_drafts: 4, unpublished_problems: 3,
    records_count: 27, documents_count: 8, dicom_count: 3,
    last_activity: daysAgo(3), queue_type: 'high_priority',
    next_action: 'Review critical alert', highest_priority_tier: 1,
    highest_problem_name: 'Acute hemorrhagic stroke 腦出血 post-admit',
    isDemoData: true,
    demoOverrides: {
      age: 64, sex: 'Male',
      cohorts: ['cardiovasc', 'trauma', 'worsening'],
      riskLevel: 'critical', riskScore: 95, trend: 'worsening',
      abnormalFindings: [
        af('CT brain', 'Right basal ganglia hemorrhage 18 mL', 'critical', 'No bleed', 3),
        af('GCS score', '11 (M5 V3 E3)', 'high', '15', 3),
        af('Blood pressure', '178/102 mmHg', 'high', '<140/90', 2),
      ],
    },
  },

  // ── 5 High ──
  {
    user_id: 'mock-003', display_name: '陳玲玲 · 54F',
    pending_drafts: 3, tier1_drafts: 0, unpublished_problems: 1,
    records_count: 22, documents_count: 3, dicom_count: 0,
    last_activity: daysAgo(45), queue_type: 'nhi_review',
    next_action: 'Adjust care plan', highest_priority_tier: 2,
    highest_problem_name: '第二型糖尿病 (HbA1c 9.1)',
    isDemoData: true,
    demoOverrides: {
      age: 54, sex: 'Female',
      cohorts: ['diabetes'],
      riskLevel: 'high', riskScore: 74, trend: 'stable',
      abnormalFindings: [
        af('HbA1c', '9.1 %', 'high', '<7.0', 30),
        af('Fasting glucose', '178 mg/dL', 'moderate', '70-99', 30),
      ],
    },
  },
  {
    user_id: 'mock-004', display_name: '黃文棋 · 49M',
    pending_drafts: 2, tier1_drafts: 0, unpublished_problems: 1,
    records_count: 15, documents_count: 2, dicom_count: 0,
    last_activity: daysAgo(58), queue_type: 'nhi_review',
    next_action: 'Adjust care plan', highest_priority_tier: 2,
    highest_problem_name: '高血脂合併代謝症候群 (LDL 198, BMI 31.2)',
    isDemoData: true,
    demoOverrides: {
      age: 49, sex: 'Male',
      cohorts: ['hyperlipid', 'metabolic'],
      riskLevel: 'high', riskScore: 68, trend: 'stable',
      abnormalFindings: [
        af('LDL-C', '198 mg/dL', 'high', '<130', 28),
        af('Triglycerides', '312 mg/dL', 'moderate', '<150', 28),
        af('BMI', '31.2', 'moderate', '18.5-24.9', 28),
      ],
    },
  },
  {
    user_id: 'mock-005', display_name: '吳秀英 · 78F',
    pending_drafts: 1, tier1_drafts: 0, unpublished_problems: 2,
    records_count: 31, documents_count: 5, dicom_count: 1,
    last_activity: daysAgo(132), queue_type: 'unpublished',
    next_action: 'Schedule follow-up', highest_priority_tier: 2,
    highest_problem_name: '高血壓 + 退化性關節炎 · 高齡',
    isDemoData: true,
    demoOverrides: {
      age: 78, sex: 'Female',
      cohorts: ['hypertension', 'overdue'],
      riskLevel: 'high', riskScore: 71, trend: 'stable',
      abnormalFindings: [
        af('Blood pressure', '164/96 mmHg', 'high', '<140/90', 132),
      ],
    },
  },
  {
    user_id: 'mock-013', display_name: '廖佳怡 · 58F',
    pending_drafts: 4, tier1_drafts: 1, unpublished_problems: 1,
    records_count: 24, documents_count: 3, dicom_count: 0,
    last_activity: daysAgo(40), queue_type: 'high_priority',
    next_action: 'Adjust care plan', highest_priority_tier: 2,
    highest_problem_name: '原發性高血壓 (BP trending up)',
    isDemoData: true,
    demoOverrides: {
      age: 58, sex: 'Female',
      cohorts: ['hypertension', 'worsening'],
      riskLevel: 'high', riskScore: 76, trend: 'worsening',
      abnormalFindings: [
        af('Blood pressure (avg 7d)', '162/98 mmHg', 'high', '<140/90', 7),
        af('Blood pressure (avg 30d)', '148/92 mmHg', 'moderate', '<140/90', 30),
      ],
    },
  },
  {
    user_id: 'mock-016', display_name: '賴宗翰 · 61M',
    pending_drafts: 6, tier1_drafts: 1, unpublished_problems: 2,
    records_count: 38, documents_count: 7, dicom_count: 1,
    last_activity: daysAgo(20), queue_type: 'high_priority',
    next_action: 'Review critical alert', highest_priority_tier: 2,
    highest_problem_name: '糖尿病 + 高血壓 + 高血脂 (triple comorbidity)',
    isDemoData: true,
    demoOverrides: {
      age: 61, sex: 'Male',
      cohorts: ['diabetes', 'hypertension', 'hyperlipid', 'worsening'],
      riskLevel: 'high', riskScore: 80, trend: 'worsening',
      abnormalFindings: [
        af('HbA1c', '8.6 %', 'high', '<7.0', 18),
        af('LDL-C', '172 mg/dL', 'moderate', '<130', 18),
        af('Blood pressure', '152/94 mmHg', 'moderate', '<140/90', 5),
      ],
    },
  },

  // ── 6 Moderate ──
  {
    user_id: 'mock-006', display_name: '蔡建國 · 56M',
    pending_drafts: 1, tier1_drafts: 0, unpublished_problems: 0,
    records_count: 24, documents_count: 2, dicom_count: 0,
    last_activity: daysAgo(14), queue_type: 'general',
    next_action: 'Routine review', highest_priority_tier: 3,
    highest_problem_name: '第二型糖尿病 (controlled, HbA1c 6.8)',
    isDemoData: true,
    demoOverrides: {
      age: 56, sex: 'Male',
      cohorts: ['diabetes'],
      riskLevel: 'moderate', riskScore: 42, trend: 'improving',
      abnormalFindings: [af('HbA1c', '6.8 %', 'moderate', '<7.0', 15)],
    },
  },
  {
    user_id: 'mock-007', display_name: '周淑芬 · 51F',
    pending_drafts: 1, tier1_drafts: 0, unpublished_problems: 1,
    records_count: 16, documents_count: 2, dicom_count: 0,
    last_activity: daysAgo(22), queue_type: 'general',
    next_action: 'Routine review', highest_priority_tier: 3,
    highest_problem_name: '高血脂 + 代謝症候群 (mild)',
    isDemoData: true,
    demoOverrides: {
      age: 51, sex: 'Female',
      cohorts: ['hyperlipid', 'metabolic'],
      riskLevel: 'moderate', riskScore: 48, trend: 'stable',
      abnormalFindings: [
        af('LDL-C', '152 mg/dL', 'moderate', '<130', 22),
        af('BMI', '27.6', 'moderate', '18.5-24.9', 22),
      ],
    },
  },
  {
    user_id: 'mock-008', display_name: '楊柏霖 · 43M',
    pending_drafts: 0, tier1_drafts: 0, unpublished_problems: 1,
    records_count: 9, documents_count: 4, dicom_count: 1,
    last_activity: daysAgo(35), queue_type: 'unpublished',
    next_action: 'Schedule follow-up', highest_priority_tier: 3,
    highest_problem_name: 'Post-operative rehabilitation · 橈骨骨折術後',
    isDemoData: true,
    demoOverrides: {
      age: 43, sex: 'Male',
      cohorts: ['trauma'],
      riskLevel: 'moderate', riskScore: 38, trend: 'improving',
      abnormalFindings: [
        af('Wrist ROM (right)', '60° flexion', 'moderate', '70-90°', 14),
      ],
    },
  },
  {
    user_id: 'mock-009', display_name: '鄭美玲 · 65F',
    pending_drafts: 0, tier1_drafts: 0, unpublished_problems: 0,
    records_count: 28, documents_count: 5, dicom_count: 1,
    last_activity: daysAgo(18), queue_type: 'general',
    next_action: 'Routine review', highest_priority_tier: 3,
    highest_problem_name: '冠心病術後追蹤 (stent, stable)',
    isDemoData: true,
    demoOverrides: {
      age: 65, sex: 'Female',
      cohorts: ['cardiovasc'],
      riskLevel: 'moderate', riskScore: 44, trend: 'stable',
      abnormalFindings: [],
    },
  },
  {
    user_id: 'mock-014', display_name: '邱建華 · 47M',
    pending_drafts: 0, tier1_drafts: 0, unpublished_problems: 0,
    records_count: 4, documents_count: 1, dicom_count: 0,
    last_activity: daysAgo(212), queue_type: 'general',
    next_action: 'Schedule follow-up', highest_priority_tier: 3,
    highest_problem_name: '單純脂肪肝 (NAFLD, mild)',
    isDemoData: true,
    demoOverrides: {
      age: 47, sex: 'Male',
      cohorts: ['metabolic', 'overdue'],
      riskLevel: 'moderate', riskScore: 41, trend: 'stable',
      abnormalFindings: [af('ALT', '52 U/L', 'moderate', '<40', 212)],
    },
  },
  {
    user_id: 'mock-015', display_name: '范秋雯 · 53F',
    pending_drafts: 2, tier1_drafts: 0, unpublished_problems: 1,
    records_count: 19, documents_count: 3, dicom_count: 0,
    last_activity: daysAgo(11), queue_type: 'nhi_review',
    next_action: 'Adjust care plan', highest_priority_tier: 3,
    highest_problem_name: 'Multiple borderline lab values (TSH, ferritin, Vit D)',
    isDemoData: true,
    demoOverrides: {
      age: 53, sex: 'Female',
      cohorts: ['metabolic'],
      riskLevel: 'moderate', riskScore: 46, trend: 'stable',
      abnormalFindings: [
        af('TSH', '5.8 mIU/L', 'moderate', '0.4-4.0', 11),
        af('Ferritin', '12 ng/mL', 'moderate', '15-150', 11),
        af('25-OH Vitamin D', '18 ng/mL', 'moderate', '30-100', 11),
        af('LDL-C', '142 mg/dL', 'moderate', '<130', 11),
      ],
    },
  },

  // ── 2 Stable ──
  {
    user_id: 'mock-010', display_name: '高士豪 · 38M',
    pending_drafts: 0, tier1_drafts: 0, unpublished_problems: 0,
    records_count: 12, documents_count: 1, dicom_count: 0,
    last_activity: daysAgo(7), queue_type: 'general',
    next_action: 'Routine review', highest_priority_tier: null,
    highest_problem_name: null,
    isDemoData: true,
    demoOverrides: {
      age: 38, sex: 'Male',
      cohorts: [], riskLevel: 'stable', riskScore: 12, trend: 'stable',
      abnormalFindings: [],
    },
  },
  {
    user_id: 'mock-011', display_name: '蘇瑞君 · 82F',
    pending_drafts: 0, tier1_drafts: 0, unpublished_problems: 0,
    records_count: 1, documents_count: 0, dicom_count: 0,
    last_activity: null, queue_type: 'new_patient',
    next_action: 'Complete intake', highest_priority_tier: null,
    highest_problem_name: '尚未完成 intake',
    isDemoData: true,
    demoOverrides: {
      age: 82, sex: 'Female',
      cohorts: [], riskLevel: 'stable', riskScore: 18, trend: 'stable',
      abnormalFindings: [],
    },
  },
]

// ── Mock POV layer per patient ──────────────────────────────────────────────
// Aligned with API Contract v2 §4.3 (Problem) and §4.13 (SourceDocument).
// Each patient has 1–3 problems + 1–2 source documents + optional allergies
// so the Patient Snapshot drawer can render the Problem-Oriented View.

function p(
  pid: string, idx: number, icd: string | null, name: string, layman: string | null,
  status: 'underlying' | 'following' | 'resolved', tier: 1 | 2 | 3,
  isVerified: boolean, isPublished: boolean, isSuspected = false,
  cmoNote: string | null = null, onsetDaysAgo = 365, srcIds: string[] = [],
  counts = { dx: 0, med: 0, lab: 0 },
): Problem {
  return {
    id: `${pid}-prob-${idx}`,
    patient_id: pid,
    icd10_code: icd,
    icd10_code_secondary: [],
    display_name: name,
    display_layman: layman,
    status,
    is_suspected: isSuspected,
    tier,
    onset_date: daysAgo(onsetDaysAgo).slice(0, 10),
    resolution_date: status === 'resolved' ? daysAgo(30).slice(0, 10) : null,
    recurrence_note: null,
    cmo_note: cmoNote,
    cmo_flags: [],
    is_verified: isVerified,
    verified_by: isVerified ? 'cmo-salmon' : null,
    verified_at: isVerified ? daysAgo(7) : null,
    is_published: isPublished,
    published_at: isPublished ? daysAgo(5) : null,
    last_active_at: daysAgo(7),
    source_document_ids: srcIds,
    linked_condition_count: counts.dx,
    linked_medication_count: counts.med,
    linked_lab_count: counts.lab,
  }
}

function sd(
  pid: string, idx: number, kind: SourceDocument['source_type'],
  filename: string, uploadedDaysAgo: number,
  ocrStatus: SourceDocument['ocr_status'] = 'done',
): SourceDocument {
  return {
    id: `${pid}-sd-${idx}`, patient_id: pid,
    source_type: kind, original_filename: filename,
    mime_type: kind === 'photo' ? 'image/jpeg' : kind === 'paper_scan' ? 'application/pdf' : 'text/html',
    file_size_bytes: 524288,
    status: 'parsed', ocr_status: ocrStatus,
    created_at: daysAgo(uploadedDaysAgo),
  }
}

function ag(
  pid: string, idx: number, substance: string, severity: Allergy['severity'],
  status: Allergy['status'], tier: 1 | 2 | 3 = 1, isVerified = true,
): Allergy {
  return {
    id: `${pid}-ag-${idx}`, patient_id: pid, substance,
    category: 'drug', reaction_description: null, severity, status, tier,
    verified: isVerified,
  }
}

// Patient → problems (POV)
export const MOCK_PROBLEMS: Record<string, Problem[]> = {
  'mock-001': [
    p('mock-001', 1, 'I10',  'Essential hypertension (uncontrolled)', '高血壓（血壓長期偏高）',           'underlying', 1, true, true,  false, 'Pt non-adherent to BP meds — 110d gap', 3650, ['mock-001-sd-1'], { dx: 8, med: 2, lab: 6 }),
    p('mock-001', 2, 'E11.9','第二型糖尿病 (uncontrolled)',          '第二型糖尿病（血糖長期偏高）',     'underlying', 1, true, false, false, 'HbA1c trending up x 2 cycles',            1500, ['mock-001-sd-2'], { dx: 5, med: 2, lab: 8 }),
  ],
  'mock-002': [
    p('mock-002', 1, 'I48.91','Atrial fibrillation, unspecified',     '心房顫動（心律不整）',             'following',  1, true, true,  true,  'AF cannot be excluded — pending Holter', 14,  ['mock-002-sd-1'], { dx: 1, med: 0, lab: 2 }),
  ],
  'mock-003': [
    p('mock-003', 1, 'E11.9','第二型糖尿病 (HbA1c 9.1)',             '第二型糖尿病',                     'underlying', 2, true, true,  false, 'On metformin — needs intensification', 1100,  ['mock-003-sd-1'], { dx: 2, med: 1, lab: 4 }),
  ],
  'mock-004': [
    p('mock-004', 1, 'E78.0','Hyperlipidemia (LDL 198)',             '高血脂（壞膽固醇偏高）',           'underlying', 2, true, false, false, 'Start statin discussion',                900,  ['mock-004-sd-1'], { dx: 1, med: 0, lab: 3 }),
    p('mock-004', 2, 'E66.9','Metabolic syndrome',                   '代謝症候群',                       'following',  2, false, false, true,  'BMI 31.2; suspected metabolic syndrome', 900, ['mock-004-sd-1'], { dx: 1, med: 0, lab: 2 }),
  ],
  'mock-005': [
    p('mock-005', 1, 'I10',  'Hypertension (elderly, controlled)',   '高血壓（已控制）',                 'underlying', 2, true, true,  false, '132d follow-up gap; call attempted',    2200, ['mock-005-sd-1'], { dx: 4, med: 1, lab: 2 }),
    p('mock-005', 2, 'M15.0','Osteoarthritis, multiple joints',      '退化性關節炎',                     'underlying', 3, true, true,  false, null,                                     800, [],                { dx: 2, med: 0, lab: 0 }),
  ],
  'mock-006': [
    p('mock-006', 1, 'E11.9','第二型糖尿病 (controlled, HbA1c 6.8)','第二型糖尿病（控制良好）',         'underlying', 3, true, true,  false, null,                                    2000, ['mock-006-sd-1'], { dx: 3, med: 1, lab: 5 }),
  ],
  'mock-007': [
    p('mock-007', 1, 'E78.0','Hyperlipidemia (mild)',                '高血脂（輕度）',                   'underlying', 3, true, false, false, null,                                     400, ['mock-007-sd-1'], { dx: 1, med: 0, lab: 2 }),
  ],
  'mock-008': [
    p('mock-008', 1, 'S52.5','Right distal radius fracture (post-op)','右側橈骨骨折（術後復健中）',       'following',  3, true, true,  false, '橈骨術後第 8 週；功能漸佳',               60,  ['mock-008-sd-1'], { dx: 1, med: 0, lab: 0 }),
  ],
  'mock-009': [
    p('mock-009', 1, 'I25.1','Coronary heart disease, post-stent',   '冠心病（裝過支架）',               'underlying', 3, true, true,  false, null,                                    1800, ['mock-009-sd-1'], { dx: 1, med: 1, lab: 3 }),
  ],
  'mock-010': [],
  'mock-011': [],
  'mock-012': [
    p('mock-012', 1, 'I61.0','Acute hemorrhagic stroke (right basal ganglia)', '腦出血（右側基底核）',     'following',  1, false, false, false, 'CT: 18 mL hemorrhage — admitted; pending review', 3, ['mock-012-sd-1', 'mock-012-sd-2'], { dx: 1, med: 0, lab: 4 }),
  ],
  'mock-013': [
    p('mock-013', 1, 'I10',  'Essential hypertension (worsening)',   '高血壓（趨勢惡化）',               'underlying', 2, true, true,  false, 'Home BP rising over 30d',                900, ['mock-013-sd-1'], { dx: 2, med: 1, lab: 2 }),
  ],
  'mock-014': [
    p('mock-014', 1, 'K76.0','Non-alcoholic fatty liver disease',    '脂肪肝',                           'underlying', 3, true, false, false, '212d 未追蹤；ALT 仍偏高',                300, ['mock-014-sd-1'], { dx: 1, med: 0, lab: 1 }),
  ],
  'mock-015': [
    p('mock-015', 1, null,   'Multiple borderline lab values',        '多項邊緣值檢驗',                   'following',  3, false, false, true,  'TSH/Ferritin/Vit-D borderline — pending workup', 30, ['mock-015-sd-1'], { dx: 0, med: 0, lab: 4 }),
  ],
  'mock-016': [
    p('mock-016', 1, 'E11.9','第二型糖尿病 (uncontrolled)',          '第二型糖尿病',                     'underlying', 2, true, true,  false, 'Triple comorbidity — ABCD bundle priority', 1800, ['mock-016-sd-1'], { dx: 3, med: 1, lab: 5 }),
    p('mock-016', 2, 'I10',  'Essential hypertension',               '高血壓',                           'underlying', 2, true, true,  false, null,                                     1800, ['mock-016-sd-1'], { dx: 3, med: 1, lab: 2 }),
    p('mock-016', 3, 'E78.0','Hyperlipidemia',                       '高血脂',                           'underlying', 3, false, false, false, 'LDL 172 — pending statin titration',    1800, ['mock-016-sd-1'], { dx: 2, med: 0, lab: 3 }),
  ],
}

// Patient → source documents (audit / traceability)
export const MOCK_SOURCE_DOCS: Record<string, SourceDocument[]> = {
  'mock-001': [
    sd('mock-001', 1, 'nhi_html', 'NHI_health_passbook_20260110.html', 110),
    sd('mock-001', 2, 'paper_scan', 'lab_report_HbA1c_20260109.pdf',   111),
  ],
  'mock-002': [sd('mock-002', 1, 'paper_scan', 'ECG_strip_20260523.pdf', 8)],
  'mock-003': [sd('mock-003', 1, 'nhi_html', 'NHI_health_passbook_20260415.html', 46)],
  'mock-004': [sd('mock-004', 1, 'photo', 'lab_sheet_lipid_20260403.jpg', 59, 'done')],
  'mock-005': [sd('mock-005', 1, 'nhi_html', 'NHI_health_passbook_20260120.html', 132)],
  'mock-006': [sd('mock-006', 1, 'nhi_html', 'NHI_health_passbook_20260517.html', 15)],
  'mock-007': [sd('mock-007', 1, 'paper_scan', 'lipid_panel_2026Q2.pdf', 22)],
  'mock-008': [sd('mock-008', 1, 'paper_scan', 'OR_record_radius_ORIF_20260326.pdf', 60)],
  'mock-009': [sd('mock-009', 1, 'nhi_html', 'NHI_health_passbook_20260513.html', 19)],
  'mock-012': [
    sd('mock-012', 1, 'dicom', 'CT_brain_noncontrast_20260528.dcm', 3),
    sd('mock-012', 2, 'paper_scan', 'ER_admit_note_20260528.pdf',   3),
  ],
  'mock-013': [sd('mock-013', 1, 'nhi_html', 'NHI_health_passbook_20260421.html', 41)],
  'mock-014': [sd('mock-014', 1, 'paper_scan', 'liver_panel_2025Q3.pdf',   213)],
  'mock-015': [sd('mock-015', 1, 'photo', 'lab_sheet_multi_20260520.jpg', 12, 'pending')],
  'mock-016': [sd('mock-016', 1, 'nhi_html', 'NHI_health_passbook_20260511.html', 21)],
}

// Patient → allergies (Critical Red Zone Tier 1/2)
export const MOCK_ALLERGIES: Record<string, Allergy[]> = {
  'mock-001': [ag('mock-001', 1, 'Penicillin (盤尼西林)',       'severe',   'confirmed', 1)],
  'mock-002': [ag('mock-002', 1, 'Iodine contrast (顯影劑)',    'moderate', 'confirmed', 1)],
  'mock-005': [ag('mock-005', 1, 'NSAID (非類固醇消炎藥)',      'severe',   'confirmed', 1)],
  'mock-009': [ag('mock-009', 1, 'Aspirin',                     'moderate', 'suspected', 2, false)],
  'mock-012': [ag('mock-012', 1, 'Iodine contrast (顯影劑)',    'severe',   'confirmed', 1)],
}

// Map queue_type → spec queue category (for KPI counts)
export const MOCK_QUEUE_TYPE: Record<string, QueueCategory> = {
  'mock-001': 'nhi_review',
  'mock-002': 'awaiting_review',
  'mock-003': 'nhi_review',
  'mock-004': 'awaiting_publish',
  'mock-005': 'awaiting_review',
  'mock-006': 'nhi_review',
  'mock-007': 'awaiting_publish',
  'mock-008': 'ocr_pending',
  'mock-009': 'awaiting_customer',
  'mock-011': 'new_patient',
  'mock-012': 'awaiting_review',
  'mock-013': 'nhi_review',
  'mock-014': 'awaiting_review',
  'mock-015': 'ocr_pending',
  'mock-016': 'nhi_review',
}

// Mock alerts referencing the mock patients above. Severity is derived from
// the patient's abnormal findings so the Alert Center and Top Priority list
// stay consistent.
export const MOCK_ALERTS = [
  {
    level: 'high' as const, category: 'critical_lab_value',
    user_id: 'mock-001', display_name: '王秋華',
    message: 'HbA1c 10.4% (critical) — uncontrolled diabetes, follow-up overdue 110 days',
  },
  {
    level: 'high' as const, category: 'abnormal_blood_pressure',
    user_id: 'mock-001', display_name: '王秋華',
    message: 'BP 192/108 mmHg — stage-3 hypertension, immediate review suggested',
  },
  {
    level: 'high' as const, category: 'worsening_trend',
    user_id: 'mock-002', display_name: '林志強',
    message: 'ECG showing irregular rhythm — atrial fibrillation cannot be excluded',
  },
  {
    level: 'high' as const, category: 'critical_lab_value',
    user_id: 'mock-012', display_name: '簡明峰',
    message: 'CT brain: right basal ganglia hemorrhage 18 mL — admitted',
  },
  {
    level: 'medium' as const, category: 'missing_followup',
    user_id: 'mock-005', display_name: '吳秀英',
    message: 'No activity > 130 days; last BP reading was uncontrolled',
  },
  {
    level: 'medium' as const, category: 'worsening_trend',
    user_id: 'mock-013', display_name: '廖佳怡',
    message: 'Home BP rising trend over 30 days (148 → 162 systolic)',
  },
]
