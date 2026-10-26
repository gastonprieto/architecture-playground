import { create } from 'zustand'

export interface GraphTextState {
  /** Text shown in the "Texto" dialog, or null when it is closed. */
  text: string | null
  /** Element that opened the dialog; focus returns to it on close. */
  opener: HTMLElement | null
  show(text: string, opener?: HTMLElement | null): void
  close(): void
}

export const useGraphText = create<GraphTextState>((set, get) => ({
  text: null,
  opener: null,
  show(text, opener = null) {
    set({ text, opener })
  },
  close() {
    if (get().text === null) return
    set({ text: null, opener: null })
  },
}))
