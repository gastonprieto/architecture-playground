import { edge, node, ROW, type PresetShape } from './helpers'

const mix = ['/usuarios', '/ordenes', '/pagos', '/static'].map((value) => ({ value, weight: 1 }))

export const reverseProxyPreset: PresetShape = {
  id: 'reverse-proxy',
  name: 'Proxy reverso',
  description: 'El proxy enruta por prefijo de path a cada servicio; lo que no coincide con ninguna regla va a Web.',
  graph: {
    nodes: [
      node('web-client', 'client', 0, ROW, 'Navegador', { rate: 3, mix }),
      node('mobile', 'client', 0, 2 * ROW, 'App móvil', { rate: 3, mix }),
      node('proxy', 'reverse-proxy', 1, 1.5 * ROW, 'Proxy reverso'),
      node('usuarios', 'service', 2, 0, 'Usuarios'),
      node('ordenes', 'service', 2, ROW, 'Órdenes'),
      node('pagos', 'service', 2, 2 * ROW, 'Pagos'),
      node('web', 'service', 2, 3 * ROW, 'Web'),
    ],
    edges: [
      edge('web-client', 'proxy'),
      edge('mobile', 'proxy'),
      edge('proxy', 'usuarios', { kind: 'pathPrefix', value: '/usuarios' }),
      edge('proxy', 'ordenes', { kind: 'pathPrefix', value: '/ordenes' }),
      edge('proxy', 'pagos', { kind: 'pathPrefix', value: '/pagos' }),
      edge('proxy', 'web'),
    ],
  },
}
