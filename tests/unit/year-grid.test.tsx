import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterChips, YearGrid } from '@/components/ui/filter-chips'

describe('YearGrid (DS §6.28, v3.6)', () => {
  const options = [
    { value: 'all', label: 'Všechny' },
    { value: '2019', label: '2019', count: 8 },
    { value: '2018', label: '2018', count: 10 },
    { value: '2017', label: '2017', count: 9 },
  ]

  it('keeps the order it is given — Všechny, then newest first — with counts', () => {
    render(<YearGrid label="Ročník" value="all" onChange={() => {}} options={options} />)
    const group = screen.getByRole('group', { name: 'Ročník' })
    expect([...group.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Všechny',
      '20198',
      '201810',
      '20179',
    ])
  })

  it('presses one chip at a time, in primary blue', async () => {
    const onChange = vi.fn()
    render(<YearGrid label="Ročník" value="2018" onChange={onChange} options={options} />)
    const chosen = screen.getByRole('button', { name: '2018, 10' })
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
    expect(chosen).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Všechny' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: '2017, 9' }))
    expect(onChange).toHaveBeenCalledWith('2017')
  })
})

describe('FilterChips (decision 49)', () => {
  it('draws the chosen chip blue, never black', () => {
    render(
      <FilterChips
        label="Filtr"
        value="mine"
        onChange={() => {}}
        options={[
          { value: 'all', label: 'Všechny' },
          { value: 'mine', label: 'Moje' },
        ]}
      />,
    )
    const chosen = screen.getByRole('button', { name: 'Moje' })
    expect(chosen).toHaveClass('bg-primary')
    expect(chosen).not.toHaveClass('bg-ink')
  })
})
