import { describe, expect, it } from 'vitest'
import { composeInvitationEmail } from '@/lib/notifications/invitation'

const APP = 'https://treninky.example'

const invitation = (over = {}) =>
  composeInvitationEmail(
    {
      email: 'petr@example.test',
      coachName: 'Petr Málek',
      adminName: 'Milana Kotová',
      organizationName: 'Hokejová škola Příbram',
      organizationLogoUrl: null,
      ...over,
    },
    APP,
  )

/**
 * §A6. The one message in the product that does not go to a parent, built from
 * the same template as the ones that do.
 */
describe('the coach’s invitation (AC-289)', () => {
  it('says who added them and to what', () => {
    const message = invitation()
    expect(message.subject).toBe('Pozvánka do aplikace · Hokejová škola Příbram')
    expect(message.text).toContain('Milana Kotová vás přidal jako trenéra')
    expect(message.text).toContain('Hokejová škola Příbram')
  })

  it('names the address they will sign in with', () => {
    expect(invitation().text).toContain('Přihlašovací e-mail: petr@example.test')
  })

  // The link prefills the field; the code goes when the coach confirms. A
  // scanner that fetches the link must not be able to burn one.
  it('links to a sign-in with the address already in it', () => {
    expect(invitation().text).toContain(`${APP}/prihlaseni?email=petr%40example.test`)
    expect(invitation().text).toContain('stačí potvrdit')
  })

  it('says the invitation never expires, because it does not', () => {
    expect(invitation().text).toContain('pozvánka nevyprší')
  })

  // Every other message explains itself with "you have a child booked". This
  // one may reach somebody who was not expecting it at all.
  it('tells an unexpected reader that ignoring it costs nothing', () => {
    const message = invitation()
    expect(message.text).toContain('Pozvánku jste nečekali?')
    expect(message.text).not.toContain('máte sportovce přihlášeného')
  })

  it('is the same layout as every other message', () => {
    const html = invitation().html
    expect(html).toContain('Arial, Helvetica, sans-serif')
    expect(html).toContain('width="520"')
    expect(html).not.toContain('<style')
  })

  it('manages without a name the club has not filled in yet', () => {
    const message = invitation({ coachName: null, adminName: null })
    expect(message.text).toContain('administrátor vás přidal')
    expect(message.text).not.toContain('Jméno:')
  })
})
