import { CLIENT_COLORS } from '../components/client'
import { DB_KIND_DEFAULTS } from '../components/database'
import type { Lang } from '../i18n'
import { edge, node, presetText, ref, ROW, type PresetShape, START_RATE } from './helpers'

const LANES = ['mem', 'store', 'jwt'] as const
type Lane = (typeof LANES)[number]

const PRESET_IDS: Record<Lane, string> = { mem: 'sessions-memory', store: 'sessions-store', jwt: 'sessions-jwt' }

/**
 * Where the session lives (docs/sessions-spec.md §10), one preset per place. Each is a client of 5
 * logged-in users behind a round-robin LB without sticky, over 3 servers. 5 users do not divide 3
 * servers, so each user lands on a different server every time: memory sessions get lost (401 and
 * re-login), a shared key-value store and JWT do not care. The three share layout, ids and traffic,
 * so their metrics compare.
 */
function sessionsPreset(lang: Lang, lane: Lane): PresetShape {
  const { text, guide } = presetText(lang, PRESET_IDS[lane], 'sessions')
  const store = text('nodes.store')
  const dsl: Record<Lane, string> = {
    mem: 'on request:\n  session memory\n',
    store: `on request:\n  session ${ref(store)}\n`,
    jwt: 'on request:\n  session jwt\n',
  }
  const servers = [1, 2, 3]
  return {
    id: PRESET_IDS[lane],
    ...guide,
    // Clients start at START_RATE. At 1 req/s each of the 5 users sends every 5 s, after the cookie of its
    // login came back even with the store (~4 s round trip with the database), so the store ends up with
    // exactly one session per user.
    demoRates: { [`client-${lane}`]: 1 },
    graph: {
      nodes: [
        node(`client-${lane}`, 'client', 0, ROW, text('nodes.client'), {
          rate: START_RATE,
          users: 5,
          auth: 'login',
          ip: '10.0.0.1',
          color: CLIENT_COLORS[0],
        }),
        node(`lb-${lane}`, 'load-balancer', 1, ROW, text('nodes.lb'), {
          algorithm: 'round-robin',
          sticky: false,
          // With sticky on and a server off, its users get one 401 and log in elsewhere (not endless 503s).
          healthChecks: true,
        }),
        ...servers.map((n) =>
          node(`${lane}-${n}`, 'service', 2, (n - 1) * ROW, text('nodes.server', { n }), { capacity: 4, behavior: dsl[lane] }),
        ),
        ...(lane === 'store'
          ? [
              node('sessions-db', 'database', 3, ROW, store, {
                kind: 'key-value',
                processingTime: DB_KIND_DEFAULTS['key-value'].processingTime,
                capacity: 4,
              }),
            ]
          : []),
      ],
      edges: [
        edge(`client-${lane}`, `lb-${lane}`),
        ...servers.map((n) => edge(`lb-${lane}`, `${lane}-${n}`)),
        ...(lane === 'store' ? servers.map((n) => edge(`store-${n}`, 'sessions-db')) : []),
      ],
    },
  }
}

export const sessionsPresets = (lang: Lang): PresetShape[] => LANES.map((lane) => sessionsPreset(lang, lane))
