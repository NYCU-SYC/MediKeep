// Central clinical dictionary — single source of truth so the CMO picks instead
// of typing. One diagnosis pick fills ICD-10 + English name + 白話名稱 + default
// tier/status; one drug pick fills generic/brand + dose & frequency chips.
// Pure data + lookup functions; UI components live in cmo _components/quickpick.

export type ProblemStatusDefault = 'underlying' | 'following' | 'resolved'

export interface DiagnosisEntry {
  icd10: string
  name_en: string
  name_zh: string
  /** 病人端白話名稱；沒有更好的說法時等於 name_zh */
  layman: string
  tier: 1 | 2 | 3
  status: ProblemStatusDefault
  /** C7「檢查」格常用追蹤項目 */
  checks?: readonly string[]
  aliases?: readonly string[]
  /** 顯示在空白搜尋與快選 chips 的常見診斷 */
  common?: boolean
}

export const TIER_TO_SEVERITY = { 1: 'high', 2: 'medium', 3: 'low' } as const

export const DIAGNOSES: readonly DiagnosisEntry[] = [
  { icd10: 'I10', name_en: 'Essential hypertension', name_zh: '高血壓', layman: '高血壓（血管壓力長期偏高）', tier: 2, status: 'underlying', checks: ['血壓'], aliases: ['HTN'], common: true },
  { icd10: 'E11.9', name_en: 'Type 2 diabetes mellitus', name_zh: '第二型糖尿病', layman: '第二型糖尿病（血糖長期偏高）', tier: 2, status: 'underlying', checks: ['血糖', 'HbA1c'], aliases: ['DM', '糖尿'], common: true },
  { icd10: 'E78.5', name_en: 'Hyperlipidemia', name_zh: '高血脂症', layman: '高血脂（血液中的油脂偏高）', tier: 2, status: 'underlying', checks: ['LDL'], aliases: ['血脂'], common: true },
  { icd10: 'E78.00', name_en: 'Pure hypercholesterolemia', name_zh: '高膽固醇血症', layman: '高膽固醇血症', tier: 2, status: 'underlying', checks: ['LDL'] },
  { icd10: 'E79.0', name_en: 'Hyperuricemia', name_zh: '高尿酸血症', layman: '高尿酸血症（尿酸偏高）', tier: 3, status: 'underlying', checks: ['尿酸'] },
  { icd10: 'N18.9', name_en: 'Chronic kidney disease', name_zh: '慢性腎臟病', layman: '慢性腎臟病（腎功能需要長期追蹤）', tier: 1, status: 'underlying', checks: ['腎功能', 'eGFR'], aliases: ['CKD'], common: true },
  { icd10: 'N18.3', name_en: 'Chronic kidney disease, stage 3', name_zh: '慢性腎臟病第三期', layman: '慢性腎臟病第三期（腎功能中度下降）', tier: 1, status: 'underlying', checks: ['腎功能', 'eGFR'], aliases: ['CKD3'] },
  { icd10: 'I48.91', name_en: 'Atrial fibrillation', name_zh: '心房顫動', layman: '心房顫動（心跳節律不規則）', tier: 1, status: 'following', checks: ['心電圖'], aliases: ['AF', 'Afib'], common: true },
  { icd10: 'I25.10', name_en: 'Coronary artery disease', name_zh: '冠狀動脈疾病', layman: '冠心病（心臟血管狹窄）', tier: 1, status: 'underlying', aliases: ['CAD', '冠心'] },
  { icd10: 'I25.2', name_en: 'Old myocardial infarction', name_zh: '陳舊性心肌梗塞', layman: '曾發生過心肌梗塞', tier: 1, status: 'underlying', aliases: ['OMI', 'MI'] },
  { icd10: 'I50.9', name_en: 'Heart failure', name_zh: '心臟衰竭', layman: '心臟衰竭（心臟功能變差）', tier: 1, status: 'following', checks: ['體重', '心臟超音波'], aliases: ['HF', 'CHF'] },
  { icd10: 'I63.9', name_en: 'Cerebral infarction', name_zh: '腦梗塞', layman: '缺血性腦中風', tier: 1, status: 'following', aliases: ['中風', 'stroke', 'CVA'] },
  { icd10: 'I69.30', name_en: 'Sequelae of cerebral infarction', name_zh: '腦中風後遺症', layman: '腦中風後遺症（復健追蹤中）', tier: 2, status: 'underlying' },
  { icd10: 'G45.9', name_en: 'Transient ischemic attack', name_zh: '短暫性腦缺血發作', layman: '短暫性腦缺血（小中風）', tier: 1, status: 'following', aliases: ['TIA'] },
  { icd10: 'I73.9', name_en: 'Peripheral arterial disease', name_zh: '周邊動脈疾病', layman: '周邊動脈疾病（手腳血管狹窄）', tier: 2, status: 'following', aliases: ['PAD'] },
  { icd10: 'E03.9', name_en: 'Hypothyroidism', name_zh: '甲狀腺功能低下', layman: '甲狀腺功能低下', tier: 2, status: 'underlying', checks: ['TSH'] },
  { icd10: 'E05.90', name_en: 'Hyperthyroidism', name_zh: '甲狀腺功能亢進', layman: '甲狀腺功能亢進', tier: 2, status: 'following', checks: ['TSH'] },
  { icd10: 'E04.1', name_en: 'Thyroid nodule', name_zh: '甲狀腺結節', layman: '甲狀腺結節（定期追蹤）', tier: 3, status: 'following', checks: ['甲狀腺超音波'] },
  { icd10: 'K21.9', name_en: 'Gastroesophageal reflux disease', name_zh: '胃食道逆流', layman: '胃食道逆流（胃酸往上跑）', tier: 3, status: 'following', aliases: ['GERD'], common: true },
  { icd10: 'K25.9', name_en: 'Gastric ulcer', name_zh: '胃潰瘍', layman: '胃潰瘍', tier: 3, status: 'following' },
  { icd10: 'K29.70', name_en: 'Gastritis', name_zh: '胃炎', layman: '胃炎', tier: 3, status: 'following' },
  { icd10: 'B18.1', name_en: 'Chronic hepatitis B', name_zh: '慢性B型肝炎', layman: '慢性B型肝炎（需定期追蹤肝功能）', tier: 2, status: 'underlying', checks: ['肝功能', '腹部超音波'], aliases: ['HBV', 'B肝'], common: true },
  { icd10: 'B18.2', name_en: 'Chronic hepatitis C', name_zh: '慢性C型肝炎', layman: '慢性C型肝炎', tier: 2, status: 'underlying', checks: ['肝功能'], aliases: ['HCV', 'C肝'] },
  { icd10: 'K76.0', name_en: 'Fatty liver', name_zh: '脂肪肝', layman: '脂肪肝', tier: 3, status: 'underlying', checks: ['肝功能'], aliases: ['NAFLD'] },
  { icd10: 'K74.60', name_en: 'Cirrhosis of liver', name_zh: '肝硬化', layman: '肝硬化（肝臟長期受損）', tier: 1, status: 'underlying', checks: ['肝功能', '腹部超音波'] },
  { icd10: 'M10.9', name_en: 'Gout', name_zh: '痛風', layman: '痛風（尿酸結晶造成關節發炎）', tier: 3, status: 'underlying', checks: ['尿酸'], common: true },
  { icd10: 'M81.0', name_en: 'Osteoporosis', name_zh: '骨質疏鬆症', layman: '骨質疏鬆（骨頭密度變低）', tier: 3, status: 'underlying', checks: ['骨密度'] },
  { icd10: 'M17.9', name_en: 'Osteoarthritis of knee', name_zh: '退化性膝關節炎', layman: '退化性膝關節炎', tier: 3, status: 'underlying' },
  { icd10: 'M54.5', name_en: 'Low back pain', name_zh: '下背痛', layman: '下背痛', tier: 3, status: 'following' },
  { icd10: 'J44.9', name_en: 'Chronic obstructive pulmonary disease', name_zh: '慢性阻塞性肺病', layman: '慢性阻塞性肺病（呼吸道長期阻塞）', tier: 2, status: 'underlying', aliases: ['COPD'] },
  { icd10: 'J45.909', name_en: 'Asthma', name_zh: '氣喘', layman: '氣喘', tier: 2, status: 'underlying', common: true },
  { icd10: 'G47.33', name_en: 'Obstructive sleep apnea', name_zh: '阻塞型睡眠呼吸中止症', layman: '睡眠呼吸中止（睡覺時呼吸暫停）', tier: 2, status: 'following', aliases: ['OSA'] },
  { icd10: 'J30.9', name_en: 'Allergic rhinitis', name_zh: '過敏性鼻炎', layman: '過敏性鼻炎', tier: 3, status: 'underlying' },
  { icd10: 'F32.9', name_en: 'Major depressive disorder', name_zh: '憂鬱症', layman: '憂鬱症', tier: 2, status: 'following' },
  { icd10: 'F41.1', name_en: 'Generalized anxiety disorder', name_zh: '焦慮症', layman: '焦慮症', tier: 3, status: 'following' },
  { icd10: 'G47.00', name_en: 'Insomnia', name_zh: '失眠', layman: '失眠', tier: 3, status: 'following', common: true },
  { icd10: 'F03.90', name_en: 'Dementia', name_zh: '失智症', layman: '失智症（記憶與認知退化）', tier: 2, status: 'underlying' },
  { icd10: 'G30.9', name_en: "Alzheimer's disease", name_zh: '阿茲海默症', layman: '阿茲海默症（退化性失智）', tier: 2, status: 'underlying' },
  { icd10: 'G20', name_en: "Parkinson's disease", name_zh: '帕金森氏症', layman: '帕金森氏症（動作變慢、手抖）', tier: 2, status: 'underlying' },
  { icd10: 'G43.909', name_en: 'Migraine', name_zh: '偏頭痛', layman: '偏頭痛', tier: 3, status: 'following' },
  { icd10: 'N40.0', name_en: 'Benign prostatic hyperplasia', name_zh: '攝護腺肥大', layman: '攝護腺肥大（排尿變慢）', tier: 3, status: 'underlying', aliases: ['BPH'] },
  { icd10: 'N39.0', name_en: 'Urinary tract infection', name_zh: '泌尿道感染', layman: '泌尿道感染', tier: 3, status: 'following', aliases: ['UTI'] },
  { icd10: 'E66.9', name_en: 'Obesity', name_zh: '肥胖症', layman: '肥胖（體重需要控制）', tier: 3, status: 'underlying', checks: ['體重'] },
  { icd10: 'D64.9', name_en: 'Anemia', name_zh: '貧血', layman: '貧血', tier: 3, status: 'following', checks: ['血紅素'] },
  { icd10: 'D50.9', name_en: 'Iron deficiency anemia', name_zh: '缺鐵性貧血', layman: '缺鐵性貧血', tier: 3, status: 'following', checks: ['血紅素'] },
  { icd10: 'H40.9', name_en: 'Glaucoma', name_zh: '青光眼', layman: '青光眼（眼壓需要追蹤）', tier: 2, status: 'underlying', checks: ['眼壓'] },
  { icd10: 'H25.9', name_en: 'Age-related cataract', name_zh: '白內障', layman: '白內障', tier: 3, status: 'following' },
  { icd10: 'L20.9', name_en: 'Atopic dermatitis', name_zh: '異位性皮膚炎', layman: '異位性皮膚炎', tier: 3, status: 'underlying' },
  { icd10: 'L50.9', name_en: 'Urticaria', name_zh: '蕁麻疹', layman: '蕁麻疹', tier: 3, status: 'following' },
  { icd10: 'C50.919', name_en: 'Breast cancer', name_zh: '乳癌', layman: '乳癌（治療後定期追蹤）', tier: 1, status: 'following', aliases: ['乳房惡性腫瘤'] },
  { icd10: 'C61', name_en: 'Prostate cancer', name_zh: '攝護腺癌', layman: '攝護腺癌（定期追蹤）', tier: 1, status: 'following', checks: ['PSA'] },
  { icd10: 'C34.90', name_en: 'Lung cancer', name_zh: '肺癌', layman: '肺癌（定期追蹤）', tier: 1, status: 'following' },
  { icd10: 'C18.9', name_en: 'Colon cancer', name_zh: '大腸癌', layman: '大腸癌（定期追蹤）', tier: 1, status: 'following', aliases: ['CRC'] },
  { icd10: 'C22.0', name_en: 'Hepatocellular carcinoma', name_zh: '肝癌', layman: '肝癌（定期追蹤）', tier: 1, status: 'following', aliases: ['HCC'] },
  { icd10: 'C73', name_en: 'Thyroid cancer', name_zh: '甲狀腺癌', layman: '甲狀腺癌（治療後追蹤）', tier: 1, status: 'following' },
]

