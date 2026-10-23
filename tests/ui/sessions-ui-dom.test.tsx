// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { NodeStatsSlot } from '../../src/ui/canvas/ArchNode'
import { useRuntime } from '../../src/ui/runtime/runtimeStore'
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

const node = (id: string, type: string, config: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, config })

const graph = () => ({
  nodes: [
    node('c1', 'client', { name: 'Cliente', rate: 0, users: 5, auth: 'login' }),
    node('lb1', 'load-balancer', { name: 'LB' }),
    node('p1', 'reverse-proxy', { name: 'Proxy' }),
    node('s1', 'service', { name: 'Svc', behavior: 'on request:\n  session memory\n' }),
    node('db1', 'database', { name: 'Base', kind: 'relational', processingTime: 300 }),
    node('db2', 'database', { name: 'KV', kind: 'key-value', processingTime: 20 }),
    node('db3', 'database', { name: 'Vieja' }),
  ],
  edges: [],
})

function renderWith(select?: string) {
  const utils = render(<App />)
  act(() => {
    useEditor.getState().loadGraph(graph())
    if (select) useEditor.getState().select({ kind: 'node', id: select })
  })
  return utils
}

const inspector = () => screen.getByRole('complementary', { name: 'Inspector' })
const cfg = (id: string) => useEditor.getState().graph.nodes.find((n) => n.id === id)!.config
const nodeEl = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!

beforeEach(() => {
  localStorage.clear()
  act(() => useLang.getState().setLang('es'))
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  act(() => useRuntime.setState({ states: {} }))
  useLang.getState().setLang('es')
})

describe('inspector fields', () => {
  it('client: Usuarios and Autenticación', () => {
    renderWith('c1')
    expect(within(inspector()).getByLabelText('Usuarios', { selector: 'input[type=number]' })).toBeTruthy()
    const auth = within(inspector()).getByLabelText('Autenticación') as HTMLSelectElement
    expect([...auth.options].map((o) => o.textContent)).toEqual(['Con login', 'Sin credenciales'])
  })

  it('load balancer: Sticky sessions; proxy: Autenticación', () => {
    renderWith('lb1')
    expect(within(inspector()).getByLabelText('Sticky sessions')).toBeTruthy()
    act(() => useEditor.getState().select({ kind: 'node', id: 'p1' }))
    const auth = within(inspector()).getByLabelText('Autenticación') as HTMLSelectElement
    expect([...auth.options].map((o) => o.textContent)).toEqual(['Ninguna', 'Credenciales', 'JWT'])
  })

  it('database: changing Tipo applies the suggested processingTime, in one undo step', () => {
    renderWith('db1')
    const kind = within(inspector()).getByLabelText('Tipo') as HTMLSelectElement
    expect([...kind.options].map((o) => o.textContent)).toEqual(['Relacional', 'Clave-valor', 'Documental'])
    fireEvent.change(kind, { target: { value: 'key-value' } })
    expect(cfg('db1')).toMatchObject({ kind: 'key-value', processingTime: 20 })
    act(() => useEditor.getState().undo())
    expect(cfg('db1')).toMatchObject({ kind: 'relational', processingTime: 300 })
  })

  it('database: a customized processingTime is kept', () => {
    renderWith('db1')
    act(() => useEditor.getState().updateNodeConfig('db1', { processingTime: 450 }, { coalesce: false }))
    fireEvent.change(within(inspector()).getByLabelText('Tipo'), { target: { value: 'document' } })
    expect(cfg('db1')).toMatchObject({ kind: 'document', processingTime: 450 })
  })
})

describe('database on the canvas', () => {
  it('shows the kind icon and "Base de datos · <tipo>"', () => {
    renderWith()
    expect(nodeEl('db1').querySelector('.arch-node-icon')!.textContent).toBe('🛢️')
    expect(nodeEl('db1').querySelector('.arch-node-type')!.textContent).toBe('Base de datos · relacional')
    expect(nodeEl('db2').querySelector('.arch-node-icon')!.textContent).toBe('🗝️')
    expect(nodeEl('db2').querySelector('.arch-node-type')!.textContent).toBe('Base de datos · clave-valor')
    expect(nodeEl('db3').querySelector('.arch-node-type')!.textContent).toBe('Base de datos · relacional')
    act(() => useEditor.getState().updateNodeConfig('db3', { kind: 'document' }))
    expect(nodeEl('db3').querySelector('.arch-node-icon')!.textContent).toBe('📄')
  })

  it('in English: "Database · key-value"', () => {
    renderWith()
    act(() => useLang.getState().setLang('en'))
    expect(nodeEl('db2').querySelector('.arch-node-type')!.textContent).toBe('Database · key-value')
    expect(nodeEl('db3').querySelector('.arch-node-type')!.textContent).toBe('Database · relational')
  })

  it('the palette keeps the base icon', () => {
    renderWith()
    const nav = screen.getByRole('navigation', { name: 'Componentes' })
    expect(within(nav).getByText('Base de datos').previousElementSibling!.textContent).toBe('🛢️')
  })
})

