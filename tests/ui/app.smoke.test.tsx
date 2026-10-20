// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import App from '../../src/ui/App'

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
})
