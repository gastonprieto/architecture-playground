// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLang } from '../../src/i18n'
import { printGraphDsl } from '../../src/persistence/dsl'
import App from '../../src/ui/App'
import { useEditor } from '../../src/ui/store/editor'
import { useGraphText } from '../../src/ui/store/graphText'

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
  act(() => useGraphText.getState().close())
  vi.restoreAllMocks()
  localStorage.clear()
})

const setup = () => {
  render(<App />)
  act(() => {
    useEditor.getState().replaceGraph({ nodes: [], edges: [] })
    useEditor.getState().addNode('cache', { x: 0, y: 0 })
  })
}
const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Texto' }))
const area = () => screen.getByRole('textbox', { name: 'Arquitectura como texto' }) as HTMLTextAreaElement
const type = (v: string) => fireEvent.change(area(), { target: { value: v } })
const apply = () => screen.getByRole('button', { name: 'Aplicar' }) as HTMLButtonElement

describe('Texto dialog', () => {
  it('opens with the printed DSL of the graph', () => {
    setup()
    openDialog()
    expect(area().value).toBe(printGraphDsl(useEditor.getState().graph))
  })

  it('applies typed text as one undo step', () => {
    setup()
    const before = useEditor.getState().graph
    openDialog()
    type('client W\nservice S\nW --> S')
    fireEvent.click(apply())
    const g = useEditor.getState().graph
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useEditor.getState().undo())
    expect(useEditor.getState().graph).toEqual(before)
  })

  it('lists errors and disables Aplicar', () => {
    setup()
    openDialog()
    type('servise X')
    expect(screen.getByText(/^línea 1: /)).toBeTruthy()
    expect(apply().disabled).toBe(true)
  })

  it('Esc closes without changes', () => {
    setup()
    const before = useEditor.getState().graph
    openDialog()
    type('client W')
    fireEvent.keyDown(area(), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useEditor.getState().graph).toBe(before)
  })

  it('Ctrl+Enter applies valid text', () => {
    setup()
    openDialog()
    type('client W')
    fireEvent.keyDown(area(), { key: 'Enter', ctrlKey: true })
    expect(useEditor.getState().graph.nodes.map((n) => n.type)).toEqual(['client'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('file with errors opens dialog, graph unchanged', async () => {
    setup()
    const before = useEditor.getState().graph
    const text = 'servise A\nclient B\nB --> Z'
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([text], 'a.arch')] } })
    await waitFor(() => expect(area().value).toBe(text))
    expect(screen.getAllByText(/^línea \d+: /).length).toBeGreaterThanOrEqual(2)
    expect(apply().disabled).toBe(true)
    expect(useEditor.getState().graph).toBe(before)
  })
})
