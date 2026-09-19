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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
}

export default nextConfig
