// 病人端生命徵象的「參考區間」標示。
//
// 只做事實性提示（偏高 / 偏低 / 留意 / 正常），**非診斷、不取代醫師**。
// 用途：色彩 > 數字 > 文字的跨代可讀性——讓長輩/看護一眼看出「紅還是綠」。
// 門檻採一般成人常見參考值；血糖無法區分空腹/餐後，故 ≥126 標偏高、100–125 標留意。

export type VitalLevel = 'normal' | 'watch' | 'high' | 'low' | 'none';

export interface VitalFlag {
  level: VitalLevel;
  label: string;   // 正常 / 偏高 / 偏低 / 留意 / 偏快 …（空字串代表不標示）
  color: string;   // 卡片主色（accent）
  bg: string;      // 徽章底色
  fg: string;      // 徽章/數值文字色
}

const NONE: VitalFlag = { level: 'none', label: '', color: '#94a3b8', bg: 'transparent', fg: '#94a3b8' };
const NORMAL: VitalFlag = { level: 'normal', label: '正常', color: '#16a34a', bg: '#dcfce7', fg: '#15803d' };
const HIGH: VitalFlag = { level: 'high', label: '偏高', color: '#dc2626', bg: '#fee2e2', fg: '#b91c1c' };
const LOW: VitalFlag = { level: 'low', label: '偏低', color: '#2563eb', bg: '#dbeafe', fg: '#1d4ed8' };
const WATCH: VitalFlag = { level: 'watch', label: '留意', color: '#d97706', bg: '#fef3c7', fg: '#b45309' };

function num(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 回傳某筆量測值相對於一般參考區間的標示。未知類型或無值 → none（不標示）。 */
export function vitalFlag(type: string, value1: string | null, value2?: string | null): VitalFlag {
  const v1 = num(value1);
  const v2 = num(value2);
  switch (type) {
    case 'blood_pressure': {
      if (v1 == null) return NONE;
      if (v1 >= 180 || (v2 != null && v2 >= 110)) return { ...HIGH, label: '明顯偏高' };
      if (v1 >= 140 || (v2 != null && v2 >= 90)) return HIGH;
      if (v1 < 90 || (v2 != null && v2 < 60)) return LOW;
      return NORMAL;
    }
    case 'heart_rate': {
      if (v1 == null) return NONE;
      if (v1 > 100) return { ...HIGH, label: '偏快' };
      if (v1 < 60) return { ...LOW, label: '偏緩' };
      return NORMAL;
    }
    case 'glucose': {
      if (v1 == null) return NONE;
      if (v1 >= 200) return { ...HIGH, label: '明顯偏高' };
      if (v1 >= 126) return HIGH;                 // 一般空腹參考上限
      if (v1 >= 100) return { ...WATCH, label: '偏高' };
      if (v1 < 70) return { ...LOW, label: '偏低' };
      return NORMAL;
    }
    case 'bmi': {
      if (v1 == null) return NONE;
      if (v1 >= 27) return HIGH;                  // 台灣肥胖定義 ≥27
      if (v1 >= 24) return { ...WATCH, label: '過重' };
      if (v1 < 18.5) return { ...LOW, label: '偏低' };
      return NORMAL;
    }
    case 'body_fat': {
      if (v1 == null) return NONE;
      if (v1 > 30) return HIGH;
      return NORMAL;
    }
    case 'spo2': {
      if (v1 == null) return NONE;
      if (v1 < 90) return { ...HIGH, label: '偏低' };   // 血氧偏低用警示色
      if (v1 < 95) return { ...WATCH, label: '偏低' };
      return NORMAL;
    }
    case 'temperature': {
      if (v1 == null) return NONE;
      if (v1 >= 38) return { ...HIGH, label: '發燒' };
      if (v1 < 36) return { ...LOW, label: '偏低' };
      return NORMAL;
    }
    // 生活型指標（步數 / 睡眠 / 體重）不做臨床紅標，交由趨勢呈現
    default:
      return NONE;
  }
}

export function isAbnormal(flag: VitalFlag | null | undefined): boolean {
  return !!flag && (flag.level === 'high' || flag.level === 'low' || flag.level === 'watch');
}
