import { create } from 'zustand'

export type InspectorTab = 'status' | 'config'

export interface InspectorTabState {
  /** Tab of the node inspector; shared by every node and kept only for the session (not persisted). */
  tab: InspectorTab
  setTab(tab: InspectorTab): void
}

export const useInspectorTab = create<InspectorTabState>((set) => ({
  tab: 'status',
  setTab(tab) {
    set({ tab })
  },
}))
