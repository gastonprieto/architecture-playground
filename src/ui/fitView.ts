import type { FitViewOptions } from '@xyflow/react'

export const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.15 }

/**
 * fitView options that keep the graph clear of the scenario guide floating over the canvas: beside it
 * on a wide screen (the guide is 320px wide at 12px from the edge), above it on a phone (it takes up
 * to half the canvas height at the bottom).
 */
export function fitViewOptions(guideShown: boolean, mobile: boolean): FitViewOptions {
  if (!guideShown) return FIT_VIEW_OPTIONS
  return mobile ? { padding: { top: '24px', x: '24px', bottom: '55%' } } : { padding: { left: '356px', right: '40px', y: '40px' } }
}
