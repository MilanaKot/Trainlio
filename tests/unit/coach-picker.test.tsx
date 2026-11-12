import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoachPickerSheet } from '@/components/session/coach-picker-sheet'
import { NO_MAIN_COACH } from '@/lib/domain/session'

const coaches = [
  { id: 'c1', displayName: 'Jan Novák' },
  { id: 'c2', displayName: 'Milan Filipi' },
]

function picker(allowNone: boolean, onDone = vi.fn()) {
  render(
    <CoachPickerSheet
      mode="main"
      coaches={coaches}
      mainCoachId="c1"
      allowNone={allowNone}
      selected={['c1']}
      assistantIds={[]}
      bookedCount={0}
      onDone={onDone}
      onClose={() => {}}
    />,
  )
  return onDone
}

describe('Bez trenéra (migration 46)', () => {
  it('is offered when planning a training', async () => {
    const onDone = picker(true)
    await userEvent.click(screen.getByRole('radio', { name: /Bez trenéra/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Hotovo' }))
    expect(onDone).toHaveBeenCalledWith([NO_MAIN_COACH])
  })

  it('is not offered on a training that has a coach', () => {
    picker(false)
    expect(screen.queryByRole('radio', { name: /Bez trenéra/ })).toBeNull()
  })
})
