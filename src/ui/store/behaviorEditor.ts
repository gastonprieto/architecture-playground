import { create } from 'zustand'
import type { NodeId } from '../../engine/types'

export interface BehaviorEditorState {
  /** Node whose behavior is being edited, or null when the editor is closed. */
  nodeId: NodeId | null
  /** Element that opened the editor; focus returns to it on close. */
  opener: HTMLElement | null
  open(nodeId: NodeId, opener?: HTMLElement | null): void
  close(): void
}

export const useBehaviorEditor = create<BehaviorEditorState>((set, get) => ({
  nodeId: null,
  opener: null,
  open(nodeId, opener = null) {
    set({ nodeId, opener })
  },
  close() {
    if (get().nodeId === null) return
    set({ nodeId: null, opener: null })
  },
}))