export interface DrugEntry {
  generic: string
  brands?: readonly string[]
  /** 常見中文品名（CMO/藥袋常見稱呼） */
  zh?: string
  /** 用途分類（可直接帶入 indication 欄位） */
  category: string
  doses: readonly string[]
  frequencies: readonly string[]
  route?: string
  common?: boolean
}

export const DRUGS: readonly DrugEntry[] = [
  { generic: 'metformin', brands: ['Glucophage'], zh: '庫魯化', category: '降血糖', doses: ['500 mg', '850 mg', '1000 mg'], frequencies: ['每日2次', '每日1次'], common: true },
  { generic: 'sitagliptin', brands: ['Januvia'], zh: '佳糖維', category: '降血糖', doses: ['50 mg', '100 mg'], frequencies: ['每日1次'] },
  { generic: 'linagliptin', brands: ['Trajenta'], zh: '糖漸平', category: '降血糖', doses: ['5 mg'], frequencies: ['每日1次'] },
  { generic: 'empagliflozin', brands: ['Jardiance'], zh: '恩排糖', category: '降血糖', doses: ['10 mg', '25 mg'], frequencies: ['每日1次'] },
  { generic: 'dapagliflozin', brands: ['Forxiga'], zh: '福適佳', category: '降血糖', doses: ['10 mg'], frequencies: ['每日1次'] },
  { generic: 'glimepiride', brands: ['Amaryl'], zh: '瑪爾胰', category: '降血糖', doses: ['1 mg', '2 mg', '4 mg'], frequencies: ['每日1次'] },
  { generic: 'gliclazide', brands: ['Diamicron'], category: '降血糖', doses: ['30 mg', '60 mg'], frequencies: ['每日1次'] },
  { generic: 'insulin glargine', brands: ['Lantus'], zh: '蘭德仕', category: '長效胰島素', doses: ['依醫囑單位'], frequencies: ['每日1次', '睡前'], route: '皮下注射' },
  { generic: 'amlodipine', brands: ['Norvasc'], zh: '脈優', category: '降血壓', doses: ['5 mg', '10 mg'], frequencies: ['每日1次'], common: true },
  { generic: 'losartan', brands: ['Cozaar'], category: '降血壓', doses: ['50 mg', '100 mg'], frequencies: ['每日1次'] },
  { generic: 'valsartan', brands: ['Diovan'], zh: '得安穩', category: '降血壓', doses: ['80 mg', '160 mg'], frequencies: ['每日1次'] },
  { generic: 'lisinopril', brands: ['Zestril'], category: '降血壓', doses: ['5 mg', '10 mg', '20 mg'], frequencies: ['每日1次'] },
  { generic: 'enalapril', category: '降血壓', doses: ['5 mg', '10 mg'], frequencies: ['每日1次', '每日2次'] },
  { generic: 'hydrochlorothiazide', category: '降血壓/利尿', doses: ['12.5 mg', '25 mg'], frequencies: ['每日1次'] },
  { generic: 'furosemide', brands: ['Lasix'], category: '利尿劑', doses: ['20 mg', '40 mg'], frequencies: ['每日1次', '每日2次'] },
  { generic: 'spironolactone', brands: ['Aldactone'], category: '利尿/心臟衰竭', doses: ['25 mg'], frequencies: ['每日1次'] },
  { generic: 'bisoprolol', brands: ['Concor'], zh: '康肯', category: '降血壓/心律', doses: ['1.25 mg', '2.5 mg', '5 mg'], frequencies: ['每日1次'] },
  { generic: 'metoprolol', brands: ['Betaloc'], zh: '舒壓寧', category: '降血壓/心律', doses: ['25 mg', '50 mg', '100 mg'], frequencies: ['每日1次', '每日2次'] },
  { generic: 'carvedilol', brands: ['Dilatrend'], zh: '達利全', category: '心臟衰竭/降血壓', doses: ['6.25 mg', '12.5 mg', '25 mg'], frequencies: ['每日2次'] },
  { generic: 'atorvastatin', brands: ['Lipitor'], zh: '立普妥', category: '降血脂', doses: ['10 mg', '20 mg', '40 mg'], frequencies: ['每日1次', '睡前'], common: true },
  { generic: 'rosuvastatin', brands: ['Crestor'], zh: '冠脂妥', category: '降血脂', doses: ['5 mg', '10 mg', '20 mg'], frequencies: ['每日1次'] },
  { generic: 'aspirin', brands: ['Bokey'], zh: '伯基', category: '抗血小板', doses: ['100 mg'], frequencies: ['每日1次'], common: true },
  { generic: 'clopidogrel', brands: ['Plavix'], zh: '保栓通', category: '抗血小板', doses: ['75 mg'], frequencies: ['每日1次'] },
  { generic: 'warfarin', brands: ['Coumadin'], zh: '可邁丁', category: '抗凝血', doses: ['1 mg', '2.5 mg', '5 mg'], frequencies: ['每日1次'] },
  { generic: 'rivaroxaban', brands: ['Xarelto'], zh: '拜瑞妥', category: '抗凝血', doses: ['10 mg', '15 mg', '20 mg'], frequencies: ['每日1次'] },
  { generic: 'apixaban', brands: ['Eliquis'], zh: '艾必克凝', category: '抗凝血', doses: ['2.5 mg', '5 mg'], frequencies: ['每日2次'] },
  { generic: 'dabigatran', brands: ['Pradaxa'], zh: '普栓達', category: '抗凝血', doses: ['110 mg', '150 mg'], frequencies: ['每日2次'] },
  { generic: 'omeprazole', brands: ['Losec'], zh: '樂酸克', category: '胃酸抑制', doses: ['20 mg'], frequencies: ['每日1次', '早餐前'] },
  { generic: 'pantoprazole', brands: ['Pantoloc'], category: '胃酸抑制', doses: ['40 mg'], frequencies: ['每日1次'] },
  { generic: 'esomeprazole', brands: ['Nexium'], zh: '耐適恩', category: '胃酸抑制', doses: ['20 mg', '40 mg'], frequencies: ['每日1次'] },
  { generic: 'famotidine', brands: ['Gaster'], category: '胃酸抑制', doses: ['20 mg'], frequencies: ['每日2次', '睡前'] },
  { generic: 'levothyroxine', brands: ['Eltroxin'], zh: '昂特欣', category: '甲狀腺素補充', doses: ['50 mcg', '100 mcg'], frequencies: ['每日1次', '早餐前'] },
  { generic: 'allopurinol', brands: ['Zyloric'], category: '降尿酸', doses: ['100 mg', '300 mg'], frequencies: ['每日1次'] },
  { generic: 'febuxostat', brands: ['Feburic'], zh: '福避痛', category: '降尿酸', doses: ['40 mg', '80 mg'], frequencies: ['每日1次'] },
  { generic: 'colchicine', category: '痛風急性發作', doses: ['0.5 mg'], frequencies: ['需要時', '每日1次'] },
  { generic: 'acetaminophen', brands: ['Panadol'], zh: '普拿疼', category: '止痛退燒', doses: ['500 mg'], frequencies: ['需要時', '每日3次'], common: true },
  { generic: 'ibuprofen', category: '消炎止痛', doses: ['400 mg'], frequencies: ['需要時', '每日3次'] },
  { generic: 'diclofenac', brands: ['Voltaren'], zh: '服他寧', category: '消炎止痛', doses: ['25 mg', '50 mg'], frequencies: ['每日2次', '每日3次'] },
  { generic: 'celecoxib', brands: ['Celebrex'], zh: '希樂葆', category: '消炎止痛', doses: ['200 mg'], frequencies: ['每日1次', '每日2次'] },
  { generic: 'gabapentin', brands: ['Neurontin'], category: '神經痛', doses: ['100 mg', '300 mg'], frequencies: ['每日3次', '睡前'] },
  { generic: 'pregabalin', brands: ['Lyrica'], zh: '利瑞卡', category: '神經痛', doses: ['75 mg', '150 mg'], frequencies: ['每日2次'] },
  { generic: 'sertraline', brands: ['Zoloft'], zh: '樂復得', category: '抗憂鬱', doses: ['50 mg', '100 mg'], frequencies: ['每日1次'] },
  { generic: 'escitalopram', brands: ['Lexapro'], zh: '立普能', category: '抗憂鬱', doses: ['10 mg'], frequencies: ['每日1次'] },
  { generic: 'alprazolam', brands: ['Xanax'], zh: '贊安諾', category: '抗焦慮', doses: ['0.25 mg', '0.5 mg'], frequencies: ['需要時', '每日2次'] },
  { generic: 'lorazepam', brands: ['Ativan'], zh: '安定文', category: '抗焦慮', doses: ['0.5 mg', '1 mg'], frequencies: ['需要時', '睡前'] },
  { generic: 'zolpidem', brands: ['Stilnox'], zh: '使蒂諾斯', category: '助眠', doses: ['10 mg'], frequencies: ['睡前'] },
  { generic: 'montelukast', brands: ['Singulair'], zh: '欣流', category: '氣喘/過敏', doses: ['10 mg'], frequencies: ['睡前'] },
  { generic: 'tamsulosin', brands: ['Harnalidge'], zh: '活路利淨', category: '攝護腺肥大', doses: ['0.2 mg', '0.4 mg'], frequencies: ['每日1次'] },
  { generic: 'finasteride', brands: ['Proscar'], zh: '波斯卡', category: '攝護腺肥大', doses: ['5 mg'], frequencies: ['每日1次'] },
  { generic: 'donepezil', brands: ['Aricept'], zh: '愛憶欣', category: '失智症', doses: ['5 mg', '10 mg'], frequencies: ['睡前', '每日1次'] },
  { generic: 'amoxicillin', category: '抗生素', doses: ['500 mg'], frequencies: ['每日3次'] },
  { generic: 'prednisolone', category: '類固醇', doses: ['5 mg'], frequencies: ['每日1次', '依醫囑'] },
]

