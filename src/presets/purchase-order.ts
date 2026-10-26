import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape, START_RATE } from './helpers'

/** A DSL target: names with spaces are quoted. */
const ref = (name: string) => (/\s/.test(name) ? `"${name}"` : name)
const dsl = (...lines: string[]) => lines.join('\n') + '\n'

/** y of the choreography lane's first row (the orchestration lane uses rows 0 to 2). */
const LOW = 3.75 * ROW

/**
 * The same purchase twice, each lane with its own client and nodes. Top: orchestration (Órdenes
 * calls each service and waits). Bottom: choreography (Órdenes publishes an event and replies 202;
 * the services react through the broker). Services and their databases share columns 3 and 4 in
 * both lanes, so the two styles line up.
 */
export function purchaseOrderPreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'purchase-order')
  const n = (key: string) => text(`nodes.${key}`)
  const path = (key: string) => text(`paths.${key}`)
  const event = text('eventType')
  const query = (db: string) => dsl('on request:', `  query ${ref(n(db))}`)
  const onEvent = (db: string) => dsl(`on event ${ref(event)}:`, `  query ${ref(n(db))}`)
  // Capacity covers each handler's whole run (the slot is held until it replies), at ~1.5 req/s.
  const svc = { capacity: 4 }

  return {
    id: 'purchase-order',
    name,
    description,
    // Clients start at START_RATE; these are the rates the demo is tuned for.
    demoRates: { 'client-orq': 1.5, 'client-cor': 1.5 },
    graph: {
      nodes: [
        // Orchestration lane.
        node('client-orq', 'client', 0, ROW, n('clientOrchestration'), {
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
        node('stock-orq', 'service', 3, 0, n('stock'), { ...svc, behavior: query('stockDb') }),
        node('pagos-orq', 'service', 3, ROW, n('payments'), {
          ...svc,
          behavior: dsl('on request:', `  query ${ref(n('paymentsDb'))}`, '  fail 5%'),
        }),
        node('mails-orq', 'service', 3, 2 * ROW, n('mails'), { ...svc, behavior: query('mailsDb') }),
        node('db-stock-orq', 'database', 4, 0, n('stockDb')),
        node('db-pagos-orq', 'database', 4, ROW, n('paymentsDb')),
        node('db-mails-orq', 'database', 4, 2 * ROW, n('mailsDb')),

        // Choreography lane.
        node('client-cor', 'client', 0, LOW + ROW, n('clientChoreography'), {
          ip: '10.0.0.2',
          color: CLIENT_COLORS[1],
          rate: START_RATE,
          mix: [{ value: path('orders'), weight: 1 }],
        }),
        node('ordenes-cor', 'service', 1, LOW + ROW, n('orders'), {
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
        node('db-ordenes-cor', 'database', 2, LOW + 2.5 * ROW, n('ordersDb')),
        node('broker', 'broker', 2, LOW + ROW, n('broker')),
        node('stock-cor', 'subscriber', 3, LOW, n('stock'), { ...svc, behavior: onEvent('stockDb') }),
        node('pagos-cor', 'subscriber', 3, LOW + ROW, n('payments'), { ...svc, behavior: onEvent('paymentsDb') }),
        node('mails-cor', 'subscriber', 3, LOW + 2 * ROW, n('mails'), { ...svc, behavior: onEvent('mailsDb') }),
        node('db-stock-cor', 'database', 4, LOW, n('stockDb')),
        node('db-pagos-cor', 'database', 4, LOW + ROW, n('paymentsDb')),
        node('db-mails-cor', 'database', 4, LOW + 2 * ROW, n('mailsDb')),
      ],
      edges: [
        edge('client-orq', 'ordenes-orq'),
        edge('ordenes-orq', 'stock-orq'),
        edge('ordenes-orq', 'pagos-orq'),
        edge('ordenes-orq', 'mails-orq'),
        edge('stock-orq', 'db-stock-orq'),
        edge('pagos-orq', 'db-pagos-orq'),
        edge('mails-orq', 'db-mails-orq'),

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
