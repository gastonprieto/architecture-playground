import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape } from './helpers'

export function pubsubPreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'pubsub')
  return {
    id: 'pubsub',
    name,
    description,
    // Clients start idle (0 req/s); these are the rates the demo is tuned for.
    demoRates: { ordenes: 1 },
    graph: {
      nodes: [
        node('ordenes', 'client', 0, 1.5 * ROW, text('nodes.orders'), {
          ip: '10.0.0.1',
          color: CLIENT_COLORS[2],
          kind: 'event',
          rate: 0,
          mix: [{ value: text('eventType'), weight: 1 }],
        }),
        node('broker', 'broker', 1, 1.5 * ROW, text('nodes.broker')),
        node('facturacion', 'subscriber', 2, 0, text('nodes.billing')),
        node('stock', 'subscriber', 2, ROW, text('nodes.stock')),
        node('mails', 'subscriber', 2, 2 * ROW, text('nodes.mails')),
        node('analytics', 'subscriber', 2, 3 * ROW, text('nodes.analytics'), { processingTime: 2500 }),
      ],
      edges: [
        edge('ordenes', 'broker'),
        edge('broker', 'facturacion'),
        edge('broker', 'stock'),
        edge('broker', 'mails'),
        edge('broker', 'analytics'),
      ],
    },
  }
}
