import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Route } from 'next'
import { StatusToggle } from '@/components/ui/status-toggle'
import { PlayerCard, TOGGLE_CELLS } from '@/components/ui/player-card'
import { ToastProvider, useUndoToast } from '@/components/ui/toast'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: () => undefined }),
}))

describe('StatusToggle (§6.36)', () => {
  it('names the athlete and the state', () => {
    render(
      <StatusToggle kind="attendance" state="present" athlete="Ivan Kotov" onToggle={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Docházka Ivan Kotov: Byl' })).toBeInTheDocument()
  })

  it('says pressed for a paid booking', () => {
    render(<StatusToggle kind="payment" state="paid" athlete="Ivan Kotov" onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Platba Ivan Kotov: zaplaceno' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('cannot be pressed before the training starts', async () => {
    const onToggle = vi.fn()
    render(<StatusToggle kind="attendance" state="locked" athlete="Ivan" onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: 'Docházka Ivan: nezapsáno' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('is a picture, not a control, when read-only', () => {
    render(<StatusToggle kind="payment" state="unpaid" athlete="Ivan" readOnly />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('img', { name: 'Platba Ivan: nezaplaceno' })).toBeInTheDocument()
  })

  it('treats a pointer that travelled more than 8 px as a scroll', () => {
    const onToggle = vi.fn()
    render(<StatusToggle kind="payment" state="unpaid" athlete="Ivan" onToggle={onToggle} />)
    const button = screen.getByRole('button')
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 })
    fireEvent.click(button, { clientX: 10, clientY: 30, detail: 1 })
    expect(onToggle).not.toHaveBeenCalled()

    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 })
    fireEvent.click(button, { clientX: 12, clientY: 14, detail: 1 })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a long-press', () => {
    vi.useFakeTimers()
    const onToggle = vi.fn()
    render(<StatusToggle kind="payment" state="unpaid" athlete="Ivan" onToggle={onToggle} />)
    const button = screen.getByRole('button')
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 })
    vi.advanceTimersByTime(700)
    fireEvent.click(button, { clientX: 10, clientY: 10, detail: 1 })
    expect(onToggle).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('PlayerCard (§6.37)', () => {
  function card(onToggle = vi.fn()) {
    render(
      <PlayerCard
        href={'/trener/sportovci/a1' as Route}
        toggles={
          <>
            <StatusToggle
              kind="attendance"
              state="unmarked"
              athlete="Ivan"
              onToggle={onToggle}
              className={TOGGLE_CELLS[0]}
            />
            <StatusToggle
              kind="payment"
              state="unpaid"
              athlete="Ivan"
              onToggle={onToggle}
              className={TOGGLE_CELLS[1]}
            />
          </>
        }
      >
        <span>Ivan Kotov</span>
      </PlayerCard>,
    )
    return onToggle
  }

  it('never opens the card from a toggle', async () => {
    push.mockClear()
    const onToggle = card()
    await userEvent.click(screen.getByRole('button', { name: 'Platba Ivan: nezaplaceno' }))
    await userEvent.click(screen.getByRole('button', { name: 'Docházka Ivan: nezapsáno' }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(onToggle).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
  })

  it('opens the player card from the name, after the pressed state', async () => {
    push.mockClear()
    const onToggle = card()
    await userEvent.click(screen.getByRole('link', { name: 'Ivan Kotov' }))
    expect(push).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(push).toHaveBeenCalledWith('/trener/sportovci/a1')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('opens nothing when the finger was scrolling', async () => {
    push.mockClear()
    card()
    const link = screen.getByRole('link', { name: 'Ivan Kotov' })
    fireEvent.pointerDown(link, { clientX: 20, clientY: 20 })
    fireEvent.click(link, { clientX: 20, clientY: 60, detail: 1, button: 0 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(push).not.toHaveBeenCalled()
  })
})

describe('the undo toast (§6.16 exception)', () => {
  function Trigger({ onAction }: { onAction: () => void }) {
    const undo = useUndoToast()
    return (
      <button
        type="button"
        onClick={() =>
          undo({ message: 'Platba zrušena · Ivan Kotov', actionLabel: 'Vrátit', onAction })
        }
      >
        un-pay
      </button>
    )
  }

  it('offers Vrátit, which runs the undo and closes', async () => {
    const onAction = vi.fn()
    render(
      <ToastProvider>
        <Trigger onAction={onAction} />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'un-pay' }))
    expect(screen.getByRole('status')).toHaveTextContent('Platba zrušena · Ivan Kotov')
    await userEvent.click(screen.getByRole('button', { name: 'Vrátit' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('goes after four seconds', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger onAction={() => {}} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'un-pay' }))
    act(() => vi.advanceTimersByTime(3500))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByRole('status')).toBeNull()
    vi.useRealTimers()
  })
})
