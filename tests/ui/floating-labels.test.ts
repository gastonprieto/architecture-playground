import { describe, expect, it } from 'vitest'
import { LabelBook, REPEAT_MS } from '../../src/ui/canvas/labelBook'

describe('LabelBook', () => {
  it('throttles the same text on the same node to one label per REPEAT_MS, counting repeats', () => {
    expect(REPEAT_MS).toBe(450)
    const book = new LabelBook()
    const first = book.add('Q', '202', 0)
    expect(first).toMatchObject({ type: 'new', slot: 0 })
    expect(book.add('Q', '202', 100)).toEqual({ type: 'bump', key: first.key, count: 2 })
    expect(book.add('Q', '202', 300)).toEqual({ type: 'bump', key: first.key, count: 3 })
    // Past the window (measured from when the label was shown) a new label appears.
    expect(book.add('Q', '202', 460)).toMatchObject({ type: 'new' })
  })

  it('a throttled text whose label is already gone starts a new one', () => {
    const book = new LabelBook()
    const first = book.add('Q', '503', 0)
    book.remove(first.key)
    expect(book.add('Q', '503', 100)).toMatchObject({ type: 'new', slot: 0 })
  })

  it('stacks different concurrent texts on a node in distinct slots and reuses freed ones', () => {
    const book = new LabelBook()
    const a = book.add('S', '503', 0)
    const b = book.add('S', 'down', 0)
    const c = book.add('S', 'loop', 0)
    expect([a, b, c].map((x) => (x.type === 'new' ? x.slot : -1))).toEqual([0, 1, 2])
    // Other nodes have their own slots.
    expect(book.add('T', '503', 0)).toMatchObject({ type: 'new', slot: 0 })
    book.remove(b.key)
    expect(book.add('S', 'DLQ', 10)).toMatchObject({ type: 'new', slot: 1 })
  })
})
