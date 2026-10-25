import { describe, expect, it } from 'vitest'
import { canCreateSessions, canEditSession, sessionRole } from '@/lib/domain/coach-rights'

const led = { mainCoachId: 'me', coachRoles: [{ profileId: 'me', role: 'MAIN' as const }] }
const assisted = {
  mainCoachId: 'boss',
  coachRoles: [
    { profileId: 'boss', role: 'MAIN' as const },
    { profileId: 'me', role: 'ASSISTANT' as const },
  ],
}
const elsewhere = {
  mainCoachId: 'boss',
  coachRoles: [{ profileId: 'boss', role: 'MAIN' as const }],
}

describe('who may edit a training (decision 33)', () => {
  const viewOnly = { me: 'me', canEditAll: false }
  const full = { me: 'me', canEditAll: true }

  it('lets a coach without the permission edit what they lead, and nothing else', () => {
    expect(canEditSession(viewOnly, led)).toBe(true)
    expect(canEditSession(viewOnly, assisted)).toBe(false)
    expect(canEditSession(viewOnly, elsewhere)).toBe(false)
  })

  it('lets a coach with the permission edit every training', () => {
    expect(canEditSession(full, assisted)).toBe(true)
    expect(canEditSession(full, elsewhere)).toBe(true)
  })

  it('needs the permission to create, even a training one would lead', () => {
    expect(canCreateSessions(viewOnly)).toBe(false)
    expect(canCreateSessions(full)).toBe(true)
  })
})

describe("the coach's part in a training (§K1 RoleLabel)", () => {
  it('is main coach, assistant, or nothing', () => {
    expect(sessionRole('me', led)).toBe('MAIN')
    expect(sessionRole('me', assisted)).toBe('ASSISTANT')
    expect(sessionRole('me', elsewhere)).toBeNull()
  })
})