describe('🍪 counters', () => {
  it('client shows logged/N', () => {
    act(() => useRuntime.setState({ states: { c1: { cookies: 3 } } }))
    render(<NodeStatsSlot nodeId="c1" kind="client" config={{ users: 5, auth: 'login' }} />)
    const el = screen.getByText('🍪 3/5')
    expect(el.getAttribute('title')).toBe('Usuarios logueados')
  })

  it('a service with session memory and a database with sessions show N', () => {
    act(() => useRuntime.setState({ states: { s1: { sessions: 4 }, db1: { sessions: 2 }, db2: { sessions: 0 } } }))
    render(
      <>
        <NodeStatsSlot nodeId="s1" kind="service" config={{ behavior: 'on request:\n  session memory\n' }} />
        <NodeStatsSlot nodeId="db1" kind="database" config={{}} />
        <NodeStatsSlot nodeId="db2" kind="database" config={{}} />
      </>,
    )
    expect(screen.getByText('🍪 4').getAttribute('title')).toBe('Sesiones guardadas')
    expect(screen.getByText('🍪 2')).toBeTruthy()
    expect(screen.queryByText('🍪 0')).toBeNull()
  })

  it('no counter for a single-user client with nobody logged in', () => {
    render(<NodeStatsSlot nodeId="cx" kind="client" config={{ users: 1, auth: 'login' }} />)
    expect(screen.queryByText(/🍪/)).toBeNull()
  })
})

describe('🔑 / hit % counters (cache-spec §2.3)', () => {
  it('client, LB and proxy nodes show ⇄ pending requests; a service does not', () => {
    const st = { inFlight: 0, queued: 0, ok: 0, errors: 0, pending: 3 }
    act(() => useRuntime.setState({ stats: { c1: st, l1: st, s9: st } }))
    render(
      <>
        <NodeStatsSlot nodeId="c1" kind="client" config={{}} />
        <NodeStatsSlot nodeId="l1" kind="load-balancer" config={{}} />
        <NodeStatsSlot nodeId="s9" kind="service" config={{}} />
      </>,
    )
    expect(screen.getAllByText('⇄ 3')).toHaveLength(2)
    act(() => useRuntime.setState({ stats: {} }))
  })

  it('a Cache shows its keys and real hit %; a proxy keeps them for the inspector', () => {
    act(() =>
      useRuntime.setState({
        states: { k1: { cacheKeys: 4, cacheHits: 1, cacheMisses: 3 }, p1: { cacheKeys: 2, cacheHits: 2, cacheMisses: 2 }, p2: { cacheKeys: 0, cacheHits: 5, cacheMisses: 0 } },
      }),
    )
    render(
      <>
        <NodeStatsSlot nodeId="k1" kind="cache" config={{ mode: 'keys' }} />
        <NodeStatsSlot nodeId="p1" kind="reverse-proxy" config={{ cache: 'keys' }} />
        <NodeStatsSlot nodeId="p2" kind="reverse-proxy" config={{ cache: 'random' }} />
      </>,
    )
    expect(screen.getByText('🔑 4').getAttribute('title')).toBe('Claves guardadas')
    expect(screen.getByText('hit 25%').getAttribute('title')).toBe('Hit % real: HITs / (HITs + MISSes)')
    expect(screen.queryByText('🔑 2')).toBeNull()
    expect(screen.queryByText('hit 50%')).toBeNull()
    expect(screen.queryByText('hit 100%')).toBeNull()
  })
})

describe('info texts', () => {
  it('Servicio explains automatic cache-aside and the DSL reference has the cache step with its example', () => {
    renderWith('s1')
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Cómo funciona Servicio' }))
    const dialog = screen.getByRole('dialog', { name: 'Servicio' })
    expect(dialog.textContent).toMatch(/Cache-aside automático/)
    expect(within(dialog).getByText('cache Destino:')).toBeTruthy()
    expect(dialog.querySelector('.dsl-ref-row-example')!.textContent).toBe('cache Cache:\n  query Base de datos\nreply 200')
  })

  it('the DSL reference mentions that a JWT cannot be revoked', () => {
    renderWith('s1')
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Cómo funciona Servicio' }))
    const dialog = screen.getByRole('dialog', { name: 'Servicio' })
    expect(within(dialog).getByText('session memory | jwt | Base')).toBeTruthy()
    expect(dialog.textContent).toMatch(/no se puede revocar/)
  })

  it('client, database, LB and proxy explain sessions and auth', () => {
    renderWith('c1')
    const open = (id: string, label: string) => {
      act(() => useEditor.getState().select({ kind: 'node', id }))
      fireEvent.click(within(inspector()).getByRole('button', { name: `Cómo funciona ${label}` }))
      const text = screen.getByRole('dialog', { name: label }).textContent!
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
      return text
    }
    expect(open('c1', 'Cliente')).toMatch(/session-lost/)
    expect(open('db1', 'Base de datos')).toMatch(/sesiones/)
    expect(open('lb1', 'Load Balancer')).toMatch(/health checks/)
    expect(open('p1', 'Reverse Proxy')).toMatch(/session memory/)
  })
})
