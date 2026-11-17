import { create } from 'zustand'

export interface NewDiagramState {
  /** Whether the "start a new diagram?" confirmation is open. */
  open: boolean
  /** Element that opened the dialog; focus returns to it on close. */
  opener: HTMLElement | null
  /** What a confirmation runs (empties the canvas); set by whoever asks. */
  onConfirm: (() => void) | null
  ask(opener: HTMLElement | null, onConfirm: () => void): void
  close(): void
}

export const useNewDiagram = create<NewDiagramState>((set) => ({
  open: false,
  opener: null,
  onConfirm: null,
  ask(opener, onConfirm) {
    set({ open: true, opener, onConfirm })
  },
  close() {
    set({ open: false, opener: null, onConfirm: null })
  },
}))
