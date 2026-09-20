import type { NextConfig } from 'next'
import { assertEnv } from './src/lib/env'

/**
 * Environment is validated here, at config load, so a missing or malformed
 * secret fails `next build` and `next dev` immediately.
 *
 * Validating only at module import would not do it: the modules that read
 * configuration are compiled during a build but never executed, so a deploy
 * with no RESEND_API_KEY would build clean and then fail the first time a coach
 * cancelled a session.
 */
assertEnv()

/**
 * Response headers.
 *
 * Every page behind sign-in shows a child's name and birth year, so the
 * defaults that matter here are the ones that stop another site framing it,
 * sniffing it, or reading the URL of the page a parent came from.
 *
 * No Content-Security-Policy yet: Next injects inline bootstrap scripts, so a
 * CSP worth having needs per-request nonces threaded through the proxy. Adding
 * one with `unsafe-inline` would be a header that reads like protection and is
 * not, and is deliberately left for after launch rather than shipped as
 * decoration.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Neither the guardian nor the coach area has any use for these.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // The path alone identifies a session or an athlete, so it does not travel.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Vercel serves HTTPS only; this stops the first plaintext request.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The application is not a public catalogue: every page needs a session, and
  // the sign-in page has nothing to rank for.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
