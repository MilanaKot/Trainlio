import { messages } from '@/lib/i18n'

/**
 * The one e-mail layout (shared/EMAILS.md §1, DESIGN_SYSTEM §6.32).
 *
 * Every message the product sends is this: the guardian notifications and the
 * coach's invitation alike. It lives apart from either so that neither can
 * drift — the design is one template, and a second copy of it is a second
 * design.
 *
 * Tables and inline styles, because Gmail strips `<style>` and Outlook renders
 * with Word. Arial, because the design does not depend on Barlow here and a web
 * font would be ignored anyway. And it reads with images blocked, which is the
 * default in most clients: nothing is carried by a picture or by colour alone.
 */

const t = messages.email

/** The three label colours of §3: cancelled, changed, new. */
export const PALETTE = {
  red: { bg: '#FBE9E7', fg: '#B42318' },
  orange: { bg: '#FBF0DC', fg: '#8F5200' },
  blue: { bg: '#E5EBFD', fg: '#2B55E0' },
} as const

export type Row = {
  label: string
  value: string
  /** The value this one replaced, printed struck through beneath it. */
  previous?: string
  /** Highlighted as the thing that moved. */
  changed?: boolean
  /** The whole value no longer applies — a cancelled training's time. */
  struck?: boolean
}

export type Template = {
  tone: keyof typeof PALETTE
  label: string
  subject: string
  title: string
  body: string
  rows: Row[]
  button: { label: string; path: string }
  helper?: string
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  )
}

/**
 * The plain-text part, with the same content in the same order (§1).
 *
 * Not a fallback nobody reads: it is what a watch notification shows, what a
 * text-only client renders, and what survives a forward into a chat.
 */
export function renderText(
  plan: Template,
  context: {
    url: string
    org: string
    message?: string | undefined
    /** The closing line. Every message says why its reader got it. */
    footer?: string | undefined
  },
): string {
  const lines: string[] = [plan.title, '', plan.body, '']

  for (const row of plan.rows) {
    const value = row.previous
      ? `${row.value} ${fill(t.previousText, { value: row.previous })}`
      : row.value
    lines.push(`${row.label}: ${value}`)
  }

  if (context.message) lines.push('', `${t.coachMessage}: ${context.message}`)

  lines.push('', fill(t.linkText, { label: plan.button.label, url: context.url }))
  if (plan.helper) lines.push('', plan.helper)
  lines.push('', fill(context.footer ?? t.footer, { org: context.org }), t.poweredBy)

  return lines.join('\n')
}

const INK = '#0E1726'
const MUTED = '#55607A'
const LINE = '#DFE4EE'
const CANVAS = '#F3F5F9'
const FONT = 'Arial, Helvetica, sans-serif'

export function renderHtml(
  plan: Template,
  context: {
    url: string
    org: string
    message?: string | undefined
    footer?: string | undefined
    logoUrl: string | null
  },
): string {
  const tone = PALETTE[plan.tone]

  // The club's mark, when it has one, with the name beside it as text. Mail
  // clients refuse remote images until the reader asks, so nothing of the
  // message is inside the picture.
  const header =
    context.org === ''
      ? ''
      : `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        (context.logoUrl
          ? `<td style="padding:0 12px 0 0"><img src="${escapeHtml(context.logoUrl)}" alt="${escapeHtml(context.org)}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:8px"></td>`
          : '') +
        `<td style="font:700 16px/22px ${FONT};color:${INK}">${escapeHtml(context.org)}</td>` +
        '</tr></table></td></tr>'

  const rows = plan.rows
    .map((row, index) => {
      const value = row.changed
        ? `<span style="background:${PALETTE.orange.bg};color:${PALETTE.orange.fg};font-weight:700;padding:0 4px;border-radius:4px">${escapeHtml(row.value)}</span>`
        : row.struck
          ? `<span style="text-decoration:line-through;color:${MUTED}">${escapeHtml(row.value)}</span>`
          : escapeHtml(row.value)

      const previous = row.previous
        ? `<br><span style="color:${MUTED};text-decoration:line-through">${escapeHtml(row.previous)}</span>`
        : ''

      const border = index === plan.rows.length - 1 ? '' : `border-bottom:1px solid ${LINE};`

      return (
        `<tr><td style="${border}padding:10px 0;font:400 15px/22px ${FONT};color:${MUTED};width:96px;vertical-align:top">${escapeHtml(row.label)}</td>` +
        `<td style="${border}padding:10px 0;font:400 15px/22px ${FONT};color:${INK};vertical-align:top">${value}${previous}</td></tr>`
      )
    })
    .join('')

  const coachMessage = context.message
    ? `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
      `<td style="border-left:3px solid ${LINE};padding:2px 0 2px 14px">` +
      `<div style="font:400 13px/20px ${FONT};color:${MUTED};padding-bottom:4px">${escapeHtml(t.coachMessage)}</div>` +
      `<div style="font:400 15px/23px ${FONT};color:${INK}">${escapeHtml(context.message)}</div>` +
      '</td></tr></table></td></tr>'
    : ''

  // The button is a padded table cell with the link filling it, which is as
  // close to "bulletproof" as HTML gets: it survives Outlook, it is never an
  // image, and it is still a real link when the styles are stripped.
  const button =
    `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="#2B55E0" style="border-radius:10px"><a href="${escapeHtml(context.url)}" ` +
    `style="display:inline-block;padding:13px 24px;font:700 16px/22px ${FONT};color:#FFFFFF;text-decoration:none">` +
    `${escapeHtml(plan.button.label)}</a></td></tr></table></td></tr>`

  return [
    '<!doctype html><html lang="cs"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(plan.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CANVAS}">`,
    // The preheader: the first sentence, which is what a mail list shows under
    // the subject. Hidden, and not blank — an empty one shows the markup after.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(plan.body)}</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS}">`,
    '<tr><td align="center" style="padding:24px 12px">',
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:520px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px">`,
    '<tr><td style="padding:32px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">',
    header,
    `<tr><td style="padding:0 0 14px"><span style="display:inline-block;background:${tone.bg};color:${tone.fg};font:700 12px/16px ${FONT};letter-spacing:.6px;text-transform:uppercase;padding:4px 8px;border-radius:6px">${escapeHtml(plan.label)}</span></td></tr>`,
    `<tr><td style="padding:0 0 12px;font:700 26px/32px ${FONT};color:${INK}">${escapeHtml(plan.title)}</td></tr>`,
    `<tr><td style="padding:0 0 18px;font:400 16px/25px ${FONT};color:${INK}">${escapeHtml(plan.body)}</td></tr>`,
    rows === ''
      ? ''
      : `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS};border-radius:10px"><tr><td style="padding:6px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr></table></td></tr>`,
    coachMessage,
    button,
    plan.helper
      ? `<tr><td style="padding:0 0 18px;font:400 13px/20px ${FONT};color:${MUTED}">${escapeHtml(plan.helper)}</td></tr>`
      : '',
    `<tr><td style="border-top:1px solid ${LINE};padding:16px 0 0;font:400 13px/20px ${FONT};color:${MUTED}">${escapeHtml(fill(context.footer ?? t.footer, { org: context.org }))}</td></tr>`,
    '</table></td></tr></table>',
    `<div style="padding:12px 0 0;font:400 12px/18px ${FONT};color:${MUTED}">${escapeHtml(t.poweredBy)}</div>`,
    '</td></tr></table></body></html>',
  ].join('')
}
