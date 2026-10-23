// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { useEditor } from '../../src/ui/store/editor'
import { useInspectorTab } from '../../src/ui/store/inspectorTab'

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

// These tests edit configuration: start every inspector on the Configuración tab.
beforeEach(() => useInspectorTab.getState().setTab('config'))
beforeEach(() => {
  localStorage.clear()
  act(() => useLang.getState().setLang('es'))
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  useLang.getState().setLang('es')
})

const palette = () => screen.getByRole('navigation')

describe('language switch', () => {
  it('ES | EN re-renders the whole UI in the chosen language', () => {
    render(<App />)
    expect(screen.getByText('Componentes')).toBeTruthy()
    expect(screen.getByText(/^Arrastrá componentes desde la izquierda/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ES' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByText('Components')).toBeTruthy()
    expect(palette().textContent).toContain('Client')
    expect(palette().textContent).toContain('Database')
    expect(screen.getByText('Drag components from the left and connect them. Select one to configure it.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
    expect(screen.getByText(/Errors/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('architecture-playground:lang')).toBe('en')

    fireEvent.click(screen.getByRole('button', { name: 'ES' }))
    expect(screen.getByText('Componentes')).toBeTruthy()
    expect(palette().textContent).toContain('Cliente')
    expect(screen.getByText(/^Arrastrá componentes desde la izquierda/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy()
  })

  it('the inspector shows translated fields, options and actions; user names stay as they are', () => {
    render(<App />)
    const client = useEditor.getState().graph.nodes.find((n) => n.type === 'client')!
    act(() => useEditor.getState().select({ kind: 'node', id: client.id }))
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Burst size', { selector: 'input[type=number]' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Event' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Burst' })).toBeTruthy()
    // The graph was loaded in Spanish: switching the UI language does not rename user data.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Navegador')
  })

  it('loading a preset uses the current language', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    fireEvent.change(screen.getByLabelText('Presets'), { target: { value: 'pubsub' } })
    const names = useEditor.getState().graph.nodes.map((n) => n.config.name)
    expect(names).toEqual(['Orders', 'Broker', 'Billing', 'Inventory', 'Emails', 'Analytics'])
    expect(screen.getByRole('option', { name: 'Reverse Proxy' })).toBeTruthy()
  })

  it("React Flow's built-in aria labels follow the language", () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fit view' })).toBeTruthy()
  })

  it('the toggle stays visible in mobile mode', () => {
    window.history.replaceState(null, '', '/?mobile=1')
    try {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: 'EN' }))
      expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'EN' }).getAttribute('aria-pressed')).toBe('true')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})
