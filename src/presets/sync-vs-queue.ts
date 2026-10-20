import { edge, node, ROW, type PresetShape } from './helpers'

export const syncVsQueuePreset: PresetShape = {
  id: 'sync-vs-queue',
  name: 'Sync vs cola',
  description: 'El mismo tráfico contra un servicio síncrono (se satura con 503) y contra una cola con workers (responde 202).',
  graph: {
    nodes: [
      node('client-sync', 'client', 0, 0, 'Cliente sync', { rate: 4 }),
      node('service', 'service', 1, 0, 'Servicio', { capacity: 2, processingTime: 1500 }),
      node('client-queue', 'client', 0, 2 * ROW, 'Cliente cola', { rate: 4 }),
      // 200 so the queue absorbs the 30 s demo (rate 4 vs 3 workers at 1 msg / 1.5 s) without overflowing.
      node('cola', 'queue', 1, 2 * ROW, 'Cola', { queueMax: 200 }),
      node('worker-1', 'worker', 2, 1.5 * ROW, 'Worker 1', { capacity: 1, processingTime: 1500 }),
      node('worker-2', 'worker', 2, 2.5 * ROW, 'Worker 2', { capacity: 1, processingTime: 1500 }),
      node('worker-3', 'worker', 2, 3.5 * ROW, 'Worker 3', { capacity: 1, processingTime: 1500 }),
      node('dlq', 'dlq', 2, 4.5 * ROW, 'DLQ'),
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
