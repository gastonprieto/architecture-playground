import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape } from './helpers'

export function loadBalancerPreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'load-balancer')
  const server = (n: number) => text('nodes.server', { n })
  return {
    id: 'load-balancer',
    name,
    description,
    graph: {
      nodes: [
        // With ip-hash these two IPs land on different servers (10.0.0.1 → Servidor 3, 10.0.0.2 → Servidor 1).
        node('web', 'client', 0, 0.5 * ROW, text('nodes.web'), { rate: 3, ip: '10.0.0.1' }),
        node('mobile', 'client', 0, 2.5 * ROW, text('nodes.mobile'), { rate: 3, ip: '10.0.0.2' }),
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
