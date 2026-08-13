export type HealthRecord = {
  id: string;
  member_name?: string;
  record_type: string;
  value1: string | null;
  value2: string | null;
  unit: string | null;
  recorded_at: string;
};

export type InsightKind = 'attention' | 'steady' | 'information' | 'reminder';

export type HealthInsight = {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  metric: string;
};

function numericValues(records: HealthRecord[]) {
  return records
    .map((record) => Number.parseFloat(record.value1 ?? ''))
    .filter((value) => Number.isFinite(value) && value > 0);
}
function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Plain-language, rule-based organization of persisted measurements.
 * It intentionally does not infer a diagnosis or a treatment recommendation.
 */
export function analyzeHealthRecords(records: HealthRecord[], memberName: string): HealthInsight[] {
  const insights: HealthInsight[] = [];
  const byType = records.reduce<Record<string, HealthRecord[]>>((result, record) => {
    (result[record.record_type] ??= []).push(record);
    return result;
  }, {});

  const bloodPressure = byType.blood_pressure ?? [];
  const systolicValues = numericValues(bloodPressure);
  if (systolicValues.length >= 3) {
    const mean = average(systolicValues);
    const recentThree = systolicValues.slice(0, 3);
    const rising = recentThree[0] > recentThree[1] && recentThree[1] > recentThree[2];
    const falling = recentThree[0] < recentThree[1] && recentThree[1] < recentThree[2];

    if (mean >= 140) {
      insights.push({
        id: 'blood-pressure-high',
        kind: 'attention',
        metric: 'blood_pressure',
        title: `${memberName}的血壓數值偏高`,
        body: `近 ${systolicValues.length} 次收縮壓平均為 ${mean.toFixed(0)} mmHg。這是數值整理，並非診斷；請帶著紀錄與醫療團隊確認。`,
      });
    } else if (mean < 130 && falling) {
      insights.push({
        id: 'blood-pressure-steady',
        kind: 'steady',
        metric: 'blood_pressure',
        title: '血壓數值近期下降',
        body: `近三次收縮壓呈下降變化，平均 ${mean.toFixed(0)} mmHg。請依原有照護計畫持續追蹤。`,
      });
    } else if (rising) {
      insights.push({
        id: 'blood-pressure-rising',
        kind: 'attention',
        metric: 'blood_pressure',
        title: '血壓數值近期上升',
        body: `近三次收縮壓為 ${recentThree[2]}、${recentThree[1]}、${recentThree[0]} mmHg。請確認量測方式一致，並帶著紀錄與醫療團隊討論。`,
      });
    } else {
      insights.push({
        id: 'blood-pressure-summary',
        kind: 'information',
        metric: 'blood_pressure',
        title: `血壓平均 ${mean.toFixed(0)} mmHg`,
        body: `已整理 ${bloodPressure.length} 筆量測。固定在相近時段與情境量測，較容易比較變化。`,
      });
    }
  } else if (bloodPressure.length > 0) {
    insights.push({
      id: 'blood-pressure-more-data',
      kind: 'reminder',
      metric: 'blood_pressure',
      title: '繼續記錄血壓',
      body: `目前有 ${bloodPressure.length} 筆紀錄，累積至少 3 筆後才能整理初步變化。`,
    });
  }

  const glucose = byType.glucose ?? [];
  const glucoseValues = numericValues(glucose);
  if (glucoseValues.length >= 2) {
    const mean = average(glucoseValues);
    insights.push({
      id: 'glucose-summary',
      kind: 'information',
      metric: 'glucose',
      title: `血糖平均 ${mean.toFixed(0)} mg/dL`,
      body: `已整理 ${glucoseValues.length} 次量測。血糖需要連同空腹、餐前或餐後等量測情境判讀；這裡只呈現數值，不代表診斷。`,
    });
  }

  const heartRate = byType.heart_rate ?? [];
  const heartRateValues = numericValues(heartRate);
  if (heartRateValues.length >= 2) {
    const mean = average(heartRateValues);
    const outsideCommonReference = mean < 60 || mean > 100;
    insights.push({
      id: 'heart-rate-summary',
      kind: outsideCommonReference ? 'attention' : 'steady',
      metric: 'heart_rate',
      title: outsideCommonReference ? '心跳數值需要留意' : '心跳數值在常見靜止參考範圍',
      body: `近期量測平均為 ${mean.toFixed(0)} bpm。這是數值整理，並非診斷；若量測時不在靜止狀態、身體不適或有疑問，請與醫療團隊確認。`,
    });
  }

  const steps = byType.steps ?? [];
  const stepValues = numericValues(steps);
  if (stepValues.length >= 3) {
    const mean = average(stepValues);
    insights.push({
      id: 'steps-summary',
      kind: mean >= 8000 ? 'steady' : 'reminder',
      metric: 'steps',
      title: `近期平均每日 ${mean.toFixed(0)} 步`,
      body: '活動安排應依個人體能、身體狀況與醫療團隊建議調整。',
    });
  }

  const sleep = byType.sleep ?? [];
  const sleepValues = numericValues(sleep);
  if (sleepValues.length >= 3) {
    const mean = average(sleepValues);
    const outsideCommonReference = mean < 7 || mean > 9;
    insights.push({
      id: 'sleep-summary',
      kind: outsideCommonReference ? 'reminder' : 'steady',
      metric: 'sleep',
      title: `近期平均睡眠 ${mean.toFixed(1)} 小時`,
      body: outsideCommonReference
        ? '這與成年人常見的睡眠時間參考有差異；若長期如此或伴隨不適，可與醫療團隊討論。'
        : '睡眠時間落在成年人常見參考範圍，請持續觀察自己的精神與身體狀況。',
    });
  }

  const bmi = numericValues(byType.bmi ?? [])[0];
  if (bmi) {
    const kind: InsightKind = bmi >= 30 ? 'attention' : bmi >= 24 || bmi < 18.5 ? 'information' : 'steady';
    insights.push({
      id: 'bmi-summary',
      kind,
      metric: 'bmi',
      title: `最新 BMI 為 ${bmi.toFixed(1)}`,
      body: 'BMI 是身體組成的單一參考值，並非診斷；如要調整體重、飲食或活動，請先與合適的醫療專業人員討論。',
    });
  }

  const bodyFat = numericValues(byType.body_fat ?? [])[0];
  if (bodyFat) {
    insights.push({
      id: 'body-fat-summary',
      kind: 'information',
      metric: 'body_fat',
      title: `最新體脂率為 ${bodyFat.toFixed(1)}%`,
      body: '體脂率參考範圍會受年齡、性別與量測方式影響；此處只整理數值變化。',
    });
  }

  if (records.length > 0 && records.length < 5) {
    insights.push({
      id: 'more-data',
      kind: 'reminder',
      metric: 'general',
      title: '累積更多紀錄，變化會更清楚',
      body: `目前共有 ${records.length} 筆紀錄。持續在相近條件下記錄，較容易比較長期變化。`,
    });
  }

  return insights;
}
