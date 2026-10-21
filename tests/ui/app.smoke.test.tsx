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

  it('a Cliente has an output port but no input port; other nodes have both', () => {
    localStorage.clear()
    const { container } = render(<App />)
    const handles = (id: string) => {
      const el = container.querySelector(`.react-flow__node[data-id="${id}"]`)!
      return { target: el.querySelectorAll('.react-flow__handle.target').length, source: el.querySelectorAll('.react-flow__handle.source').length }
    }
    expect(handles('web')).toEqual({ target: 0, source: 1 })
    expect(handles('srv-1')).toEqual({ target: 1, source: 1 })
  })

  it('a graph with an old edge into a Cliente still loads and renders', () => {
    localStorage.clear()
    render(<App />)
    try {
      act(() => {
        useEditor.getState().loadGraph({
          nodes: [
            { id: 's', type: 'service', position: { x: 0, y: 0 }, config: { name: 'S' } },
            { id: 'c', type: 'client', position: { x: 300, y: 0 }, config: { name: 'C' } },
          ],
          edges: [{ id: 's-c', source: 's', target: 'c' }],
        })
      })
      expect(screen.getByText('S')).toBeTruthy()
      expect(screen.getByText('C')).toBeTruthy()
      // React Flow cannot draw an edge without a target handle (error 008, wire hidden), so a Cliente
      // with a legacy incoming wire keeps a hidden anchor that accepts no new connections.
      const anchor = document.querySelector('.react-flow__node[data-id="c"] .react-flow__handle.target')!
      expect(anchor).toBeTruthy()
      expect(anchor.classList.contains('arch-handle-anchor')).toBe(true)
      expect(anchor.classList.contains('connectable')).toBe(false)
    } finally {
      // Unmounting flushes the pending save; clear it after so later tests start from the preset.
      cleanup()
      localStorage.clear()
    }
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

  it('speed is a dropdown with every speed, and choosing one sets it', () => {
    render(<App />)
    const select = screen.getByRole('combobox', { name: 'Velocidad (teclas - y +)' }) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['0.25x', '0.5x', '1x', '2x', '4x'])
    expect(select.value).toBe(String(useRuntime.getState().speed))
    fireEvent.change(select, { target: { value: '2' } })
    expect(useRuntime.getState().speed).toBe(2)
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
