import { useState } from 'react'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePathname } from 'next/navigation'
import { BottomNav } from '@/components/ui/bottom-nav'
import { Button } from '@/components/ui/button'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { PickerRow } from '@/components/ui/picker-row'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { CodeInput } from '@/components/ui/code-input'
import { Switch } from '@/components/ui/switch'
import { DetailList } from '@/components/ui/detail-list'
import { TextareaWithCounter } from '@/components/ui/field'
import { Field } from '@/components/ui/field'

vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/') }))

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

    expect(screen.getByRole('button', { name: 'Kapacita: ubrat' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Kapacita: přidat' }))
    expect(onChange).toHaveBeenCalledWith(2)

    rerender(<Stepper value={99} onChange={onChange} label="Kapacita" />)
    expect(screen.getByRole('button', { name: 'Kapacita: přidat' })).toBeDisabled()
  })

  // A club that trains twenty at a time would otherwise tap `+` ten times.
  it('can be typed into, and clamps what is typed', async () => {
    function Wrapper() {
      const [value, setValue] = useState(10)
      return <Stepper value={value} onChange={setValue} label="Kapacita" max={99} />
    }
    render(<Wrapper />)

    const field = screen.getByLabelText('Kapacita')
    await userEvent.clear(field)
    await userEvent.type(field, '24')
    expect(field).toHaveValue(24)

    // Out of range waits for the field to be left, so `4` on the way to `40`
    // is not snapped to the maximum as it is typed.
    await userEvent.clear(field)
    await userEvent.type(field, '400')
    await userEvent.tab()
    expect(field).toHaveValue(99)
  })

  // One label, not two: a group answering to the same name as the field it
  // contains is one thing too many for a screen reader.
  it('is named once', () => {
    render(<Stepper value={10} onChange={vi.fn()} label="Kapacita" />)
    expect(screen.getAllByLabelText('Kapacita')).toHaveLength(1)
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

describe('BottomNav', () => {
  const items = [
    { href: '/trener' as const, label: 'Tréninky', icon: null },
    { href: '/trener/sportovci' as const, label: 'Sportovci', icon: null },
    { href: '/trener/vice' as const, label: 'Více', icon: null },
  ]

  it('lights the tab whose route is the longest match, not every prefix', () => {
    vi.mocked(usePathname).mockReturnValue('/trener/vice')
    render(<BottomNav items={items} />)

    expect(screen.getByRole('link', { name: 'Více' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Tréninky' })).not.toHaveAttribute('aria-current')
  })

  it('keeps the tab lit on a screen pushed from it', () => {
    vi.mocked(usePathname).mockReturnValue('/trener/abc/upravit')
    render(<BottomNav items={items} />)
    expect(screen.getByRole('link', { name: 'Tréninky' })).toHaveAttribute('aria-current', 'page')
  })

  // A form is a task, not a tab: two fixed bars would also leave its button
  // under the navigation.
  it('stands aside on the screens that replace it', () => {
    vi.mocked(usePathname).mockReturnValue('/trener/novy')
    const { container } = render(<BottomNav items={items} hideWhen="^/trener/novy$" />)
    expect(container).toBeEmptyDOMElement()
  })
})

/**
 * DESIGN_SYSTEM §6.11 and §6.26, as handoff v3 specified them. These are the
 * two controls a person fights with when they are wrong: one sets a number with
 * a thumb, the other takes a code at the one moment somebody is already
 * irritated.
 */
describe('Stepper, to the letter of §6.11 (AC-291)', () => {
  function Harness({ start = 10 }: { start?: number }) {
    const [value, setValue] = useState(start)
    return <Stepper value={value} onChange={setValue} label="Kapacita" min={1} max={99} />
  }

  it('commits a typed number when the field is left', async () => {
    render(<Harness />)
    const field = screen.getByLabelText('Kapacita')
    await userEvent.clear(field)
    await userEvent.type(field, '24')
    await userEvent.tab()
    expect(field).toHaveValue(24)
  })

  // Enter is what a person presses when they have finished typing; without it
  // the number they typed is still a draft and the form saves the old one.
  it('and when Enter is pressed', async () => {
    render(<Harness />)
    const field = screen.getByLabelText('Kapacita')
    await userEvent.clear(field)
    await userEvent.type(field, '24{Enter}')
    expect(field).toHaveValue(24)
  })

  it('snaps a number outside the limits back, and says so', async () => {
    render(<Harness />)
    const field = screen.getByLabelText('Kapacita')
    await userEvent.clear(field)
    await userEvent.type(field, '240{Enter}')

    expect(field).toHaveValue(99)
    expect(screen.getByRole('status')).toHaveTextContent('Kapacita musí být 1–99.')
  })

  it('says nothing when the number was fine', async () => {
    render(<Harness />)
    const field = screen.getByLabelText('Kapacita')
    await userEvent.clear(field)
    await userEvent.type(field, '12{Enter}')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('disables the buttons at the limits rather than refusing silently', () => {
    render(<Harness start={1} />)
    expect(screen.getByRole('button', { name: 'Kapacita: ubrat' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Kapacita: přidat' })).toBeEnabled()
  })
})

describe('CodeInput, to the letter of §6.26 (AC-291)', () => {
  function Harness({ onComplete }: { onComplete: (value: string) => void }) {
    const [code, setCode] = useState('')
    return <CodeInput value={code} onChange={setCode} onComplete={onComplete} label="Kód" />
  }

  // The sixth digit submits: a person who has entered the whole code has said
  // everything they have to say.
  it('reports the code the moment the last digit arrives', async () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    await userEvent.type(screen.getByLabelText('Kód'), '12345')
    expect(onComplete).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('Kód'), '6')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  // Pasting `123 456` is what a person does with the code in their mail app.
  it('takes a pasted code with spaces in it', async () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)

    const field = screen.getByLabelText('Kód')
    field.focus()
    await userEvent.paste('123 456')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('ignores anything that is not a digit', async () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    await userEvent.type(screen.getByLabelText('Kód'), 'abc')
    expect(screen.getByLabelText('Kód')).toHaveValue('')
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('Switch, to the letter of §6.24 (AC-291)', () => {
  function Harness({ disabled = false }: { disabled?: boolean }) {
    const [on, setOn] = useState(false)
    return (
      <Switch
        checked={on}
        onChange={setOn}
        label="Administrátor"
        hint="Spravuje trenéry"
        disabled={disabled}
        disabledHint="Jste jediný administrátor."
      />
    )
  }

  // A real checkbox with role="switch": the keyboard, the screen reader and the
  // form all keep working, and the label is the 44px target.
  it('is a real control the whole row toggles', async () => {
    render(<Harness />)
    const control = screen.getByRole('switch', { name: /Administrátor/ })
    expect(control).not.toBeChecked()

    await userEvent.click(screen.getByText('Administrátor'))
    expect(control).toBeChecked()
  })

  it('says why it cannot be moved, in place of the hint', () => {
    render(<Harness disabled />)
    expect(screen.getByRole('switch', { name: /Administrátor/ })).toBeDisabled()
    expect(screen.getByText('Jste jediný administrátor.')).toBeInTheDocument()
    expect(screen.queryByText('Spravuje trenéry')).toBeNull()
  })
})
