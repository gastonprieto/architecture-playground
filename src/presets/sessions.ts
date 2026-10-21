import { CLIENT_COLORS } from '../components/client'
import { DB_KIND_DEFAULTS } from '../components/database'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape } from './helpers'

const LANES = ['mem', 'store', 'jwt'] as const
type Lane = (typeof LANES)[number]

/** Vertical distance between the lanes' first rows. */
const LANE_GAP = 3.5 * ROW

/** A DSL target: names with spaces are quoted. */
const ref = (name: string) => (/\s/.test(name) ? `"${name}"` : name)

/**
 * Where the session lives (docs/sessions-spec.md §10). Three identical lanes, each a client of 5
 * logged-in users behind a round-robin LB without sticky, over 3 servers. 5 users do not divide 3
 * servers, so each user lands on a different server every time: memory sessions get lost (401 and
 * re-login), a shared key-value store and JWT do not care.
 */
export function sessionsPreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'sessions')
  const store = text('nodes.store')
  const dsl: Record<Lane, string> = {
    mem: 'on request:\n  session memory\n',
    store: `on request:\n  session ${ref(store)}\n`,
    jwt: 'on request:\n  session jwt\n',
  }
  const nodes = LANES.flatMap((lane, i) => {
    const y = i * LANE_GAP
    return [
      node(`client-${lane}`, 'client', 0, y + ROW, text(`nodes.client.${lane}`), {
        rate: 0,
        users: 5,
        auth: 'login',
        ip: `10.0.0.${i + 1}`,
        color: CLIENT_COLORS[i],
      }),
      node(`lb-${lane}`, 'load-balancer', 1, y + ROW, text(`nodes.lb.${lane}`), { algorithm: 'round-robin', sticky: false }),
      ...[1, 2, 3].map((n) =>
        node(`${lane}-${n}`, 'service', 2, y + (n - 1) * ROW, text(`nodes.server.${lane}`, { n }), { capacity: 4, behavior: dsl[lane] }),
      ),
    ]
  })
  return {
    id: 'sessions',
    name,
    description,
    // Clients start idle (0 req/s). At 1.5 req/s a user's next request leaves after its cookie came back.
    demoRates: { 'client-mem': 1.5, 'client-store': 1.5, 'client-jwt': 1.5 },
    graph: {
      nodes: [
        ...nodes,
        node('sessions-db', 'database', 3, LANE_GAP + ROW, store, {
          kind: 'key-value',
          processingTime: DB_KIND_DEFAULTS['key-value'].processingTime,
          capacity: 4,
        }),
      ],
      edges: [
        ...LANES.flatMap((lane) => [edge(`client-${lane}`, `lb-${lane}`), ...[1, 2, 3].map((n) => edge(`lb-${lane}`, `${lane}-${n}`))]),
        ...[1, 2, 3].map((n) => edge(`store-${n}`, 'sessions-db')),
      ],
    },
  }
}
