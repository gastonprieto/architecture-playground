// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../src/i18n'
import App from '../../src/ui/App'
import { useRuntime } from '../../src/ui/runtime/runtimeStore'
import { useEditor } from '../../src/ui/store/editor'
import { useInspectorTab } from '../../src/ui/store/inspectorTab'
import { useScenario } from '../../src/ui/store/scenario'
import { TOUR_STORAGE_KEY, useTour } from '../../src/ui/store/tour'
import { openToolbarMenu } from './toolbarMenu'

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
  useLang.getState().setLang('es')
  useRuntime.setState({ playing: false })
  useScenario.setState({ pickerOpen: false, opener: null })
  useInspectorTab.getState().setTab('status')
  // A first visit: the tutorial opens on its first step.
  useTour.setState({ step: 0 })
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

// jsdom has no Popover API, so the card stays `display: none` there: it is looked up in the DOM
// (in a browser, showPopover() puts it in the top layer).
const card = () => document.querySelector<HTMLElement>('.tour-step')
const title = () => card()?.querySelector('h2')?.textContent
const tourButton = (name: string) => screen.getByRole('button', { name, hidden: true })
/** Waits longer than the check mark an action step shows before moving on. */
const afterCheck = () => act(() => new Promise((r) => setTimeout(r, 800)))

describe('tutorial', () => {
  it('opens on a first visit, hides the scenario guide meanwhile, and shows it again when skipped', () => {
    render(<App />)
    expect(title()).toBe('Bienvenido a Nodarium')
    expect(screen.getByLabelText('Paso 1 de 7')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: 'Cómo funciona' })).toBeNull()
    fireEvent.click(tourButton('Saltar tutorial'))
    expect(card()).toBeNull()
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done')
    expect(screen.getByRole('complementary', { name: 'Cómo funciona' })).toBeTruthy()
  })

  it('dims the page around the step, whose targets are marked in the app', () => {
    render(<App />)
    fireEvent.click(tourButton('Empezar'))
    expect(title()).toBe('Agregá un componente')
    expect(card()!.dataset.step).toBe('add')
    expect(document.querySelector('[data-tour="palette"]')).toBeTruthy()
    expect(document.querySelector('.tour-spotlight')).toBeTruthy()
  })

  it('action steps advance by themselves once the user does what they ask', async () => {
    render(<App />)
    fireEvent.click(tourButton('Empezar'))
    expect(screen.getByText('Tu turno')).toBeTruthy()

    let id = ''
    act(() => void (id = useEditor.getState().addNode('service', { x: 0, y: 0 })))
    expect(screen.getByText('¡Listo!')).toBeTruthy()
    await afterCheck()
    expect(title()).toBe('Conectalo')

    const other = useEditor.getState().graph.nodes.find((n) => n.id !== id)!.id
    act(() => void useEditor.getState().connect(other, id))
    await afterCheck()
    expect(title()).toBe('Ajustá su comportamiento')
    // The values to change are on the inspector's Configuración tab: the step opens it there.
    expect(useInspectorTab.getState().tab).toBe('config')

    act(() => useEditor.getState().updateNodeConfig(id, { capacity: 3 }))
    await afterCheck()
    expect(title()).toBe('Dale Play')

    fireEvent.click(screen.getByRole('button', { name: /Play/ }))
    await afterCheck()
    expect(title()).toBe('Mirá los números')
  })

  it('"Omitir paso" moves on without doing the action', () => {
    render(<App />)
    fireEvent.click(tourButton('Empezar'))
    fireEvent.click(tourButton('Omitir paso'))
    expect(title()).toBe('Conectalo')
  })

  it('opening the scenario picker on the last step finishes the tutorial', () => {
    render(<App />)
    act(() => useTour.getState().go(6))
    expect(title()).toBe('Explorá escenarios')
    fireEvent.click(screen.getByRole('button', { name: /^Escenarios/ }))
    expect(useTour.getState().step).toBeNull()
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done')
  })

  it('hides while a dialog is open and keeps its step', () => {
    render(<App />)
    act(() => useTour.getState().go(2))
    act(() => useScenario.getState().openPicker())
    expect(document.querySelector('.tour-step')).toBeNull()
    act(() => useScenario.getState().closePicker())
    expect(title()).toBe('Conectalo')
  })

  it('Esc on the card closes it, and the ⋯ menu starts it again', () => {
    render(<App />)
    fireEvent.keyDown(card()!, { key: 'Escape' })
    expect(card()).toBeNull()
    openToolbarMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Tutorial' }))
    expect(title()).toBe('Bienvenido a Nodarium')
  })
})
