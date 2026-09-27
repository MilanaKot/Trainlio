import { describe, expect, it } from 'vitest'
import { czechPluralCategory, plural } from '@/lib/i18n/plural'
import { messages } from '@/lib/i18n'

describe('Czech plural categories', () => {
  it('distinguishes one, few and many', () => {
    expect(czechPluralCategory(1)).toBe('one')
    expect(czechPluralCategory(2)).toBe('few')
    expect(czechPluralCategory(4)).toBe('few')
    expect(czechPluralCategory(5)).toBe('many')
    expect(czechPluralCategory(0)).toBe('many')
  })
})

describe('insufficient-capacity message (D-05)', () => {
  // The server rejects the whole selection rather than booking a subset, so the
  // message has to tell the guardian exactly how many to pick. The verb, the
  // adjective and the noun all change with the count, which is why this cannot
  // be built by concatenation.
  const forms = messages.booking.insufficientCapacity

  it('uses the singular form for the last free place', () => {
    expect(plural(1, forms)).toBe(
      'Na tento trénink zbývá poslední volné místo. Vyberte prosím pouze jednoho sportovce.',
    )
  })

  it('uses the 2–4 form', () => {
    expect(plural(2, forms)).toBe(
      'Na tento trénink zbývají 2 volná místa. Vyberte prosím nejvýše 2 sportovce.',
    )
  })

  it('uses the 5+ form', () => {
    expect(plural(5, forms)).toBe(
      'Na tento trénink zbývá 5 volných míst. Vyberte prosím nejvýše 5 sportovců.',
    )
  })
})
