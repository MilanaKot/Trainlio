import { afterEach, describe, expect, it, vi } from 'vitest'
import { resendProvider } from '@/lib/email/resend'

const message = {
  to: 'rodina@example.test',
  subject: 'Zrušený trénink',
  text: 'text',
  html: '<p>html</p>',
}

function mockFetch(impl: () => Promise<Response> | never) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the email provider', () => {
  it('returns the provider message id on success', async () => {
    mockFetch(async () => new Response(JSON.stringify({ id: 'abc' }), { status: 200 }))
    const result = await resendProvider('key', 'trener@example.test').send(message)
    expect(result).toEqual({ ok: true, providerMessageId: 'abc' })
  })

  it('succeeds even when the response body is not what we expected', async () => {
    mockFetch(async () => new Response('not json', { status: 200 }))
    const result = await resendProvider('key', 'trener@example.test').send(message)
    // The provider accepted it. A missing id costs traceability, not delivery,
    // and reporting a failure here would send the parent a second copy.
    expect(result).toEqual({ ok: true, providerMessageId: null })
  })

  it('sends the address, subject and both body parts', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await resendProvider('key', 'trener@example.test').send(message)

    const init = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      from: 'trener@example.test',
      to: ['rodina@example.test'],
      subject: 'Zrušený trénink',
      text: 'text',
      html: '<p>html</p>',
    })
  })
})

/**
 * The attempt budget is small. Spending it retrying a request that is broken in
 * a way retrying cannot fix means a delivery that would have gone through never
 * gets another attempt.
 */
describe('what is worth retrying', () => {
  it('retries a provider outage', async () => {
    mockFetch(async () => new Response('upstream error', { status: 503 }))
    const result = await resendProvider('key', 'from@example.test').send(message)
    expect(result).toMatchObject({ ok: false, retryable: true })
  })

  it('retries a rate limit, which is a 4xx that means "later"', async () => {
    mockFetch(async () => new Response('slow down', { status: 429 }))
    const result = await resendProvider('key', 'from@example.test').send(message)
    expect(result).toMatchObject({ ok: false, retryable: true })
  })

  it('does not retry a rejected request', async () => {
    mockFetch(async () => new Response('invalid to address', { status: 422 }))
    const result = await resendProvider('key', 'from@example.test').send(message)
    expect(result).toMatchObject({ ok: false, retryable: false })
  })

  it('does not retry a revoked key', async () => {
    mockFetch(async () => new Response('unauthorized', { status: 401 }))
    const result = await resendProvider('key', 'from@example.test').send(message)
    expect(result).toMatchObject({ ok: false, retryable: false })
  })

  // Nothing reached the provider, so nothing was sent.
  it('retries a request that never left', async () => {
    mockFetch(() => {
      throw new Error('ECONNRESET')
    })
    const result = await resendProvider('key', 'from@example.test').send(message)
    expect(result).toMatchObject({ ok: false, retryable: true })
    expect((result as { error: string }).error).toContain('ECONNRESET')
  })

  it('records the status and a bounded slice of the body', async () => {
    mockFetch(async () => new Response('x'.repeat(2000), { status: 400 }))
    const result = await resendProvider('key', 'from@example.test').send(message)
    const error = (result as { error: string }).error
    expect(error.startsWith('400 ')).toBe(true)
    // last_error is a column, not a log: an unbounded provider body does not
    // belong in it.
    expect(error.length).toBeLessThan(600)
  })
})
