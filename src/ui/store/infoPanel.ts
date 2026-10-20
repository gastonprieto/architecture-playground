import { create } from 'zustand'

export interface InfoPanelState {
  /** Component type whose info is open, or null when the panel is closed. */
  type: string | null
  /** Element that opened the panel; focus returns to it on close. */
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
    const { type, opener } = get()
    if (type === null) return
    set({ type: null, opener: null })
    if (opener?.isConnected) opener.focus()
  },
}))
