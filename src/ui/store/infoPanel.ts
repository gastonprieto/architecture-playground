import { create } from 'zustand'

export interface InfoPanelState {
  /** Component type whose info is open, or null when the panel is closed. */
  type: string | null
  /** Element that opened the panel; the dialog returns focus to it on close. */
  opener: HTMLElement | null
  open(type: string, opener?: HTMLElement | null): void
  close(): void
}

export const useInfoPanel = create<InfoPanelState>((set, get) => ({
  type: null,
  opener: null,
  open(type, opener = null) {
    set({ type, opener })
  },
  close() {
    if (get().type === null) return
    // The dialog gives focus back to the opener when it unmounts (after the app stops being inert).
    set({ type: null, opener: null })
  },
}))
