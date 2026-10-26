import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape, START_RATE } from './helpers'

export function loadBalancerPreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'load-balancer')
  const server = (n: number) => text('nodes.server', { n })
  return {
    id: 'load-balancer',
    name,
    description,
    // Clients start at START_RATE; these are the rates the demo is tuned for.
    demoRates: { web: 3, mobile: 3 },
    graph: {
      nodes: [
        // With ip-hash these two IPs land on different servers (10.0.0.1 → Servidor 3, 10.0.0.2 → Servidor 1).
        node('web', 'client', 0, 0.5 * ROW, text('nodes.web'), { rate: START_RATE, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        node('mobile', 'client', 0, 2.5 * ROW, text('nodes.mobile'), { rate: START_RATE, ip: '10.0.0.2', color: CLIENT_COLORS[1] }),
        node('lb', 'load-balancer', 1, 1.5 * ROW, text('nodes.lb'), { algorithm: 'round-robin' }),
        node('srv-1', 'service', 2, 0, server(1)),
        node('srv-2', 'service', 2, 1.5 * ROW, server(2)),
        node('srv-3', 'service', 2, 3 * ROW, server(3)),
        node('db', 'database', 3, 1.5 * ROW, text('nodes.db')),
      ],
      edges: [
        edge('web', 'lb'),
        edge('mobile', 'lb'),
        edge('lb', 'srv-1'),
        edge('lb', 'srv-2'),
        edge('lb', 'srv-3'),
        edge('srv-1', 'db'),
        edge('srv-2', 'db'),
        edge('srv-3', 'db'),
      ],
    },
  }
}
