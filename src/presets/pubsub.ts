import { edge, node, ROW, type PresetShape } from './helpers'

export const pubsubPreset: PresetShape = {
  id: 'pubsub',
  name: 'Pub/sub',
  description: 'Un evento OrdenCreada se publica en el broker y llega a cuatro suscriptores; Analytics es lento y se atrasa.',
  graph: {
    nodes: [
      node('ordenes', 'client', 0, 1.5 * ROW, 'Órdenes', { kind: 'event', rate: 3, mix: [{ value: 'OrdenCreada', weight: 1 }] }),
      node('broker', 'broker', 1, 1.5 * ROW, 'Broker'),
      node('facturacion', 'subscriber', 2, 0, 'Facturación'),
      node('stock', 'subscriber', 2, ROW, 'Stock'),
      node('mails', 'subscriber', 2, 2 * ROW, 'Mails'),
      node('analytics', 'subscriber', 2, 3 * ROW, 'Analytics', { processingTime: 2500 }),
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
