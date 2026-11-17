import { create } from 'zustand'

export const SCENARIO_STORAGE_KEY = 'nodarium:scenario'
export const GUIDE_STORAGE_KEY = 'nodarium:guide'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the guide just forgets across reloads */
  }
}

export interface ScenarioState {
  /** Preset the current graph came from (its guide is shown), or null for a graph of the user's own. */
  currentId: string | null
  /** Whether the "How it works" guide is shown (when there is a current scenario). */
  guideOpen: boolean
  /** Whether the scenario picker is open. */
  pickerOpen: boolean
  /** Element that opened the picker; the dialog returns focus to it on close. */
  opener: HTMLElement | null
  setCurrent(id: string | null): void
  setGuideOpen(open: boolean): void
  openPicker(opener?: HTMLElement | null): void
  closePicker(): void
}

/** The scenario and the guide survive a reload, like the graph they belong to. */
export const useScenario = create<ScenarioState>((set, get) => ({
  currentId: read(SCENARIO_STORAGE_KEY),
  guideOpen: read(GUIDE_STORAGE_KEY) !== 'closed',
  pickerOpen: false,
  opener: null,
  setCurrent(id) {
    write(SCENARIO_STORAGE_KEY, id)
    set({ currentId: id })
  },
  setGuideOpen(open) {
    write(GUIDE_STORAGE_KEY, open ? null : 'closed')
    set({ guideOpen: open })
  },
  openPicker(opener = null) {
    set({ pickerOpen: true, opener })
  },
  closePicker() {
    if (!get().pickerOpen) return
    set({ pickerOpen: false, opener: null })
  },
}))
