import type { FitViewOptions } from '@xyflow/react'

export const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.15 }

/**
 * fitView options that keep the graph clear of what floats over the canvas.
 *
 * - `guideShown`: the scenario guide (320px wide): beside it on a wide screen, above it on a phone (it
 *   takes up to half the canvas height at the bottom).
 * - `floating`: the playground's full-bleed layout, where the toolbar (top), the palette (196px at the
 *   left, the guide right after it) and the metrics (bottom) are islands over the canvas.
 */
export function fitViewOptions(guideShown: boolean, mobile: boolean, floating = false): FitViewOptions {
  if (floating) {
    if (mobile) return { padding: { top: '72px', x: '24px', bottom: guideShown ? '55%' : '64px' } }
    return { padding: { top: '84px', bottom: '72px', right: '40px', left: guideShown ? '564px' : '232px' } }
  }
  if (!guideShown) return FIT_VIEW_OPTIONS
  return mobile ? { padding: { top: '24px', x: '24px', bottom: '55%' } } : { padding: { left: '356px', right: '40px', y: '40px' } }
}
