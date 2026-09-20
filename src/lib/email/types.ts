/**
 * The email service abstraction.
 *
 * One interface, one implementation (Resend). The point is not to support
 * several providers — it is that nothing above this file knows which one is in
 * use, so replacing it is a change to one module rather than a migration and a
 * rewrite of the drain. The database already holds to the same rule: no column
 * names a vendor (AC-152).
 */

export type EmailMessage = {
  to: string
  subject: string
  /** Both parts are always sent. Some parents read mail in a plain-text client. */
  text: string
  html: string
}

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  /**
   * `retryable` distinguishes a provider outage from a rejected address. Both
   * mark the delivery FAILED, but only the first is worth another attempt, and
   * the drain's attempt budget is small enough that spending it on a permanent
   * failure means a real one never gets sent.
   */
  | { ok: false; error: string; retryable: boolean }

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<SendResult>
}
