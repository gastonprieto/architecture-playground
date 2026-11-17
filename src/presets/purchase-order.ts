import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ref, ROW, type PresetShape, START_RATE } from './helpers'

const dsl = (...lines: string[]) => lines.join('\n') + '\n'

/** Texts and DSL pieces shared by both styles of the purchase (`presets.purchase-order`). */
function purchaseText(lang: Lang, id: string) {
  const { text, guide } = presetText(lang, id, 'purchase-order')
  const n = (key: string) => text(`nodes.${key}`)
  const path = (key: string) => text(`paths.${key}`)
  const event = text('eventType')
  return { text, guide, n, path, event }
}

// Capacity covers each handler's whole run (the slot is held until it replies), at ~1.5 req/s.
const svc = { capacity: 4 }
/** Both styles get the same traffic, so their latencies compare. */
const DEMO_RATE = 1.5

/** Orchestration: Órdenes calls each service and waits, then replies 201. */
export function orchestrationPreset(lang: Lang): PresetShape {
  const { text, guide, n, path } = purchaseText(lang, 'orchestration')
  const query = (db: string) => dsl('on request:', `  query ${ref(n(db))}`)
  return {
    id: 'orchestration',
    ...guide,
    demoRates: { 'client-orq': DEMO_RATE },
    graph: {
      nodes: [
        node('client-orq', 'client', 0, ROW, n('client'), {
          ip: '10.0.0.1',
          color: CLIENT_COLORS[0],
          rate: START_RATE,
          mix: [{ value: path('orders'), weight: 1 }],
        }),
        node('ordenes-orq', 'service', 1, ROW, n('orders'), {
          capacity: 16,
          queueMax: 20,
          behavior: dsl(
            text('comments.orchestration'),
            `on request ${path('orders')}:`,
            `  call ${ref(n('stock'))} ${path('reserve')}`,
            `  call ${ref(n('payments'))} ${path('charge')} or reply 402`,
            `  call ${ref(n('mails'))} ${path('send')} nowait`,
            '  reply 201',
          ),
        }),
        node('stock-orq', 'service', 2, 0, n('stock'), { ...svc, behavior: query('stockDb') }),
        node('pagos-orq', 'service', 2, ROW, n('payments'), {
          ...svc,
          behavior: dsl('on request:', `  query ${ref(n('paymentsDb'))}`, '  fail 5%'),
        }),
        node('mails-orq', 'service', 2, 2 * ROW, n('mails'), { ...svc, behavior: query('mailsDb') }),
        node('db-stock-orq', 'database', 3, 0, n('stockDb')),
        node('db-pagos-orq', 'database', 3, ROW, n('paymentsDb')),
        node('db-mails-orq', 'database', 3, 2 * ROW, n('mailsDb')),
      ],
      edges: [
        edge('client-orq', 'ordenes-orq'),
        edge('ordenes-orq', 'stock-orq'),
        edge('ordenes-orq', 'pagos-orq'),
        edge('ordenes-orq', 'mails-orq'),
        edge('stock-orq', 'db-stock-orq'),
        edge('pagos-orq', 'db-pagos-orq'),
        edge('mails-orq', 'db-mails-orq'),
      ],
    },
  }
}

/** Choreography: Órdenes stores the order, publishes an event and replies 202; each service reacts on its own. */
export function choreographyPreset(lang: Lang): PresetShape {
  const { text, guide, n, path, event } = purchaseText(lang, 'choreography')
  const onEvent = (db: string) => dsl(`on event ${ref(event)}:`, `  query ${ref(n(db))}`)
  return {
    id: 'choreography',
    ...guide,
    demoRates: { 'client-cor': DEMO_RATE },
    graph: {
      nodes: [
        node('client-cor', 'client', 0, ROW, n('client'), {
          ip: '10.0.0.1',
          color: CLIENT_COLORS[0],
          rate: START_RATE,
          mix: [{ value: path('orders'), weight: 1 }],
        }),
        node('ordenes-cor', 'service', 1, ROW, n('orders'), {
          capacity: 8,
          queueMax: 20,
          behavior: dsl(
            text('comments.choreography'),
            `on request ${path('orders')}:`,
            `  query ${ref(n('ordersDb'))}`,
            `  publish ${ref(event)}`,
            '  reply 202',
          ),
        }),
        node('db-ordenes-cor', 'database', 2, 2.5 * ROW, n('ordersDb')),
        node('broker', 'broker', 2, ROW, n('broker')),
        node('stock-cor', 'subscriber', 3, 0, n('stock'), { ...svc, behavior: onEvent('stockDb') }),
        node('pagos-cor', 'subscriber', 3, ROW, n('payments'), { ...svc, behavior: onEvent('paymentsDb') }),
        node('mails-cor', 'subscriber', 3, 2 * ROW, n('mails'), { ...svc, behavior: onEvent('mailsDb') }),
        node('db-stock-cor', 'database', 4, 0, n('stockDb')),
        node('db-pagos-cor', 'database', 4, ROW, n('paymentsDb')),
        node('db-mails-cor', 'database', 4, 2 * ROW, n('mailsDb')),
      ],
      edges: [
        edge('client-cor', 'ordenes-cor'),
        edge('ordenes-cor', 'db-ordenes-cor'),
        edge('ordenes-cor', 'broker'),
        edge('broker', 'stock-cor'),
        edge('broker', 'pagos-cor'),
        edge('broker', 'mails-cor'),
        edge('stock-cor', 'db-stock-cor'),
        edge('pagos-cor', 'db-pagos-cor'),
        edge('mails-cor', 'db-mails-cor'),
      ],
    },
  }
}
