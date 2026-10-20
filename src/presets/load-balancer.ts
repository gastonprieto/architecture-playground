import { edge, node, ROW, type PresetShape } from './helpers'

export const loadBalancerPreset: PresetShape = {
  id: 'load-balancer',
  name: 'Load balancer',
  description: 'Dos clientes reparten su tráfico entre tres servidores con round robin.',
  graph: {
    nodes: [
      node('web', 'client', 0, 0.5 * ROW, 'Navegador', { rate: 3 }),
      node('mobile', 'client', 0, 2.5 * ROW, 'App móvil', { rate: 3 }),
      node('lb', 'load-balancer', 1, 1.5 * ROW, 'Load balancer', { algorithm: 'round-robin' }),
      node('srv-1', 'service', 2, 0, 'Servidor 1'),
      node('srv-2', 'service', 2, 1.5 * ROW, 'Servidor 2'),
      node('srv-3', 'service', 2, 3 * ROW, 'Servidor 3'),
      node('db', 'database', 3, 1.5 * ROW, 'Base de datos'),
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
