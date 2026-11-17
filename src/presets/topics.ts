/** Topics of the scenario picker, in order, each with its presets in order. Texts: `topics.<id>`. */
export const TOPICS = [
  { id: 'scaling', presets: ['load-balancer'] },
  { id: 'sessions', presets: ['sessions-memory', 'sessions-store', 'sessions-jwt'] },
  { id: 'async', presets: ['sync', 'queue'] },
  { id: 'integration', presets: ['pubsub', 'orchestration', 'choreography'] },
  { id: 'edge', presets: ['reverse-proxy', 'edge-cache'] },
  { id: 'cache', presets: ['cache'] },
] as const

export type TopicId = (typeof TOPICS)[number]['id']

/** Accent of each topic (a theme color token), for the picker and the guide. */
export const TOPIC_COLORS: Record<TopicId, string> = {
  scaling: 'var(--purple)',
  sessions: 'var(--orange)',
  async: 'var(--yellow)',
  integration: 'var(--pink)',
  edge: 'var(--cyan)',
  cache: 'var(--teal)',
}
