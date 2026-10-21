// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { behaviorExample } from '../../src/ui/behaviorText'
import { useBehaviorEditor } from '../../src/ui/store/behaviorEditor'
import { useEditor } from '../../src/ui/store/editor'
import { useInfoPanel } from '../../src/ui/store/infoPanel'

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
    node('c1', 'client', { name: 'Cliente', kind: 'request', rate: 0, mix: [{ value: '/', weight: 1 }], burstSize: 5 }),
    node('s1', 'service', { name: 'Svc', capacity: 2, behavior: '' }),
    node('db1', 'database', { name: 'Base de datos' }),
    node('w1', 'worker', { name: 'W', behavior: 'on message:\n  query Base de datos\n' }),
    node('w2', 'worker', { name: 'W2', behavior: 'on message:\n  query Nadie\n' }),
  ],
  edges: [
    { id: 'e1', source: 'c1', target: 's1' },
    { id: 'e2', source: 's1', target: 'db1' },
    { id: 'e3', source: 'w1', target: 'db1' },
  ],
})

const VALID = 'on request:\n  query Base de datos\n  reply 201\n'
const INVALID = 'on request:\n  query Pagos\n'

/** Renders the app with the test graph and the Servicio selected (the app boots its own graph first). */
function renderWith(select = 's1') {
  const utils = render(<App />)
  act(() => {
    useEditor.getState().loadGraph(graph())
    useEditor.getState().select({ kind: 'node', id: select })
  })
  return utils
}

const svc = () => useEditor.getState().graph.nodes.find((n) => n.id === 's1')!
const textarea = () => screen.getByRole('textbox', { name: 'Código del comportamiento' }) as HTMLTextAreaElement
const inspector = () => screen.getByRole('complementary', { name: 'Inspector' })

function setBehavior(id: string, behavior: string) {
  act(() => useEditor.getState().updateNodeConfig(id, { behavior }, { coalesce: false }))
}

beforeEach(() => {
  localStorage.clear()
  act(() => useLang.getState().setLang('es'))
})
afterEach(() => {
  cleanup()
  act(() => {
    useBehaviorEditor.getState().close()
    useInfoPanel.getState().close()
  })
  localStorage.clear()
  useLang.getState().setLang('es')
})

describe('behavior field in the inspector', () => {
  it('summarizes the behavior: default, handlers, errors', () => {
    renderWith()
    expect(within(inspector()).getByText('Comportamiento')).toBeTruthy()
    expect(within(inspector()).getByText('Por defecto')).toBeTruthy()
    setBehavior('s1', '# solo un comentario\n')
    expect(within(inspector()).getByText('Por defecto')).toBeTruthy()
    setBehavior('s1', VALID)
    expect(within(inspector()).getByText('1 handler')).toBeTruthy()
    setBehavior('s1', `${VALID}\non event:\n  reply 200\n`)
    expect(within(inspector()).getByText('2 handlers')).toBeTruthy()
    setBehavior('s1', INVALID)
    expect(within(inspector()).getByText('⚠ 1 error')).toBeTruthy()
    // Renaming the target breaks a valid DSL (Review Focus 3).
    setBehavior('s1', VALID)
    act(() => useEditor.getState().updateNodeConfig('db1', { name: 'BD' }))
    expect(within(inspector()).getByText('⚠ 1 error')).toBeTruthy()
  })
})

