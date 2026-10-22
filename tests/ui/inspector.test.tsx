// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLang } from '../../src/i18n'
import { Inspector } from '../../src/ui/Inspector'
import { useEditor } from '../../src/ui/store/editor'
import { useRuntime } from '../../src/ui/runtime/runtimeStore'
import type { LbView } from '../../src/ui/runtime/useSimulation'

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
// jsdom reports navigator.language 'en-US': these tests check the Spanish copy.
beforeEach(() => useLang.getState().setLang('es'))
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
    fireEvent.blur(input)
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

describe('NumberField typing', () => {
  const setup = () => {
    act(() => useEditor.getState().loadGraph({ nodes: [{ id: 'c1', type: 'client', position: { x: 0, y: 0 }, config: { name: 'C', burstSize: 20 } }], edges: [] }))
    render(<Inspector />)
    select({ kind: 'node', id: 'c1' })
    // burstSize: min 1, max 200; use rate? rate min 0. Use a min>1 field via processingTime below.
  }
  it('multi-digit typing with min > 1 does not clamp mid-way', () => {
    act(() => useEditor.getState().loadGraph({ nodes: [{ id: 's1', type: 'service', position: { x: 0, y: 0 }, config: { name: 'S', processingTime: 400 } }], edges: [] }))
    render(<Inspector />)
    select({ kind: 'node', id: 's1' })
    const writes: unknown[] = []
    const unsub = useEditor.subscribe((s) => writes.push(s.graph.nodes[0].config.processingTime))
    const input = screen.getByLabelText('Tiempo de proceso', { selector: 'input[type=number]' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.change(input, { target: { value: '150' } })
    unsub()
    expect(writes).not.toContain(50)
    expect(useEditor.getState().graph.nodes[0].config.processingTime).toBe(150)
  })
  it('clamps on blur and Enter', () => {
    setup()
    const input = screen.getByLabelText('Tamaño de ráfaga', { selector: 'input[type=number]' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    expect(useEditor.getState().graph.nodes[0].config.burstSize).toBe(20)
    fireEvent.blur(input)
    expect(useEditor.getState().graph.nodes[0].config.burstSize).toBe(200)
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useEditor.getState().graph.nodes[0].config.burstSize).toBe(1)
  })
  it('mix weight can be cleared without snapping, empty on blur is 0', () => {
    render(<Inspector />)
    select({ kind: 'node', id: 'c1' })
    const w = screen.getByLabelText('Peso 1') as HTMLInputElement
    fireEvent.change(w, { target: { value: '' } })
    expect(w.value).toBe('')
    fireEvent.blur(w)
    expect(useEditor.getState().graph.nodes[0].config.mix).toEqual([{ value: '/', weight: 0 }])
  })
})

describe('Inspector: conditional fields', () => {
  it('a Cache shows only the fields of its mode (showIf)', () => {
    act(() =>
      useEditor.getState().loadGraph({ nodes: [{ id: 'k1', type: 'cache', position: { x: 0, y: 0 }, config: { name: 'Cache', mode: 'keys' } }], edges: [] }),
    )
    render(<Inspector />)
    select({ kind: 'node', id: 'k1' })
    expect(screen.getByLabelText('Capacidad', { selector: 'input[type=number]' })).toBeTruthy()
    expect(screen.queryByLabelText('Hit rate', { selector: 'input[type=number]' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Modo'), { target: { value: 'random' } })
    expect(screen.getByLabelText('Hit rate', { selector: 'input[type=number]' })).toBeTruthy()
    expect(screen.queryByLabelText('TTL', { selector: 'input[type=number]' })).toBeNull()
  })

  const loadProxy = (config: Record<string, unknown>) =>
    act(() => useEditor.getState().loadGraph({ nodes: [{ id: 'p1', type: 'reverse-proxy', position: { x: 0, y: 0 }, config: { name: 'Proxy', ...config } }], edges: [] }))
  const proxyConfig = () => useEditor.getState().graph.nodes[0].config

  it('a proxy with its cache off hides every cache field; each mode shows its own (notEquals for the paths)', () => {
    loadProxy({ cache: 'off' })
    render(<Inspector />)
    select({ kind: 'node', id: 'p1' })
    expect(screen.queryByRole('group', { name: 'Paths cacheables' })).toBeNull()
    expect(screen.queryByLabelText('Hit rate', { selector: 'input[type=number]' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Cache'), { target: { value: 'random' } })
    expect(screen.getByLabelText('Hit rate', { selector: 'input[type=number]' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Paths cacheables' })).toBeTruthy()
    expect(screen.queryByLabelText('Capacidad', { selector: 'input[type=number]' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Cache'), { target: { value: 'keys' } })
    expect(screen.getByLabelText('Capacidad', { selector: 'input[type=number]' })).toBeTruthy()
    expect(screen.getByLabelText('TTL', { selector: 'input[type=number]' })).toBeTruthy()
    expect(screen.queryByLabelText('Hit rate', { selector: 'input[type=number]' })).toBeNull()
  })

  it('the cacheable paths list edits rows (Agregar / Quitar) and says that empty means all', () => {
    loadProxy({ cache: 'keys', cacheablePaths: ['/static'] })
    render(<Inspector />)
    select({ kind: 'node', id: 'p1' })
    const group = screen.getByRole('group', { name: 'Paths cacheables' })
    expect(group.textContent).toContain('vacío = todos')
    const row1 = screen.getByLabelText('Valor 1') as HTMLInputElement
    expect(row1.value).toBe('/static')
    expect(screen.queryByLabelText('Peso 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect(proxyConfig().cacheablePaths).toEqual(['/static', ''])
    fireEvent.change(screen.getByLabelText('Valor 2'), { target: { value: '/img' } })
    expect(proxyConfig().cacheablePaths).toEqual(['/static', '/img'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0])
    expect(proxyConfig().cacheablePaths).toEqual(['/img'])
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }))
    expect(proxyConfig().cacheablePaths).toEqual([])
  })

  it('a proxy without cacheablePaths shows the default /static row', () => {
    loadProxy({ cache: 'keys' })
    render(<Inspector />)
    select({ kind: 'node', id: 'p1' })
    expect((screen.getByLabelText('Valor 1') as HTMLInputElement).value).toBe('/static')
  })
})

describe('Inspector: LB advanced view', () => {
  const lbGraph = (algorithm: string) =>
    act(() =>
      useEditor.getState().loadGraph({
        nodes: [
          { id: 'lb1', type: 'load-balancer', position: { x: 0, y: 0 }, config: { name: 'LB', algorithm } },
          { id: 'w1', type: 'service', position: { x: 0, y: 0 }, config: { name: 'web-1' } },
          { id: 'w2', type: 'service', position: { x: 0, y: 0 }, config: { name: 'web-2' } },
        ],
        edges: [
          { id: 'e-w1', source: 'lb1', target: 'w1' },
          { id: 'e-w2', source: 'lb1', target: 'w2' },
        ],
      }),
    )
  const seedLb = (lb: LbView) => act(() => useRuntime.setState({ states: { lb1: { lb } } }))
  afterEach(() => act(() => useRuntime.setState({ states: {}, stats: {} })))

  it('shows the empty hint before any traffic', () => {
    lbGraph('round-robin')
    render(<Inspector />)
    select({ kind: 'node', id: 'lb1' })
    expect(screen.getByText('Corré la simulación para ver el reparto en vivo.')).toBeTruthy()
  })

  it('draws the live split by server, segmented by client, with the routed total', () => {
    lbGraph('least-connections')
    seedLb({
      next: 0,
      inflight: { w1: 2, w2: 5 },
      current: {},
      stickyCount: 0,
      routed: {
        w1: { total: 30, byClient: { '10.0.0.11': { n: 20, name: 'Cliente A', color: '#38bdf8' }, '10.0.0.12': { n: 10, name: 'Cliente B', color: '#a78bfa' } } },
        w2: { total: 10, byClient: { '10.0.0.13': { n: 10, name: 'Cliente C', color: '#f472b6' } } },
      },
    })
    render(<Inspector />)
    select({ kind: 'node', id: 'lb1' })
    expect(screen.getByText('least-connections · 40 req repartidas')).toBeTruthy()
    // least-connections shows an inflight chip per server; w2 is saturated.
    expect(screen.getByText('inflight 5')).toBeTruthy()
    expect(screen.getByText('inflight 2')).toBeTruthy()
    // the footer summarizes inflight and names the worst server
    expect(screen.getByText(/inflight 2 \/ 5 · web-2/)).toBeTruthy()
  })

  it('round-robin marks the server the cursor points to', () => {
    lbGraph('round-robin')
    seedLb({
      next: 1, // → w2
      inflight: {},
      current: {},
      stickyCount: 0,
      routed: { w1: { total: 5, byClient: {} }, w2: { total: 4, byClient: {} } },
    })
    render(<Inspector />)
    select({ kind: 'node', id: 'lb1' })
    expect(screen.getByText(/próxima/)).toBeTruthy()
    expect(screen.getByText(/next → web-2/)).toBeTruthy()
  })
})
