// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Graph } from '../../src/engine/types'
import { useLang } from '../../src/i18n'
import { STORAGE_KEY } from '../../src/persistence/storage'
import { serializeGraph } from '../../src/persistence/serialize'
import App from '../../src/ui/App'
import { CLIENT_COLORS } from '../../src/ui/colors'
import { useRuntime } from '../../src/ui/runtime/runtimeStore'
import { useInfoPanel } from '../../src/ui/store/infoPanel'
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
  act(() => useInfoPanel.getState().close())
  localStorage.clear()
  useLang.getState().setLang('es')
})

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' })
const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, config })

describe('old graphs get client colors and IPs', () => {
  it('a saved graph whose Clientes have no color/ip boots with distinct ones', () => {
    const old: Graph = { nodes: [node('a', 'client', { name: 'A' }), node('b', 'client', { name: 'B' })], edges: [] }
    localStorage.setItem(STORAGE_KEY, serializeGraph(old))
    render(<App />)
    const [a, b] = useEditor.getState().graph.nodes
    expect([a.config.color, b.config.color]).toEqual([CLIENT_COLORS[0], CLIENT_COLORS[1]])
    expect([a.config.ip, b.config.ip]).toEqual(['10.0.0.1', '10.0.0.2'])
  })
})

describe('info dialog keyboard', () => {
  it('keys pressed with focus outside the panel do not reach the app; Esc closes', () => {
    render(<App />)
    act(() => useEditor.getState().select({ kind: 'node', id: 'db' }))
    act(() => useRuntime.setState({ playing: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Cómo funciona Cola' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('tabindex')).toBe('-1')
    expect(document.querySelector('.app')!.hasAttribute('inert')).toBe(true)

    ;(document.activeElement as HTMLElement).blur()
    for (const key of ['Delete', 'Backspace', ' ']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    expect(useEditor.getState().graph.nodes.some((n) => n.id === 'db')).toBe(true)
    expect(useRuntime.getState().playing).toBe(false)

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.app')!.hasAttribute('inert')).toBe(false)
  })
})

describe('dropping a Cliente from the palette', () => {
  it('gives it the next free IP and color', () => {
    render(<App />)
    const pane = document.querySelector('.react-flow')!
    const dataTransfer = { types: ['application/x-arch-type'], getData: () => 'client', dropEffect: '' }
    fireEvent.dragOver(pane, { dataTransfer, clientX: 100, clientY: 100 })
    fireEvent.drop(pane, { dataTransfer, clientX: 100, clientY: 100 })
    const added = useEditor.getState().graph.nodes.at(-1)!
    expect(added.type).toBe('client')
    // The load-balancer preset already uses 10.0.0.1/.2 and the first two colors.
    expect(added.config).toMatchObject({ ip: '10.0.0.3', color: CLIENT_COLORS[2], rate: 0 })
  })
})

describe('weights UI details', () => {
  it('marks down targets in the Pesos section', () => {
    render(<App />)
    act(() => {
      useEditor.getState().updateNodeConfig('lb', { algorithm: 'weighted' })
      useEditor.getState().updateNodeConfig('srv-2', { up: false })
      useEditor.getState().select({ kind: 'node', id: 'lb' })
    })
    const section = within(inspector()).getByRole('group', { name: 'Pesos' })
    expect([...section.querySelectorAll('.weight-down')].map((x) => x.textContent)).toEqual(['(caído)'])
  })

  it('an imported weight above 100 is shown and kept, not clamped', () => {
    render(<App />)
    act(() => {
      const g = useEditor.getState().graph
      useEditor.getState().loadGraph({
        nodes: g.nodes.map((n) => (n.id === 'lb' ? { ...n, config: { ...n.config, algorithm: 'weighted' } } : n)),
        edges: g.edges.map((e) => (e.id === 'lb-srv-1' ? { ...e, weight: 250 } : e)),
      })
      useEditor.getState().select({ kind: 'node', id: 'lb' })
    })
    const input = within(within(inspector()).getByRole('group', { name: 'Pesos' })).getByLabelText('Servidor 1') as HTMLInputElement
    expect(input.value).toBe('250')
    fireEvent.blur(input)
    expect(useEditor.getState().graph.edges.find((e) => e.id === 'lb-srv-1')!.weight).toBe(250)
  })
})
