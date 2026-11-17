import type { ReactNode } from 'react'

/** Info text with `code` spans (status codes, paths) shown in the mono font. */
export function rich(text: string): ReactNode {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}
