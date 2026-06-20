import type { NextConfig } from 'next'

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['bust-unpledged-bubbling.ngrok-free.dev'],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    proxyTimeout: 300_000,
    proxyClientMaxBodySize: '2gb',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiBaseUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
