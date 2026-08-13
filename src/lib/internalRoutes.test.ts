import { describe, expect, it } from 'vitest';
import { routeWithNext, safeInternalActionUrl, safeNextRoute, stableParentBack } from './internalRoutes';

describe('internal route guards', () => {
  it('canonicalizes a legacy health return target without dropping its query or hash', () => {
    expect(safeNextRoute('/dashboard/health-profile?member=%E5%A6%88%E5%A6%88&problem=12&highlight=abc&tab=file&import=job-1'))
      .toBe('/dashboard/health?member=%E5%A6%88%E5%A6%88&problem=12&highlight=abc&tab=file&import=job-1');
    expect(safeNextRoute('/dashboard/health-summary?member=%E6%9C%AC%E4%BA%BA#confirmed'))
      .toBe('/dashboard/health?member=%E6%9C%AC%E4%BA%BA#confirmed');
  });

  it.each(['health', 'records', 'tasks', 'more'])('keeps the new %s entry and its member state', (route) => {
    expect(safeNextRoute(`/dashboard/${route}?member=%E6%9C%AC%E4%BA%BA&import=job-1`))
      .toBe(`/dashboard/${route}?member=%E6%9C%AC%E4%BA%BA&import=job-1`);
  });

  it.each([
    'https://evil.example/dashboard',
    '//evil.example/dashboard',
    '\\\\evil.example\\dashboard',
    '/dashboard/%5C%5Cevil.example',
    '/viewer/public-token',
    '/emergency/public-token',
    '/cmo/patients/1',
    '/dashboard/does-not-exist',
    '/dashboard/clarifications/%2Fetc',
  ])('rejects unsafe or public token route %s', (value) => {
    expect(safeNextRoute(value)).toBe('/dashboard');
  });

  it('allowlists API action URLs and stable back routes', () => {
    expect(safeInternalActionUrl('/dashboard/clarifications/abc?member=%E6%9C%AC%E4%BA%BA')).toContain('/dashboard/clarifications/abc');
    expect(safeInternalActionUrl('https://evil.example')).toBe('/dashboard/history');
    expect(stableParentBack('/setup?mode=join&code=ABCDEFGH')).toBe('/setup?mode=join&code=ABCDEFGH');
    expect(stableParentBack('/viewer/token')).toBe('/dashboard');
  });

  it('adds a validated next target without dropping the existing path', () => {
    expect(routeWithNext('/setup', '/dashboard/reminders?member=%E6%9C%AC%E4%BA%BA&highlight=followup-1'))
      .toBe('/setup?next=%2Fdashboard%2Freminders%3Fmember%3D%25E6%259C%25AC%25E4%25BA%25BA%26highlight%3Dfollowup-1');
  });

  it('preserves invite parameters while adding a safe next target', () => {
    expect(routeWithNext('/setup?mode=join&code=AB12CD34', '/dashboard?member=%E6%9C%AC%E4%BA%BA'))
      .toBe('/setup?mode=join&code=AB12CD34&next=%2Fdashboard%3Fmember%3D%25E6%259C%25AC%25E4%25BA%25BA');
  });
});
