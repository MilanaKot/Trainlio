import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { RoleLabel } from '@/components/ui/role-label'

describe('RoleLabel (DESIGN_SYSTEM §6.34)', () => {
  it('names the main coach in cobalt', () => {
    const { container } = render(<RoleLabel role="MAIN" />)
    const label = container.firstElementChild!
    expect(label.textContent).toBe('Hlavní trenér')
    expect(label.className).toContain('bg-primary-100')
    expect(label.className).toContain('text-primary')
  })

  it('names an assistant in neutral', () => {
    const { container } = render(<RoleLabel role="ASSISTANT" />)
    const label = container.firstElementChild!
    expect(label.textContent).toBe('Asistent')
    expect(label.className).toContain('bg-neutral-50')
    expect(label.className).toContain('text-muted')
  })

  it('is sentence case and not a control', () => {
    const { container } = render(<RoleLabel role="MAIN" />)
    const label = container.firstElementChild!
    expect(label.className).not.toContain('uppercase')
    expect(container.querySelector('button, a, [tabindex]')).toBeNull()
  })
})
