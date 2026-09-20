import { z } from 'zod'

/**
 * Validated environment configuration.
 *
 * Parsed once, at module load. A missing or malformed secret fails the build or
 * the first request, rather than surfacing as a 500 the first time a guardian
 * tries to book.
 *
 * The public/server split is enforced by two schemas: anything in `serverEnv`
 * is unavailable in the browser bundle, and reading it from a Client Component
 * is a build error rather than a silent `undefined`.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** Where OTP links and redirects come back to. Also read by supabase/config.toml. */
  NEXT_PUBLIC_SITE_URL: z.url(),
})

const serverSchema = z.object({
  /**
   * Bypasses row level security. Used only by the notification drain job and
   * administrative tooling, never in a request handled on behalf of a user.
   * Deliberately not prefixed NEXT_PUBLIC_, and guarded by a lint rule.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  /** Sender for Auth OTP and transactional mail. Must be on a Resend-verified domain. */
  AUTH_SENDER_EMAIL: z.email(),
  /** Shared secret for the notification drain cron route. */
  CRON_SECRET: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

function fail(what: string, error: z.ZodError): never {
  const detail = error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
  throw new Error(`Invalid ${what} environment configuration:\n${detail}`)
}

// Next.js inlines NEXT_PUBLIC_* at build time only for statically analysable
// member expressions, so these must be written out rather than looped over.
const publicParsed = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
})

if (!publicParsed.success) fail('public', publicParsed.error)

export const publicEnv = publicParsed.data

/**
 * Server-only configuration. Call this from server code; it throws if invoked
 * in the browser, where the values do not exist.
 */
export function getServerEnv(): z.infer<typeof serverSchema> {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() was called in the browser. Server secrets are not available there.')
  }

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_SENDER_EMAIL: process.env.AUTH_SENDER_EMAIL,
    CRON_SECRET: process.env.CRON_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  })

  if (!parsed.success) fail('server', parsed.error)

  return parsed.data
}

/**
 * Validates both schemas eagerly. Called from next.config.ts so the build and
 * the dev server refuse to start with incomplete configuration, rather than
 * deferring the failure to whichever request first needs the missing value.
 */
export function assertEnv(): void {
  const server = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_SENDER_EMAIL: process.env.AUTH_SENDER_EMAIL,
    CRON_SECRET: process.env.CRON_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  })

  if (!server.success) fail('server', server.error)
}
