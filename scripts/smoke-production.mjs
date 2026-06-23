#!/usr/bin/env node

const rawBaseUrl = process.argv[2] || process.env.HEALTHKEEP_SITE_URL || process.env.NEXT_PUBLIC_FRONTEND_ORIGIN || process.env.NEXT_PUBLIC_PUBLIC_BASE_URL

if (!rawBaseUrl) {
  console.error('Usage: npm run smoke:production -- https://your-fixed-domain.example')
  process.exit(2)
}

const baseUrl = rawBaseUrl.replace(/\/$/, '')

const checks = [
  {
    name: 'Frontend deployment health',
    path: '/api/deployment/health',
    ok: (status) => status === 200,
  },
  {
    name: 'Patient entry route',
    path: '/dashboard',
    ok: (status) => status >= 200 && status < 400,
  },
  {
    name: 'CMO login route',
    path: '/cmo/login',
    ok: (status) => status === 200,
  },
  {
    name: 'CMO base redirect',
    path: '/cmo',
    ok: (status) => status >= 200 && status < 400,
    redirect: 'manual',
  },
  {
    name: 'Patient auth proxy',
    path: '/api/auth/me',
    ok: (status) => status === 200,
  },
  {
    name: 'CMO auth proxy',
    path: '/api/cmo/auth/me',
    ok: (status) => status === 401,
  },
]

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: check.redirect || 'follow',
  })
  const passed = check.ok(response.status)
  return {
    ...check,
    url,
    status: response.status,
    location: response.headers.get('location'),
    passed,
  }
}

const results = []

for (const check of checks) {
  try {
    results.push(await runCheck(check))
  } catch (error) {
    results.push({
      ...check,
      url: `${baseUrl}${check.path}`,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      passed: false,
    })
  }
}

for (const result of results) {
  const marker = result.passed ? 'PASS' : 'FAIL'
  const location = result.location ? ` -> ${result.location}` : ''
  const error = result.error ? ` (${result.error})` : ''
  console.log(`${marker} ${result.name}: ${result.status} ${result.url}${location}${error}`)
}

const failed = results.filter((result) => !result.passed)
if (failed.length > 0) {
  process.exit(1)
}