describe('behavior editor popup', () => {
  it('opens from the inspector, edits, and Guardar saves as exactly one undo step', () => {
    renderWith()
    // A quick edit of another field just before must not merge with the save.
    act(() => useEditor.getState().updateNodeConfig('s1', { name: 'Órdenes' }))
    const before = useEditor.getState().past.length
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    const dialog = screen.getByRole('dialog', { name: 'Comportamiento — Órdenes' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(textarea())
    expect(document.querySelector('.app')!.hasAttribute('inert')).toBe(true)
    fireEvent.change(textarea(), { target: { value: VALID } })
    expect(within(dialog).getByText('Sin errores')).toBeTruthy()
    expect(svc().config.behavior).toBe('') // nothing saved while typing
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.app')!.hasAttribute('inert')).toBe(false)
    expect(svc().config.behavior).toBe(VALID)
    expect(useEditor.getState().past.length).toBe(before + 1)
    expect(within(inspector()).getByText('1 handler')).toBeTruthy()
    act(() => useEditor.getState().undo())
    expect(svc().config.behavior).toBe('')
    expect(svc().config.name).toBe('Órdenes')
  })

  it('two saves in a row are two undo steps', () => {
    renderWith()
    const before = useEditor.getState().past.length
    for (const text of [VALID, INVALID]) {
      fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
      fireEvent.change(textarea(), { target: { value: text } })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    }
    expect(useEditor.getState().past.length).toBe(before + 2)
    act(() => useEditor.getState().undo())
    expect(svc().config.behavior).toBe(VALID)
  })

  it('an invalid line shows "línea N" with the translated message, live; it can still be saved', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    fireEvent.change(textarea(), { target: { value: INVALID } })
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('línea 2: "Pagos" no está conectado')).toBeTruthy()
    fireEvent.change(textarea(), { target: { value: 'on request:\n  call Base de datos /x\n' } })
    expect(within(dialog).getByText('línea 2: call no va con "Base de datos" (Base de datos); ¿quisiste decir query?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(svc().config.behavior).toBe('on request:\n  call Base de datos /x\n')
  })

  it('Esc cancels without saving and focus returns to the button', () => {
    renderWith()
    const before = useEditor.getState().past.length
    const btn = within(inspector()).getByRole('button', { name: 'Editar comportamiento' })
    btn.focus()
    fireEvent.click(btn)
    fireEvent.change(textarea(), { target: { value: VALID } })
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(svc().config.behavior).toBe('')
    expect(useEditor.getState().past.length).toBe(before)
    expect(document.activeElement).toBe(btn)
  })

  it('Cancelar also discards the changes', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    fireEvent.change(textarea(), { target: { value: VALID } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(svc().config.behavior).toBe('')
  })

  it('Tab indents, Shift+Tab dedents and Enter keeps the indentation; app shortcuts do not fire', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    const ta = textarea()
    fireEvent.change(ta, { target: { value: 'on request:' } })
    ta.setSelectionRange(11, 11)
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(ta.value).toBe('on request:\n  ')
    expect(ta.selectionStart).toBe(14)
    fireEvent.keyDown(ta, { key: 'Tab' })
    expect(ta.value).toBe('on request:\n    ')
    fireEvent.keyDown(ta, { key: 'Tab', shiftKey: true })
    expect(ta.value).toBe('on request:\n  ')
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    // Delete must not remove the selected node behind the dialog.
    fireEvent.keyDown(ta, { key: 'Delete' })
    expect(svc()).toBeTruthy()
  })

  it('"Insertar ejemplo" fills the template for the component type, then appends', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    const example = behaviorExample('es', 'service')
    fireEvent.click(screen.getByRole('button', { name: 'Insertar ejemplo' }))
    expect(textarea().value).toBe(example)
    fireEvent.click(screen.getByRole('button', { name: 'Insertar ejemplo' }))
    expect(textarea().value).toBe(`${example}\n${example}`)
    act(() => useBehaviorEditor.getState().close())
    act(() => useEditor.getState().select({ kind: 'node', id: 'w1' }))
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    fireEvent.change(textarea(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insertar ejemplo' }))
    expect(textarea().value).toBe(behaviorExample('es', 'worker'))
  })

  it('shows the reference with the keywords and the example', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Referencia del DSL')).toBeTruthy()
    expect(within(dialog).getByText('call Destino /path')).toBeTruthy()
    expect(within(dialog).getByText(/on request \/ordenes:/)).toBeTruthy()
  })

  it('numbers the lines in the gutter', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Editar comportamiento' }))
    fireEvent.change(textarea(), { target: { value: 'a\nb\nc' } })
    expect(document.querySelectorAll('.dsl-gutter > span')).toHaveLength(3)
  })

  it('in English shows the English texts and messages', () => {
    act(() => useLang.getState().setLang('en'))
    renderWith()
    expect(within(inspector()).getByText('Default')).toBeTruthy()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Edit behavior' }))
    const dialog = screen.getByRole('dialog', { name: 'Behavior — Svc' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Behavior code' }), { target: { value: INVALID } })
    expect(within(dialog).getByText('line 2: "Pagos" is not connected')).toBeTruthy()
    expect(within(dialog).getByText('DSL reference')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Insert example' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(inspector()).getByText('⚠ 1 error')).toBeTruthy()
  })
})

describe('DSL badge on the node', () => {
  it('shows "DSL" for an active behavior, "⚠ DSL" with errors, nothing by default', () => {
    renderWith()
    const badge = (id: string) => document.querySelector(`.react-flow__node[data-id="${id}"] .node-dsl`)
    expect(badge('s1')).toBeNull()
    expect(badge('w1')!.textContent).toBe('DSL')
    expect(badge('w1')!.classList.contains('error')).toBe(false)
    expect(badge('w2')!.textContent).toBe('⚠ DSL')
    expect(badge('w2')!.classList.contains('error')).toBe(true)
    setBehavior('s1', INVALID)
    expect(badge('s1')!.textContent).toBe('⚠ DSL')
    setBehavior('s1', VALID)
    expect(badge('s1')!.textContent).toBe('DSL')
    // Disconnecting the target flips it to an error.
    act(() => useEditor.getState().removeElements(['e2']))
    expect(badge('s1')!.textContent).toBe('⚠ DSL')
  })
})

describe('info panel', () => {
  it('the Servicio info mentions the behavior and includes the DSL reference', () => {
    renderWith()
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Cómo funciona Servicio' }))
    const dialog = screen.getByRole('dialog', { name: 'Servicio' })
    expect(within(dialog).getAllByText(/Comportamiento/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText('Referencia del DSL')).toBeTruthy()
  })
})
