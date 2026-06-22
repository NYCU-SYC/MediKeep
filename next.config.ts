import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
