// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '../../src/ui/Inspector'
import { useEditor } from '../../src/ui/store/editor'

const graph = {
  nodes: [
    { id: 'c1', type: 'client', position: { x: 0, y: 0 }, config: { name: 'Cliente A', kind: 'request', rate: 2, mix: [{ value: '/', weight: 1 }], burstSize: 20 } },
    { id: 'lb1', type: 'load-balancer', position: { x: 0, y: 0 }, config: { name: 'LB', algorithm: 'round-robin', capacity: 2 } },
    { id: 's1', type: 'service', position: { x: 0, y: 0 }, config: { name: 'Svc', capacity: 2 } },
    { id: 'x1', type: 'nope', position: { x: 0, y: 0 }, config: {} },
  ],
  edges: [{ id: 'e1', source: 'c1', target: 'lb1' }],
}

const select = (sel: { kind: 'node' | 'edge'; id: string } | null) => act(() => useEditor.getState().select(sel))

beforeEach(() => act(() => useEditor.getState().loadGraph(structuredClone(graph))))
afterEach(cleanup)

describe('Inspector', () => {
  it('shows help text when nothing is selected', () => {
    render(<Inspector />)
    expect(screen.getByText('Arrastrá componentes desde la izquierda y conectalos. Seleccioná uno para configurarlo.')).toBeTruthy()
  })

  it('shows the algorithm options for a load balancer', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 'lb1' })
    const sel = screen.getByLabelText('Algoritmo') as HTMLSelectElement
    expect([...sel.options].map((o) => o.value)).toContain('least-connections')
    fireEvent.change(sel, { target: { value: 'random' } })
    expect(useEditor.getState().graph.nodes[1].config.algorithm).toBe('random')
  })

  it('clamps number input to max', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 's1' })
    const input = screen.getByLabelText('Capacidad', { selector: 'input[type=number]' })
    fireEvent.change(input, { target: { value: '99' } })
    expect(useEditor.getState().graph.nodes[2].config.capacity).toBe(50)
  })

  it('edits the name first', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 'lb1' })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Balanceador' } })
    expect(useEditor.getState().graph.nodes[1].config.name).toBe('Balanceador')
  })

  it('sets an edge rule', () => {
    render(<Inspector />)
    select({ kind: 'edge', id: 'e1' })
    expect(screen.getByText('Cliente A → LB')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Regla'), { target: { value: 'pathPrefix' } })
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '/ordenes' } })
    expect(useEditor.getState().graph.edges[0].rule).toEqual({ kind: 'pathPrefix', value: '/ordenes' })
    fireEvent.change(screen.getByLabelText('Regla'), { target: { value: '' } })
    expect(useEditor.getState().graph.edges[0].rule).toBeUndefined()
  })

  it('client action buttons call runAction', () => {
    const runAction = vi.fn()
    render(<Inspector runAction={runAction} />)
    select({ kind: 'node', id: 'c1' })
    fireEvent.click(screen.getByText('Enviar 1'))
    fireEvent.click(screen.getByText('Ráfaga'))
    expect(runAction).toHaveBeenNthCalledWith(1, 'c1', 'send1')
    expect(runAction).toHaveBeenNthCalledWith(2, 'c1', 'burst')
  })

  it('disables actions without runAction', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 'c1' })
    expect((screen.getByText('Enviar 1') as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits the mix', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 'c1' })
    fireEvent.click(screen.getByText('Agregar'))
    expect(useEditor.getState().graph.nodes[0].config.mix).toEqual([{ value: '/', weight: 1 }, { value: '', weight: 1 }])
    fireEvent.click(screen.getAllByText('Quitar')[0])
    expect(useEditor.getState().graph.nodes[0].config.mix).toEqual([{ value: '', weight: 1 }])
  })

  it('deletes nodes and shows unknown types', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 'x1' })
    expect(screen.getByText('Tipo desconocido: nope')).toBeTruthy()
    fireEvent.click(screen.getByText('Borrar'))
    expect(useEditor.getState().graph.nodes.map((n) => n.id)).toEqual(['c1', 'lb1', 's1'])
  })
})
