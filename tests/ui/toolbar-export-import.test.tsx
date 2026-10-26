// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLang } from '../../src/i18n'
import { printGraphDsl } from '../../src/persistence/dsl'
import { serializeGraph } from '../../src/persistence/serialize'
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
  vi.restoreAllMocks()
  localStorage.clear()
})

const renderEmpty = () => {
  render(<App />)
  act(() => useEditor.getState().replaceGraph({ nodes: [], edges: [] }))
}
const input = () => document.querySelector('input[type="file"]') as HTMLInputElement

describe('toolbar export / import', () => {
  it('exports the graph as DSL text in arquitectura.arch', async () => {
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn()
    let download = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download
    })
    renderEmpty()
    act(() => {
      useEditor.getState().addNode('cache', { x: 0, y: 0 })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(download).toBe('arquitectura.arch')
    expect(blob?.type).toBe('text/plain')
    expect(await blob?.text()).toBe(printGraphDsl(useEditor.getState().graph))
  })

  it('accepts .arch, .txt and .json files', () => {
    renderEmpty()
    expect(input().accept).toBe('.arch,.txt,.json,text/plain,application/json')
  })

  it('imports a .arch file', async () => {
    renderEmpty()
    const file = new File(['client Web\nservice Api\nWeb --> Api\n'], 'a.arch', { type: 'text/plain' })
    fireEvent.change(input(), { target: { files: [file] } })
    await waitFor(() => expect(useEditor.getState().graph.nodes.map((n) => n.type)).toEqual(['client', 'service']))
  })

  it('still imports an old .json file', async () => {
    renderEmpty()
    act(() => {
      useEditor.getState().addNode('cache', { x: 0, y: 0 })
    })
    const json = serializeGraph(useEditor.getState().graph)
    act(() => useEditor.getState().replaceGraph({ nodes: [], edges: [] }))
    fireEvent.change(input(), { target: { files: [new File([json], 'a.json', { type: 'application/json' })] } })
    await waitFor(() => expect(useEditor.getState().graph.nodes.map((n) => n.type)).toEqual(['cache']))
  })

  it('shows the first DSL error as a toast and keeps the graph', async () => {
    renderEmpty()
    fireEvent.change(input(), { target: { files: [new File(['servise W'], 'a.arch')] } })
    await screen.findByText(/^línea 1: "servise" no es un tipo/)
    expect(useEditor.getState().graph.nodes).toEqual([])
  })
})
