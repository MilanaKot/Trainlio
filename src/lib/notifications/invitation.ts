import { messages } from '@/lib/i18n'
import { fill, renderHtml, renderText, type Template } from '@/lib/notifications/layout'
import type { EmailMessage } from '@/lib/email/types'

const t = messages.email.invitation

export type InvitationDelivery = {
  email: string
  coachName: string | null
  adminName: string | null
  organizationName: string
  organizationLogoUrl: string | null
}

/**
 * The coach's invitation (admin/SPEC.md §A6).
 *
 * The same template as every message a parent receives, deliberately: a coach
 * who has met the club's e-mails as a parent should recognise this one, and one
 * layout is one thing to keep working in Outlook.
 *
 * What differs is the footer. Every other message explains itself with "you
 * have a child booked"; this one goes to somebody who may not be expecting it
 * at all, so it says what happens if they ignore it — nothing.
 */
export function composeInvitationEmail(delivery: InvitationDelivery, appUrl: string): EmailMessage {
  const base = appUrl.replace(/\/$/, '')
  const org = delivery.organizationName

  const plan: Template = {
    tone: 'blue',
    label: t.label,
    subject: fill(t.subject, { org }),
    title: t.title,
    body: fill(t.body, { admin: delivery.adminName ?? t.byAdmin, org }),
    rows: [
      ...(delivery.coachName ? [{ label: t.rowName, value: delivery.coachName }] : []),
      { label: t.rowEmail, value: delivery.email },
    ],
    button: {
      label: t.button,
      // Prefilled, not sent: an e-mail link is fetched by scanners and preview
      // services, and a code sent by one of those is a code the coach never
      // asked for and cannot use.
      path: `/prihlaseni?email=${encodeURIComponent(delivery.email)}`,
    },
    helper: t.helper,
  }

  const url = `${base}${plan.button.path}`

  return {
    to: delivery.email,
    subject: plan.subject,
    text: renderText(plan, { url, org, footer: t.footer }),
    html: renderHtml(plan, {
      url,
      org,
      footer: t.footer,
      logoUrl: delivery.organizationLogoUrl,
    }),
  }
}

export type GuardianInvitationDelivery = {
  email: string
  inviterName: string | null
  athleteNames: string[]
  organizationName: string
  organizationLogoUrl: string | null
}

/**
 * E13 · a parent invites the other parent (PRD §6, migration 50).
 *
 * The button prefills the address, as A6 does, and nothing more: the
 * invitation is accepted by signing in with that address, a code to it or
 * Google with it, which proves the address is theirs.
 */
export function composeGuardianInvitationEmail(
  delivery: GuardianInvitationDelivery,
  appUrl: string,
): EmailMessage {
  const g = messages.email.guardianInvitation
  const base = appUrl.replace(/\/$/, '')
  const org = delivery.organizationName
  const athletes = delivery.athleteNames.join(', ')

  const plan: Template = {
    tone: 'blue',
    label: g.label,
    subject: fill(g.subject, { athletes, org }),
    title: g.title,
    body: fill(g.body, { inviter: delivery.inviterName ?? g.byParent, org }),
    rows: [
      ...(athletes ? [{ label: g.rowAthletes, value: athletes }] : []),
      { label: g.rowEmail, value: delivery.email },
    ],
    button: { label: g.button, path: `/prihlaseni?email=${encodeURIComponent(delivery.email)}` },
    helper: g.helper,
  }

  const url = `${base}${plan.button.path}`

  return {
    to: delivery.email,
    subject: plan.subject,
    text: renderText(plan, { url, org, footer: g.footer }),
    html: renderHtml(plan, { url, org, footer: g.footer, logoUrl: delivery.organizationLogoUrl }),
  }
}
