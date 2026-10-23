// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Graph } from '../../src/engine/types'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { weightedEdgeShares } from '../../src/ui/lbWeights'
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

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' })
const shares = (el: HTMLElement) => [...el.querySelectorAll('.weight-share')].map((x) => x.textContent)

describe('weighted load balancer UI', () => {
  it('the LB inspector shows the Pesos section only in weighted mode; editing a weight updates the effective %', () => {
    render(<App />)
    act(() => useEditor.getState().select({ kind: 'node', id: 'lb' }))
    expect(within(inspector()).queryByText('Pesos')).toBeNull()

    fireEvent.change(within(inspector()).getByLabelText('Algoritmo'), { target: { value: 'weighted' } })
    const section = within(inspector()).getByRole('group', { name: 'Pesos' })
    expect(within(section).getByText(/relativos/)).toBeTruthy()
    // No weights stored yet: shown as an equal split.
    expect(shares(section)).toEqual(['33%', '33%', '33%'])
    expect(useEditor.getState().graph.edges.some((e) => e.weight !== undefined)).toBe(false)

    fireEvent.change(within(section).getByLabelText('Servidor 1'), { target: { value: '2' } })
    expect(useEditor.getState().graph.edges.find((e) => e.id === 'lb-srv-1')!.weight).toBe(2)
    expect(shares(section)).toEqual(['50%', '25%', '25%'])

    fireEvent.change(within(inspector()).getByLabelText('Algoritmo'), { target: { value: 'round-robin' } })
    expect(within(inspector()).queryByRole('group', { name: 'Pesos' })).toBeNull()
  })

  it('in English the section is "Weights"', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    act(() => {
      useEditor.getState().updateNodeConfig('lb', { algorithm: 'weighted' })
      useEditor.getState().select({ kind: 'node', id: 'lb' })
    })
    expect(within(inspector()).getByRole('group', { name: 'Weights' })).toBeTruthy()
  })

  it('the edge inspector shows the weight only when the source is a weighted LB', () => {
    render(<App />)
    act(() => useEditor.getState().select({ kind: 'edge', id: 'lb-srv-2' }))
    expect(within(inspector()).queryByLabelText('Peso')).toBeNull()
    act(() => useEditor.getState().updateNodeConfig('lb', { algorithm: 'weighted' }))
    fireEvent.change(within(inspector()).getByLabelText('Peso'), { target: { value: '3' } })
    expect(useEditor.getState().graph.edges.find((e) => e.id === 'lb-srv-2')!.weight).toBe(3)
    expect(shares(inspector())).toEqual(['60%'])
    // Not for edges out of other nodes.
    act(() => useEditor.getState().select({ kind: 'edge', id: 'srv-1-db' }))
    expect(within(inspector()).queryByLabelText('Peso')).toBeNull()
  })
})

describe('weightedEdgeShares', () => {
  const n = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, config })
  it('gives the effective % of each edge out of a weighted LB, and nothing for others', () => {
    const g: Graph = {
      nodes: [n('lb', 'load-balancer', { algorithm: 'weighted' }), n('rr', 'load-balancer'), n('a', 'service'), n('b', 'service'), n('c', 'service')],
      edges: [
        { id: 'lb-a', source: 'lb', target: 'a', weight: 60 },
        { id: 'lb-b', source: 'lb', target: 'b', weight: 30 },
        { id: 'lb-c', source: 'lb', target: 'c', weight: 10 },
        { id: 'rr-a', source: 'rr', target: 'a', weight: 5 },
        { id: 'a-b', source: 'a', target: 'b' },
      ],
    }
    expect(weightedEdgeShares(g)).toEqual({ 'lb-a': 60, 'lb-b': 30, 'lb-c': 10 })
  })
})
