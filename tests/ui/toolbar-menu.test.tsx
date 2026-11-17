// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { useEditor } from '../../src/ui/store/editor'
import { useScenario } from '../../src/ui/store/scenario'
import { useTheme } from '../../src/ui/store/theme'
import { openToolbarMenu } from './toolbarMenu'

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
})

const trigger = () => screen.getByRole('button', { name: 'Más opciones' })
const isOpen = () => trigger().getAttribute('aria-expanded') === 'true'

describe('toolbar ⋯ menu', () => {
  it('keeps the occasional actions out of the bar until it is opened', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: 'Exportar' })).toBeNull()
    openToolbarMenu()
    for (const name of ['Copiar link', 'Exportar', 'Importar', 'Editar como texto']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.getByRole('link', { name: 'Código en GitHub' })).toBeTruthy()
  })

  it('closes on Escape and gives focus back to the ⋯ button', () => {
    render(<App />)
    openToolbarMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on a press outside, but not on one inside', () => {
    render(<App />)
    openToolbarMenu()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Exportar' }))
    expect(isOpen()).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(isOpen()).toBe(false)
  })

  it('switching the theme leaves the menu open', () => {
    render(<App />)
    openToolbarMenu()
    const next = useTheme.getState().theme === 'dark' ? 'Claro' : 'Oscuro'
    fireEvent.click(screen.getByRole('button', { name: next }))
    expect(useTheme.getState().theme).toBe(next === 'Claro' ? 'light' : 'dark')
    expect(isOpen()).toBe(true)
  })

  it('Nuevo lives in the bar, not in the menu', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Nuevo' })).toBeTruthy()
    openToolbarMenu()
    expect(screen.getAllByRole('button', { name: 'Nuevo' })).toHaveLength(1)
  })
})

describe('Nuevo confirmation', () => {
  it('warns before deleting; Cancelar keeps the graph and has the initial focus', () => {
    render(<App />)
    const before = useEditor.getState().graph
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    const dialog = screen.getByRole('dialog', { name: '¿Empezar un diagrama nuevo?' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useEditor.getState().graph).toBe(before)
  })

  it('Esc closes it without deleting', () => {
    render(<App />)
    const before = useEditor.getState().graph
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useEditor.getState().graph).toBe(before)
  })

  it('confirming empties the canvas and leaves the current scenario', () => {
    render(<App />)
    expect(useScenario.getState().currentId).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Borrar y empezar' }))
    expect(useEditor.getState().graph).toEqual({ nodes: [], edges: [] })
    expect(useScenario.getState().currentId).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