function norm(value: string) {
  return value.toLowerCase().trim()
}

function scoreMatch(haystacks: readonly string[], query: string) {
  let score = -1
  for (const raw of haystacks) {
    const hay = norm(raw)
    if (!hay) continue
    if (hay === query) score = Math.max(score, 3)
    else if (hay.startsWith(query)) score = Math.max(score, 2)
    else if (hay.includes(query)) score = Math.max(score, 1)
  }
  return score
}

/** 空字串回傳常見診斷，讓 CMO 完全不用打字也能點選。 */
export function searchDiagnoses(query: string, limit = 8): DiagnosisEntry[] {
  const q = norm(query)
  if (!q) return DIAGNOSES.filter((d) => d.common).slice(0, limit)
  return DIAGNOSES
    .map((d) => ({ d, score: scoreMatch([d.icd10, d.name_en, d.name_zh, d.layman, ...(d.aliases ?? [])], q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.d.common)) - Number(Boolean(a.d.common)))
    .slice(0, limit)
    .map((x) => x.d)
}

export function diagnosisByIcd10(code: string): DiagnosisEntry | undefined {
  const q = norm(code)
  return DIAGNOSES.find((d) => norm(d.icd10) === q)
}

export function searchDrugs(query: string, limit = 8): DrugEntry[] {
  const q = norm(query)
  if (!q) return DRUGS.filter((d) => d.common).slice(0, limit)
  return DRUGS
    .map((d) => ({ d, score: scoreMatch([d.generic, d.zh ?? '', d.category, ...(d.brands ?? [])], q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(b.d.common)) - Number(Boolean(a.d.common)))
    .slice(0, limit)
    .map((x) => x.d)
}

/** 由目前欄位值反查藥物（藥名/學名/商品名/中文名完全符合）。 */
export function drugByName(name: string | null | undefined): DrugEntry | undefined {
  const q = norm(name ?? '')
  if (!q) return undefined
  return DRUGS.find((d) =>
    norm(d.generic) === q
    || (d.zh && norm(d.zh) === q)
    || (d.brands ?? []).some((brand) => norm(brand) === q))
}

export function displayDrugName(entry: DrugEntry) {
  return entry.generic.charAt(0).toUpperCase() + entry.generic.slice(1)
}
