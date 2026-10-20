// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { useEditor } from '../../src/ui/store/editor'

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1
    constructor(_init?: string) {}
  } as unknown as typeof DOMMatrixReadOnly
})

beforeEach(() => {
  localStorage.clear()
  act(() => useLang.getState().setLang('es'))
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  useLang.getState().setLang('es')
})

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' })

describe('client color swatches', () => {
  it('shows the palette as a radio group; clicking a swatch sets the client color', () => {
    render(<App />)
    act(() => useEditor.getState().select({ kind: 'node', id: 'web' }))
    const group = within(inspector()).getByRole('radiogroup', { name: 'Color' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(6)
    expect(within(group).getByRole('radio', { name: 'Azul' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(within(group).getByRole('radio', { name: 'Durazno' }))
    expect(useEditor.getState().graph.nodes.find((n) => n.id === 'web')!.config.color).toBe('#fdba74')
    expect(within(group).getByRole('radio', { name: 'Durazno' }).getAttribute('aria-checked')).toBe('true')
    expect(within(group).getByRole('radio', { name: 'Azul' }).getAttribute('aria-checked')).toBe('false')

    // Arrow keys move the selection inside the group (Durazno → Fucsia).
    fireEvent.keyDown(within(group).getByRole('radio', { name: 'Durazno' }), { key: 'ArrowRight' })
    expect(useEditor.getState().graph.nodes.find((n) => n.id === 'web')!.config.color).toBe('#d946ef')
  })

  it('names the swatches in English', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    act(() => useEditor.getState().select({ kind: 'node', id: 'web' }))
    const group = within(inspector()).getByRole('radiogroup', { name: 'Color' })
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Blue',
      'Amber',
      'Pink',
      'Lavender',
      'Peach',
      'Fuchsia',
    ])
  })
})
