import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape } from './helpers'

export function syncVsQueuePreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'sync-vs-queue')
  const worker = (n: number) => text('nodes.worker', { n })
  return {
    id: 'sync-vs-queue',
    name,
    description,
    graph: {
      nodes: [
        node('client-sync', 'client', 0, 0, text('nodes.clientSync'), { rate: 4, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        node('service', 'service', 1, 0, text('nodes.service'), { capacity: 2, processingTime: 1500 }),
        node('client-queue', 'client', 0, 2 * ROW, text('nodes.clientQueue'), { rate: 4, ip: '10.0.0.2', color: CLIENT_COLORS[1] }),
        // 200 so the queue absorbs the 30 s demo (rate 4 vs 3 workers at 1 msg / 1.5 s) without overflowing.
        node('cola', 'queue', 1, 2 * ROW, text('nodes.queue'), { queueMax: 200 }),
        node('worker-1', 'worker', 2, 1.5 * ROW, worker(1), { capacity: 1, processingTime: 1500 }),
        node('worker-2', 'worker', 2, 2.5 * ROW, worker(2), { capacity: 1, processingTime: 1500 }),
        node('worker-3', 'worker', 2, 3.5 * ROW, worker(3), { capacity: 1, processingTime: 1500 }),
        node('dlq', 'dlq', 2, 4.5 * ROW, text('nodes.dlq')),
      ],
      edges: [
        edge('client-sync', 'service'),
        edge('client-queue', 'cola'),
        edge('cola', 'worker-1'),
        edge('cola', 'worker-2'),
        edge('cola', 'worker-3'),
        edge('cola', 'dlq'),
      ],
    },
  }
}
