import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape } from './helpers'

/** How many product paths the client mixes: twice the Cache's capacity, so LRU evictions show. */
const PRODUCTS = 10

/**
 * Cache-aside (cache-spec §7): a plain Servicio asks a leaf Cache (real keys, capacity 5) for each
 * product; on a MISS it reads the Base de datos and stores the key. 10 products over 5 keys shows the
 * warm-up, evictions and the database load; raising the capacity to 10 almost idles the database.
 */
export function cachePreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'cache')
  const mix = Array.from({ length: PRODUCTS }, (_, i) => ({ value: text('path', { n: i + 1 }), weight: 1 }))
  return {
    id: 'cache',
    name,
    description,
    demoRates: { client: 5 },
    graph: {
      nodes: [
        node('client', 'client', 0, 0.5 * ROW, text('nodes.client'), { rate: 0, mix, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        // Headroom: the Servicio never saturates, so the database is what the cache relieves.
        node('service', 'service', 1, 0.5 * ROW, text('nodes.service'), { processingTime: 100, capacity: 20, queueMax: 50 }),
        node('cache', 'cache', 2, 0, text('nodes.cache'), { mode: 'keys', capacity: 5 }),
        // A small database: with capacity 5 its queue shows, with 10 it is relieved.
        node('db', 'database', 2, ROW, text('nodes.db'), { kind: 'relational', capacity: 2, queueMax: 20 }),
      ],
      edges: [edge('client', 'service'), edge('service', 'cache'), edge('service', 'db')],
    },
  }
}
