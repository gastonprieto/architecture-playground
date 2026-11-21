import { create } from 'zustand'

/** localStorage key set once the tutorial was finished or skipped: it then stops opening by itself. */
export const TOUR_STORAGE_KEY = 'nodarium:tour'

const isDone = (): boolean => {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === 'done'
  } catch {
    return false
  }
}

const markDone = () => {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, 'done')
  } catch {
    /* storage unavailable: the tutorial opens again on the next visit */
  }
}

export interface TourState {
  /** Index of the current step, or null when the tutorial is closed. */
  step: number | null
  /** Opens the tutorial on its first step (the `⋯` menu). */
  start(): void
  /** Moves to step `i`. */
  go(i: number): void
  /** Closes the tutorial for good (finished or skipped). */
  finish(): void
}

/** The tutorial opens by itself on the first visit, until it is finished or skipped once. */
export const useTour = create<TourState>((set) => ({
  step: isDone() ? null : 0,
  start() {
    set({ step: 0 })
  },
  go(i) {
    set({ step: i })
  },
  finish() {
    markDone()
    set({ step: null })
  },
}))
