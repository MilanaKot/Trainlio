import { describe, expect, it } from 'vitest'
import { composeGuardianInvitationEmail } from '@/lib/notifications/invitation'

describe('E13 · the second parent’s invitation (PRD §6, AC-324)', () => {
  const message = composeGuardianInvitationEmail(
    {
      email: 'druhy.rodic@example.test',
      inviterName: 'Milana Kotova',
      athleteNames: ['Ivan Kotov', 'Anna Kotova'],
      organizationName: 'Hokejová škola Příbram',
      organizationLogoUrl: null,
    },
    'https://trainlio.example/',
  )

  it('names who invites, to which children and which club', () => {
    expect(message.to).toBe('druhy.rodic@example.test')
    expect(message.subject).toBe('Pozvánka: Ivan Kotov, Anna Kotova · Hokejová škola Příbram')
    expect(message.text).toContain('Milana Kotova vás zve')
    expect(message.text).toContain('Sportovci: Ivan Kotov, Anna Kotova')
  })

  it('opens sign-in with the address filled in, and says Google works too', () => {
    expect(message.text).toContain(
      'https://trainlio.example/prihlaseni?email=druhy.rodic%40example.test',
    )
    expect(message.text).toContain('přes Google se stejnou adresou')
  })
})
