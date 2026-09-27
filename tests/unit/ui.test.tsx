import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { PickerRow } from '@/components/ui/picker-row'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { DetailList } from '@/components/ui/detail-list'
import { TextareaWithCounter } from '@/components/ui/field'
import { Field } from '@/components/ui/field'

describe('Button', () => {
  it('announces the wait and refuses a second press', async () => {
    const onClick = vi.fn()
    render(
      <Button loadingLabel="Přihlašuji…" onClick={onClick}>
        Přihlásit
      </Button>,
    )

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Přihlašuji…')

    await userEvent.click(button).catch(() => undefined)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('CapacityMeter', () => {
  it('states the count as a fact, not only as colour', () => {
    render(<CapacityMeter booked={7} capacity={10} registrationOpen />)

    const meter = screen.getByRole('meter', { name: 'Obsazenost' })
    expect(meter).toHaveAttribute('aria-valuenow', '7')
    expect(meter).toHaveAttribute('aria-valuemax', '10')
    expect(meter).toHaveTextContent('7 / 10')
  })

  it('shows a coach override as a count past the limit, with no error', () => {
    render(<CapacityMeter booked={8} capacity={6} registrationOpen />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveTextContent('8 / 6')
    expect(meter).toHaveTextContent('+2')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('PickerRow', () => {
  it('keeps a real control, so the keyboard reaches it', async () => {
    const onChange = vi.fn()
    render(<PickerRow checked={false} onChange={onChange} title="Anna Kotova" meta="2018" />)

    const checkbox = screen.getByRole('checkbox', { name: /Anna Kotova/ })
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('shows an ineligible athlete with the reason instead of hiding them', async () => {
    const onChange = vi.fn()
    render(
      <PickerRow
        checked={false}
        disabled
        onChange={onChange}
        title="Tomáš Svoboda"
        meta="2020 · mimo ročníky 2017–2018"
      />,
    )

    const checkbox = screen.getByRole('checkbox', { name: /Tomáš Svoboda/ })
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('2020 · mimo ročníky 2017–2018')).toBeInTheDocument()

    await userEvent.click(checkbox)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SegmentedControl', () => {
  it('is a tablist when it switches a view and a radiogroup when it fills a form', () => {
    const { unmount } = render(
      <SegmentedControl
        as="tablist"
        label="Zobrazení"
        value="upcoming"
        onChange={() => undefined}
        options={[
          { value: 'upcoming', label: 'Nadcházející' },
          { value: 'past', label: 'Minulé' },
        ]}
      />,
    )
    expect(screen.getByRole('tablist', { name: 'Zobrazení' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Nadcházející' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    unmount()

    render(
      <SegmentedControl
        label="Hala"
        value="MH"
        onChange={() => undefined}
        options={[
          { value: 'MH', label: 'MH', sublabel: 'Malá hala' },
          { value: 'VH', label: 'VH', sublabel: 'Velká hala' },
        ]}
      />,
    )
    expect(screen.getByRole('radiogroup', { name: 'Hala' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /MH/ })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Stepper', () => {
  it('moves by one and stops at the ends', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Stepper value={1} onChange={onChange} label="Kapacita" />)

    expect(screen.getByRole('button', { name: 'Ubrat' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Přidat' }))
    expect(onChange).toHaveBeenCalledWith(2)

    rerender(<Stepper value={99} onChange={onChange} label="Kapacita" />)
    expect(screen.getByRole('button', { name: 'Přidat' })).toBeDisabled()
  })
})

describe('DetailList', () => {
  it('keeps an empty row visible rather than dropping the fact', () => {
    render(
      <DetailList
        items={[
          { term: 'Šatna', value: null },
          { term: 'Hlavní trenér', value: 'Pavel Zeman' },
        ]}
      />,
    )

    expect(screen.getByText('Šatna')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('Pavel Zeman')).toBeInTheDocument()
  })
})

describe('Field', () => {
  it('ties the label, the error and the control together', () => {
    render(
      <Field label="Jméno" required error="Vyplňte jméno.">
        {(props) => <input {...props} />}
      </Field>,
    )

    const input = screen.getByLabelText(/Jméno/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Vyplňte jméno.')
  })
})

describe('TextareaWithCounter', () => {
  function Controlled({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial)
    return <TextareaWithCounter value={value} onChange={setValue} maxLength={200} />
  }

  it('counts what is written and refuses the character past the limit', async () => {
    render(<Controlled initial={'a'.repeat(198)} />)
    expect(screen.getByText('198 / 200')).toBeInTheDocument()

    // The limit is enforced while typing rather than reported afterwards, so a
    // coach never writes a paragraph and then loses the end of it.
    await userEvent.type(screen.getByRole('textbox'), 'bcd')

    expect(screen.getByText('200 / 200')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue(`${'a'.repeat(198)}bc`)
  })
})
