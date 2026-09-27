import { expect, test } from '@playwright/test'

/**
 * The drain route reads guardian email addresses with the service role — the
 * most privileged thing in the application. The approved review is explicit
 * that possession of a URL is not authorization, so this asserts the route is
 * closed rather than merely obscure.
 */
test.describe('the notification drain route', () => {
  test('refuses an unauthenticated request', async ({ request }) => {
    const response = await request.get('/api/notifications/drain')
    expect(response.status()).toBe(401)
  })

  test('refuses a wrong secret', async ({ request }) => {
    const response = await request.get('/api/notifications/drain', {
      headers: { authorization: 'Bearer not-the-secret' },
    })
    expect(response.status()).toBe(401)
  })

  test('refuses a signed-in guardian session, which is not a cron caller', async ({ request }) => {
    // No bearer token at all: a browser session's cookies must not be a way in.
    const response = await request.get('/api/notifications/drain', {
      headers: { cookie: 'sb-access-token=whatever' },
    })
    expect(response.status()).toBe(401)
  })

  // A 401 that leaked queue counts would tell an unauthenticated caller how
  // many families are booked into a cancelled session.
  test('leaks nothing in the refusal', async ({ request }) => {
    const response = await request.get('/api/notifications/drain')
    const body = await response.json()
    expect(body).toEqual({ error: 'unauthorized' })
  })
})
