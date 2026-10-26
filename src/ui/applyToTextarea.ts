import { applyEdit, type TextEdit } from './dslKeys'

/**
 * Put `edit` into the textarea through the browser's editing commands when available, so the
 * textarea's own undo (Ctrl/Cmd+Z) keeps working; otherwise set the text directly.
 */
export function applyToTextarea(ta: HTMLTextAreaElement, edit: TextEdit, setText: (text: string) => void): void {
  const expected = applyEdit(ta.value, edit)
  ta.focus()
  ta.setSelectionRange(edit.from, edit.to)
  let done = false
  try {
    done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.insert)
  } catch {
    done = false
  }
  if (!done || ta.value !== expected) setText(expected)
}
