/**
 * Stub for the `server-only` package under Vitest.
 *
 * The real package throws on import outside a Server Component, which is a
 * build-time contract with Next.js — enforced by the bundler, and separately by
 * the ESLint restricted-import rule on the service-role client. Neither is what
 * a unit test exercises, and the alias is scoped to the test runner, so the
 * guard is unchanged everywhere it matters.
 */
export {}
