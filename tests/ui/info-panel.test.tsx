// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultRegistry } from '../../src/components/index'
import { defineComponent } from '../../src/engine/registry'
import { useLang } from '../../src/i18n'
import { componentInfo } from '../../src/i18n/componentText'
import App from '../../src/ui/App'
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

const QUEUE_ES = 'Desacopla: acepta el trabajo al toque y se lo pasa a los workers.'
const QUEUE_EN = 'Decouples: accepts the work right away and hands it to the workers.'

describe('component info content', () => {
  it('every registered type has a summary, behavior bullets, a tip and help for each field, in both languages', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const def of defaultRegistry.list()) {
        const info = componentInfo(lang, def)
        expect(info, `${lang}/${def.type}`).toBeDefined()
        expect(info!.summary.length, `${lang}/${def.type} summary`).toBeGreaterThan(10)
        expect(info!.behavior.length, `${lang}/${def.type} behavior`).toBeGreaterThanOrEqual(2)
        expect(info!.tip.length, `${lang}/${def.type} tip`).toBeGreaterThan(10)
        expect(info!.fields.map((f) => f.key)).toEqual(Object.keys(def.config))
        for (const f of info!.fields) expect(f.help, `${lang}/${def.type}.${f.key}`).toBeTruthy()
      }
    }
  })

  it('English and Spanish texts differ (the English is really translated)', () => {
    for (const def of defaultRegistry.list()) expect(componentInfo('en', def)!.summary).not.toBe(componentInfo('es', def)!.summary)
  })

  it('a third-party type without info has none', () => {
    const def = defineComponent({ type: 'x-custom', label: 'Custom', icon: '?', color: 'req', config: {}, initialState: () => ({}), onMessage() {} })
    expect(componentInfo('es', def)).toBeUndefined()
  })
})

describe('info panel', () => {
  it('the palette ⓘ for Cola opens a dialog with the Spanish summary; Esc closes it and focus returns', () => {
    render(<App />)
    const btn = screen.getByRole('button', { name: 'Cómo funciona Cola' })
    // The button is not part of the draggable tile area, so clicking it never starts a drag.
    expect(btn.closest('[draggable="true"]')).toBeNull()
    btn.focus()
    fireEvent.click(btn)
    const dialog = screen.getByRole('dialog', { name: 'Cola' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByText(QUEUE_ES)).toBeTruthy()
    expect(within(dialog).getByText('Reintentos máx.')).toBeTruthy()
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('switching to EN shows the English text', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    fireEvent.click(screen.getByRole('button', { name: 'How Queue works' }))
    const dialog = screen.getByRole('dialog', { name: 'Queue' })
    expect(within(dialog).getByText(QUEUE_EN)).toBeTruthy()
    expect(within(dialog).getByText('Max retries')).toBeTruthy()
  })

  it('the ✕ button and a backdrop click close it', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Cómo funciona Cola' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cómo funciona Cola' }))
    // A click inside the panel keeps it open; one on the backdrop closes it.
    fireEvent.mouseDown(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const backdrop = document.querySelector('.info-backdrop')!
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the inspector header ⓘ opens the panel for the selected node', () => {
    render(<App />)
    const lb = useEditor.getState().graph.nodes.find((n) => n.type === 'load-balancer')!
    act(() => useEditor.getState().select({ kind: 'node', id: lb.id }))
    const inspector = screen.getByRole('complementary', { name: 'Inspector' })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Cómo funciona Load Balancer' }))
    const dialog = screen.getByRole('dialog', { name: 'Load Balancer' })
    expect(within(dialog).getByText('Algoritmo')).toBeTruthy()
    expect(within(dialog).getAllByText('503').length).toBeGreaterThan(0)
  })

  it('a type without info shows its label and "Sin información"', () => {
    render(<App />)
    act(() => useInfoPanel.getState().open('x-custom'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Sin información')).toBeTruthy()
  })
})
