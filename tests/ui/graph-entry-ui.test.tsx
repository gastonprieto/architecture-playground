// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Graph } from '../../src/engine/types'
import { useLang } from '../../src/i18n'
import { encodeHash } from '../../src/persistence/hash'
import { serializeGraph } from '../../src/persistence/serialize'
import { STORAGE_KEY } from '../../src/persistence/storage'
import App from '../../src/ui/App'
import { useEditor } from '../../src/ui/store/editor'

/** An old graph: a Reverse Proxy with the removed "Rechazo auth" and "Cache hit" fields, and a Cache without mode. */
const legacy: Graph = {
  nodes: [
    { id: 'C', type: 'client', position: { x: 0, y: 0 }, config: { name: 'C' } },
    { id: 'P', type: 'reverse-proxy', position: { x: 200, y: 0 }, config: { name: 'P', authFailRate: 0.25, cacheHitRate: 0.4 } },
    { id: 'K', type: 'cache', position: { x: 400, y: 0 }, config: { name: 'K', hitRate: 0.6 } },
  ],
  edges: [{ id: 'C-P', source: 'C', target: 'P' }],
}

vi.mock('../../src/presets', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/presets')>()
  return {
    ...mod,
    getPresets: (lang: Parameters<typeof mod.getPresets>[0]) => [
      ...mod.getPresets(lang),
      { id: 'legacy', name: 'Legacy', description: '', demoRates: {}, graph: legacy },
    ],
  }
})

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
  localStorage.clear()
  history.replaceState(null, '', location.pathname)
})

const proxyConfig = () => useEditor.getState().graph.nodes.find((n) => n.id === 'P')?.config
const migrated = () => {
  const c = proxyConfig()!
  expect(c.auth).toBe('credentials')
  expect('authFailRate' in c).toBe(false)
  // Cache spec §5 and §2.2 run on the same path.
  expect([c.cache, c.hitRate, c.cacheablePaths, 'cacheHitRate' in c]).toEqual(['random', 0.4, [], false])
  expect(useEditor.getState().graph.nodes.find((n) => n.id === 'K')!.config).toMatchObject({ mode: 'random', hitRate: 0.6 })
  // The client backfill still runs on the same path.
  expect(useEditor.getState().graph.nodes.find((n) => n.id === 'C')!.config.ip).toBe('10.0.0.1')
}

describe('authFailRate / cacheHitRate / Cache mode migration at every graph entry', () => {
  it('boot from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, serializeGraph(legacy))
    render(<App />)
    migrated()
  })

  it('boot from a shared link (URL hash)', () => {
    history.replaceState(null, '', location.pathname + encodeHash(legacy))
    render(<App />)
    migrated()
    expect(location.hash).toBe('')
  })

  it('import a file', async () => {
    render(<App />)
    expect(proxyConfig()).toBeUndefined()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([serializeGraph(legacy)], 'old.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(proxyConfig()).toBeDefined())
    migrated()
  })

  it('choose a preset', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Presets' }), { target: { value: 'legacy' } })
    migrated()
  })
})
