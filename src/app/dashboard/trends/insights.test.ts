import { describe, expect, it } from 'vitest';
import { analyzeHealthRecords, type HealthRecord } from './insights';

function record(id: string, recordType: string, value: number): HealthRecord {
  return {
    id,
    record_type: recordType,
    value1: String(value),
    value2: null,
    unit: null,
    recorded_at: `2026-08-${String(12 - Number(id)).padStart(2, '0')}T08:00:00Z`,
  };
}

describe('plain-language numeric summaries', () => {
  it('describes persisted values without claiming a diagnosis or treatment', () => {
    const insights = analyzeHealthRecords([
      record('1', 'blood_pressure', 150),
      record('2', 'blood_pressure', 145),
      record('3', 'blood_pressure', 142),
    ], '本人');

    expect(insights.some((item) => item.kind === 'attention')).toBe(true);
    expect(insights.map((item) => item.body).join(' ')).toContain('並非診斷');
    expect(JSON.stringify(insights)).not.toMatch(/AI|治療建議/);
  });

  it('does not assume a glucose measurement was fasting', () => {
    const insights = analyzeHealthRecords([
      record('1', 'glucose', 138),
      record('2', 'glucose', 132),
    ], '本人');

    const glucose = insights.find((item) => item.metric === 'glucose');
    expect(glucose?.title).toContain('血糖平均');
    expect(glucose?.body).toContain('量測情境');
    expect(glucose?.title).not.toContain('空腹');
  });

  it('returns no fabricated preview when there are no records', () => {
    expect(analyzeHealthRecords([], '本人')).toEqual([]);
  });
});
