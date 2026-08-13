import { describe, expect, it } from 'vitest';
import { buildTrendsUrl, normalizeTrendsSection } from './routes';

describe('health trends compatibility routes', () => {
  it('preserves member, filters, job references, and hash when opening numeric summaries', () => {
    const url = buildTrendsUrl(
      'member=%E6%9C%AC%E4%BA%BA&filter=recent&import_job_id=job-42&section=trends',
      'insights',
      '#record-7',
    );

    expect(url).toBe('/dashboard/trends?member=%E6%9C%AC%E4%BA%BA&filter=recent&import_job_id=job-42&section=insights#record-7');
  });

  it('fails unknown sections back to the trend chart', () => {
    expect(normalizeTrendsSection('unknown')).toBe('trends');
    expect(normalizeTrendsSection(null)).toBe('trends');
  });
});
