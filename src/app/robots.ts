import type { MetadataRoute } from 'next'

/**
 * Nothing here is for a search engine.
 *
 * Every page requires a session, so a crawler would only ever reach the
 * sign-in form — but an indexed sign-in page invites credential-stuffing
 * traffic and confuses parents who find it through a search instead of through
 * the link their coach sent.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  }
}
