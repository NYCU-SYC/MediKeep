import type { NextConfig } from 'next'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const configuredDistDir = process.env.HEALTHKEEP_NEXT_DIST_DIR || '.next'
let configuredTsconfig = process.env.HEALTHKEEP_NEXT_TSCONFIG

if (!configuredTsconfig && configuredDistDir !== '.next') {
  const safeDistName = configuredDistDir.replace(/[^a-zA-Z0-9_.-]/g, '_')
  configuredTsconfig = `.healthkeep-dev/tsconfig-${safeDistName}.json`
  const absoluteTsconfig = path.join(process.cwd(), configuredTsconfig)
  mkdirSync(path.dirname(absoluteTsconfig), { recursive: true })
  if (!existsSync(absoluteTsconfig)) {
    writeFileSync(
      absoluteTsconfig,
      '{\n  "extends": "../tsconfig.json",\n  "compilerOptions": {\n    "baseUrl": "..",\n    "paths": { "@/*": ["./src/*"] }\n  }\n}\n',
      'utf8',
    )
  }
}

const nextConfig: NextConfig = {
  // Parallel local launchers use a port-scoped dist directory so an existing
  // Next dev server does not make a different free port fail on .next/dev/lock.
  distDir: configuredDistDir,
  typescript: {
    // Port-scoped launchers point Next at an ignored generated config so Next
    // does not append temporary distDir type paths to the tracked tsconfig.
    tsconfigPath: configuredTsconfig || 'tsconfig.json',
  },
  allowedDevOrigins: ['*.ngrok-free.dev', '*.trycloudflare.com'],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    proxyTimeout: 300_000,
    proxyClientMaxBodySize: '2gb',
  },
}

export default nextConfig
