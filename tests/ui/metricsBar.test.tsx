// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Graph } from '../../src/engine/types'
import { useLang } from '../../src/i18n'
import { MetricsBar } from '../../src/ui/MetricsBar'
import { useRuntime } from '../../src/ui/runtime/runtimeStore'
import { useEditor } from '../../src/ui/store/editor'

const ZERO = { throughput: 0, p50: 0, p95: 0, errorRate: 0 }
const clientGraph = (rate: number, up = true): Graph => ({
  nodes: [{ id: 'c', type: 'client', position: { x: 0, y: 0 }, config: { name: 'C', rate, up } }],
  edges: [],
})
const bar = () => screen.getByLabelText('Métricas')

beforeEach(() => {
  useLang.getState().setLang('es')
  useRuntime.setState({ playing: true, metrics: ZERO })
  useEditor.getState().loadGraph(clientGraph(1))
})
afterEach(cleanup)

describe('MetricsBar', () => {
  it('while playing with traffic on the way and no response back yet, says it is waiting instead of showing zeros', () => {
    render(<MetricsBar />)
    expect(bar().textContent).toContain('esperando respuestas…')
    expect(bar().textContent).not.toMatch(/\b0\.0\b/)
    act(() => useRuntime.setState({ metrics: { throughput: 0.8, p50: 4300, p95: 4300, errorRate: 0 } }))
    expect(bar().textContent).not.toContain('esperando respuestas…')
    expect(bar().textContent).toContain('0.8')
    expect(bar().textContent).toContain('4300')
  })

  it('shows the zeros when nothing is coming: paused, or every client idle or off', () => {
    useRuntime.setState({ playing: false })
    const { rerender } = render(<MetricsBar />)
    expect(bar().textContent).toContain('0.0')
    act(() => {
      useRuntime.setState({ playing: true })
      useEditor.getState().loadGraph(clientGraph(0))
    })
    rerender(<MetricsBar />)
    expect(bar().textContent).not.toContain('esperando respuestas…')
    act(() => useEditor.getState().loadGraph(clientGraph(5, false)))
    expect(bar().textContent).not.toContain('esperando respuestas…')
  })
})
