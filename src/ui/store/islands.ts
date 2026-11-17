import { create } from 'zustand'

/** The islands the user can drag around the canvas. */
export type IslandId = 'palette' | 'inspector' | 'guide'
/** How far an island was dragged from its place in the layout, in px. */
export type Offset = { x: number; y: number }
type Offsets = Partial<Record<IslandId, Offset>>

/** localStorage key remembering where each island was dragged to. */
export const ISLANDS_STORAGE_KEY = 'nodarium:islands'

const isOffset = (v: unknown): v is Offset =>
  typeof v === 'object' && v !== null && Number.isFinite((v as Offset).x) && Number.isFinite((v as Offset).y)

function readOffsets(): Offsets {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ISLANDS_STORAGE_KEY) ?? '{}')
    if (typeof raw !== 'object' || raw === null) return {}
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => isOffset(v))) as Offsets
  } catch {
    return {} /* storage unavailable or corrupt */
  }
}

function saveOffsets(offsets: Offsets) {
  try {
    localStorage.setItem(ISLANDS_STORAGE_KEY, JSON.stringify(offsets))
  } catch {
    /* storage unavailable: positions last until reload */
  }
}

type IslandsState = {
  offsets: Offsets
  /** The island dragged last, drawn above the others. */
  front: IslandId | null
  /** Moves an island; `persist` once the drag ends, not on every pointer move. */
  move: (id: IslandId, offset: Offset, persist?: boolean) => void
  raise: (id: IslandId) => void
  /** Back to its place in the layout. */
  reset: (id: IslandId) => void
}

export const useIslands = create<IslandsState>((set, get) => ({
  offsets: readOffsets(),
  front: null,
  move: (id, offset, persist = false) => {
    const offsets = { ...get().offsets, [id]: offset }
    set({ offsets })
    if (persist) saveOffsets(offsets)
  },
  raise: (id) => set({ front: id }),
  reset: (id) => {
    const { [id]: _, ...offsets } = get().offsets
    set({ offsets })
    saveOffsets(offsets)
  },
}))
