/** Canonical User-side route catalog used by navigation and server action URLs. */
export const INTERNAL_ROUTES = {
  dashboard: '/dashboard',
  ai: '/dashboard/ai',
  conditions: '/dashboard/conditions',
  documents: '/dashboard/documents',
  emergency: '/dashboard/emergency',
  health: '/dashboard/health',
  history: '/dashboard/history',
  imaging: '/dashboard/imaging',
  imagingShares: '/dashboard/imaging/shares',
  imagingUpload: '/dashboard/imaging/upload',
  medications: '/dashboard/medications',
  more: '/dashboard/more',
  nhi: '/dashboard/nhi',
  problems: '/dashboard/problems',
  redzone: '/dashboard/redzone',
  records: '/dashboard/records',
  reminders: '/dashboard/reminders',
  settings: '/dashboard/settings',
  tasks: '/dashboard/tasks',
  timeline: '/dashboard/timeline',
  trends: '/dashboard/trends',
  upload: '/dashboard/upload',
  setup: '/setup',
} as const;

const STATIC_INTERNAL_PATHS = new Set<string>(Object.values(INTERNAL_ROUTES));
const DYNAMIC_INTERNAL_PATHS = [
  /^\/dashboard\/clarifications\/[^/]+$/,
  /^\/dashboard\/imaging\/viewer\/[^/]+$/,
  /^\/dashboard\/nhi\/import\/[^/]+$/,
] as const;

function canonicalInternalPath(pathname: string): string {
  return /^\/dashboard\/health-(?:profile|summary)$/.test(pathname)
    ? INTERNAL_ROUTES.health
    : pathname;
}

function isKnownInternalPath(pathname: string): boolean {
  if (/%2f|%5c/i.test(pathname)) return false;
  return STATIC_INTERNAL_PATHS.has(pathname)
    || DYNAMIC_INTERNAL_PATHS.some((pattern) => pattern.test(pathname));
}

function isUnsafeRouteText(value: string): boolean {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { return true; }
  return value !== value.trim()
    || value.includes('\\')
    || decoded.includes('\\')
    || value.startsWith('//')
    || decoded.startsWith('//')
    || /^[a-z][a-z\d+.-]*:/i.test(value);
}

function parseInternalRoute(value: string | null | undefined): URL | null {
  if (!value || isUnsafeRouteText(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, 'https://healthkeep.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://healthkeep.invalid') return null;
  parsed.pathname = canonicalInternalPath(parsed.pathname);
  if (!isKnownInternalPath(parsed.pathname)) {
    return null;
  }
  return parsed;
}

/**
 * Validate a route that may be used as a login/setup return target.
 * Public token routes (viewer/emergency) and every external URL fail closed.
 */
export function safeNextRoute(value: string | null | undefined, fallback = '/dashboard'): string {
  const parsed = parseInternalRoute(value);
  if (!parsed) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function nextRouteFromSearch(search: string, fallback = '/dashboard'): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return safeNextRoute(params.get('next'), fallback);
}

export function routeWithNext(path: string, next: string | null | undefined): string {
  const safePath = path === '/upload-entry' || path === '/' ? path : safeNextRoute(path, '/dashboard');
  const parsed = new URL(safePath, 'https://healthkeep.invalid');
  if (next) parsed.searchParams.set('next', safeNextRoute(next));
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Allow API-provided action links only inside the authenticated app. */
export function safeInternalActionUrl(value: string | null | undefined, fallback = '/dashboard/history'): string {
  return safeNextRoute(value, fallback);
}

/** Use a stable in-app parent route instead of trusting an external referrer. */
export function stableParentBack(value: string | null | undefined, fallback = '/dashboard'): string {
  return safeNextRoute(value, fallback);
}

export function routeIsActive(pathname: string, href: string): boolean {
  return href === '/dashboard'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}
