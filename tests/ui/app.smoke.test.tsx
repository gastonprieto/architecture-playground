// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../../src/persistence/storage'
import App from '../../src/ui/App'
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
})
