// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Modal } from '../../src/ui/Modal'

afterEach(cleanup)

function renderModal() {
  const first = createRef<HTMLButtonElement>()
  render(
    <Modal labelledBy="t" className="info-panel" onClose={() => {}} opener={null} initialFocus={first}>
      <h2 id="t">T</h2>
      <button ref={first}>first</button>
      <details>
        <summary>more</summary>
        <a href="#x">inside closed details</a>
        <details open>
          <summary>nested summary</summary>
          <button>nested in closed</button>
        </details>
      </details>
      <div hidden>
        <button>hidden</button>
      </div>
      <div style={{ display: 'none' }}>
        <button>display none</button>
      </div>
      <button style={{ visibility: 'hidden' }}>invisible</button>
      <details open>
        <summary>open</summary>
        <button>inside open details</button>
      </details>
      <button>last</button>
    </Modal>,
  )
}

const cycle = (n: number, shiftKey = false) => {
  const seen: string[] = []
  for (let i = 0; i < n; i++) {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })
    seen.push((document.activeElement as HTMLElement).textContent ?? '')
  }
  return seen
}

describe('Modal focus cycle', () => {
  it('skips elements inside a closed <details> (but not its summary), hidden and display:none ones', () => {
    renderModal()
    expect(document.activeElement).toBe(screen.getByText('first'))
    expect(cycle(6)).toEqual(['more', 'open', 'inside open details', 'last', 'first', 'more'])
  })

  it('Shift+Tab walks the same items backwards', () => {
    renderModal()
    expect(cycle(5, true)).toEqual(['last', 'inside open details', 'open', 'more', 'first'])
  })

  it('opening the details makes its content reachable', () => {
    renderModal()
    ;(screen.getByText('more').parentElement as HTMLDetailsElement).open = true
    expect(cycle(5)).toEqual(['more', 'inside closed details', 'nested summary', 'nested in closed', 'open'])
  })
})
