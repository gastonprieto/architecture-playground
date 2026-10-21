import { describe, expect, it } from 'vitest'
import { applyEdit, dslKeyEdit } from '../../src/ui/dslKeys'

/** `|` marks the caret, `[` `]` a selection. Returns the text after the key and the new marks. */
function press(marked: string, key: 'Tab' | 'Enter', shift = false): string | null {
  let text = marked
  let start: number
  let end: number
  if (text.includes('|')) {
    start = end = text.indexOf('|')
    text = text.replace('|', '')
  } else {
    start = text.indexOf('[')
    text = text.replace('[', '')
    end = text.indexOf(']')
    text = text.replace(']', '')
  }
  const edit = dslKeyEdit(text, start, end, key, shift)
  if (!edit) return null
  const out = applyEdit(text, edit)
  return edit.selStart === edit.selEnd
    ? out.slice(0, edit.selStart) + '|' + out.slice(edit.selStart)
    : out.slice(0, edit.selStart) + '[' + out.slice(edit.selStart, edit.selEnd) + ']' + out.slice(edit.selEnd)
}

describe('dslKeyEdit', () => {
  it('Tab inserts two spaces at the caret (replacing a one-line selection)', () => {
    expect(press('on request:\n|query DB', 'Tab')).toBe('on request:\n  |query DB')
    expect(press('ab[cd]ef', 'Tab')).toBe('ab  |ef')
  })

  it('Tab over several lines indents each of them', () => {
    expect(press('on request:\n[query A\ncall B /x]\n', 'Tab')).toBe('on request:\n  [query A\n  call B /x]\n')
  })

  it('Shift+Tab dedents the current line by up to two spaces, wherever the caret is', () => {
    expect(press('on request:\n    query| DB', 'Tab', true)).toBe('on request:\n  query| DB')
    expect(press('x\n query DB|', 'Tab', true)).toBe('x\nquery DB|')
    expect(press('  | query', 'Tab', true)).toBe('| query')
  })

  it('Shift+Tab over several lines dedents each of them', () => {
    expect(press('a:\n  [b\n    c]', 'Tab', true)).toBe('a:\n[b\n  c]')
  })

  it('Shift+Tab on an unindented line changes nothing', () => {
    expect(press('on request:|', 'Tab', true)).toBeNull()
  })

  it('Enter keeps the current indentation', () => {
    expect(press('on request:\n  query DB|', 'Enter')).toBe('on request:\n  query DB\n  |')
    expect(press('x|', 'Enter')).toBe('x\n|')
  })

  it('Enter after a line ending in ":" indents two more spaces (comments ignored)', () => {
    expect(press('on request:|', 'Enter')).toBe('on request:\n  |')
    expect(press('on request:\n  parallel:   # a la vez|', 'Enter')).toBe('on request:\n  parallel:   # a la vez\n    |')
  })

  it('Enter replaces a selection and uses the indentation before the caret', () => {
    expect(press('  query [DB]', 'Enter')).toBe('  query \n  |')
  })
})
