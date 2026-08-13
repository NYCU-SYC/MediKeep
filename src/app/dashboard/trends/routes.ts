export type TrendsSection = 'trends' | 'insights';

export function normalizeTrendsSection(value: string | null): TrendsSection {
  return value === 'insights' ? 'insights' : 'trends';
}
export function buildTrendsUrl(
  currentSearch: string,
  section: TrendsSection,
  hash = '',
) {
  const params = new URLSearchParams(currentSearch);
  params.set('section', section);
  const query = params.toString();
  const normalizedHash = hash && !hash.startsWith('#') ? `#${hash}` : hash;
  return `/dashboard/trends${query ? `?${query}` : ''}${normalizedHash}`;
}
