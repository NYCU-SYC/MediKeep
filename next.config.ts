import type { NextConfig } from 'next'

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.ngrok-free.dev', '*.trycloudflare.com'],
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
