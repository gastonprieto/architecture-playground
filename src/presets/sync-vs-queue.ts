import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape, START_RATE } from './helpers'

/** Shared by both: the same traffic and the same 1.5 s of work per request, so their metrics compare. */
const DEMO_RATE = 4
const WORK_MS = 1500

/** A synchronous service: the client waits, and once the service is full it answers 503. */
export function syncPreset(lang: Lang): PresetShape {
  const { text, guide } = presetText(lang, 'sync', 'sync-vs-queue')
  return {
    id: 'sync',
    ...guide,
    demoRates: { 'client-sync': DEMO_RATE },
    graph: {
      nodes: [
        node('client-sync', 'client', 0, 0, text('nodes.client'), { rate: START_RATE, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        node('service', 'service', 1, 0, text('nodes.service'), { capacity: 2, processingTime: WORK_MS }),
      ],
      edges: [edge('client-sync', 'service')],
    },
  }
}

/** A queue with three workers: the client gets 202 at once and the workers drain the queue at their pace. */
export function queuePreset(lang: Lang): PresetShape {
  const { text, guide } = presetText(lang, 'queue', 'sync-vs-queue')
  const worker = (n: number) => text('nodes.worker', { n })
  return {
    id: 'queue',
    ...guide,
    demoRates: { 'client-queue': DEMO_RATE },
    graph: {
      nodes: [
        node('client-queue', 'client', 0, 1.5 * ROW, text('nodes.client'), { rate: START_RATE, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        // 200 so the queue absorbs the 30 s demo (rate 4 vs 3 workers at 1 msg / 1.5 s) without overflowing.
        node('cola', 'queue', 1, 1.5 * ROW, text('nodes.queue'), { queueMax: 200 }),
        node('worker-1', 'worker', 2, 0, worker(1), { capacity: 1, processingTime: WORK_MS }),
        node('worker-2', 'worker', 2, ROW, worker(2), { capacity: 1, processingTime: WORK_MS }),
        node('worker-3', 'worker', 2, 2 * ROW, worker(3), { capacity: 1, processingTime: WORK_MS }),
        node('dlq', 'dlq', 2, 3 * ROW, text('nodes.dlq')),
      ],
      edges: [
        edge('client-queue', 'cola'),
        edge('cola', 'worker-1'),
        edge('cola', 'worker-2'),
        edge('cola', 'worker-3'),
        edge('cola', 'dlq'),
      ],
    },
  }
}
