import { track as vercelTrack } from '@vercel/analytics'
import type { BeforeSendEvent } from '@vercel/analytics/react'

/** Usage events sent to Vercel Web Analytics: which options people pick. */
export type UsageEvent =
  | { name: 'preset_selected'; props: { preset: string } }
  | { name: 'component_added'; props: { type: string } }
  | { name: 'speed_changed'; props: { speed: number } }
  | { name: 'lang_changed'; props: { lang: string } }
  | { name: 'theme_changed'; props: { theme: string } }
  | { name: 'graph_exported' }
  | { name: 'graph_imported'; props: { format: string } }
  | { name: 'text_editor_opened' }
  | { name: 'link_copied' }
  | { name: 'shared_link_opened' }
  | { name: 'graph_cleared' }
  | { name: 'tour_started' }
  | { name: 'tour_finished'; props: { step: string } }
  | { name: 'tour_skipped'; props: { step: string } }

/** Never lets analytics break the app (blocked script, non-browser environment). */
export function track(e: UsageEvent): void {
  try {
    vercelTrack(e.name, 'props' in e ? e.props : undefined)
  } catch {
    /* analytics unavailable */
  }
}

/** The shared-link hash holds the whole graph: it must never reach analytics. */
export function stripHash(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: event.url.split('#')[0] }
}
