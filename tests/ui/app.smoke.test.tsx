// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import { STORAGE_KEY } from '../../src/persistence/storage'
import App from '../../src/ui/App'
import { useRuntime } from '../../src/ui/runtime/runtimeStore'
import { useEditor } from '../../src/ui/store/editor'

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
  // React Flow reads the viewport transform through DOMMatrixReadOnly.
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1
    constructor(_init?: string) {}
  } as unknown as typeof DOMMatrixReadOnly
})

// jsdom reports navigator.language 'en-US': these tests check the Spanish copy.
beforeEach(() => useLang.getState().setLang('es'))
afterEach(cleanup)

describe('App', () => {
  it('renders the palette and the preset graph', () => {
    render(<App />)
    expect(screen.getByText('Componentes')).toBeTruthy()
    expect(screen.getAllByText('Cliente').length).toBeGreaterThan(0)
    expect(screen.getByText('Servidor 1')).toBeTruthy()
  })

  it('hides the palette in mobile mode', () => {
    window.history.replaceState(null, '', '/?mobile=1')
    try {
      render(<App />)
      expect(screen.queryByText('Componentes')).toBeNull()
      expect(screen.getByText('Servidor 1')).toBeTruthy()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('"Limpiar todo" empties the canvas, and Deshacer brings the graph back', () => {
    localStorage.clear()
    render(<App />)
    const before = useEditor.getState().graph
    expect(before.nodes.length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar todo' }))
    expect(useEditor.getState().graph).toEqual({ nodes: [], edges: [] })
    expect(screen.getByRole('button', { name: 'Limpiar todo' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(useEditor.getState().graph).toBe(before)
    localStorage.clear()
  })

  it('flushes a pending save on pagehide', () => {
    localStorage.clear()
    render(<App />)
    act(() => {
      useEditor.getState().addNode('cache', { x: 0, y: 0 })
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"cache"')
    localStorage.clear()
  })

  it('Space toggles play, but not on key repeat nor when a button has focus', () => {
    render(<App />)
    const space = (target: EventTarget, repeat = false) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat, bubbles: true, cancelable: true }))
      })
    useRuntime.setState({ playing: false })
    space(document.body)
    expect(useRuntime.getState().playing).toBe(true)
    space(document.body, true)
    expect(useRuntime.getState().playing).toBe(true)
    const btn = screen.getByRole('button', { name: 'Exportar' })
    btn.focus()
    space(btn)
    expect(useRuntime.getState().playing).toBe(true)
    useRuntime.setState({ playing: false })
  })
})
