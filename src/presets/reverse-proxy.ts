import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape } from './helpers'

export function reverseProxyPreset(lang: Lang): PresetShape {
  const { text, name, description } = presetText(lang, 'reverse-proxy')
  const path = (key: 'users' | 'orders' | 'payments' | 'static') => text(`paths.${key}`)
  const mix = [path('users'), path('orders'), path('payments'), path('static')].map((value) => ({ value, weight: 1 }))
  return {
    id: 'reverse-proxy',
    name,
    description,
    graph: {
      nodes: [
        node('web-client', 'client', 0, ROW, text('nodes.web'), { rate: 3, mix, ip: '10.0.0.1' }),
        node('mobile', 'client', 0, 2 * ROW, text('nodes.mobile'), { rate: 3, mix, ip: '10.0.0.2' }),
        node('proxy', 'reverse-proxy', 1, 1.5 * ROW, text('nodes.proxy')),
        node('usuarios', 'service', 2, 0, text('nodes.users')),
        node('ordenes', 'service', 2, ROW, text('nodes.orders')),
        node('pagos', 'service', 2, 2 * ROW, text('nodes.payments')),
        node('web', 'service', 2, 3 * ROW, text('nodes.site')),
      ],
      edges: [
        edge('web-client', 'proxy'),
        edge('mobile', 'proxy'),
        edge('proxy', 'usuarios', { kind: 'pathPrefix', value: path('users') }),
        edge('proxy', 'ordenes', { kind: 'pathPrefix', value: path('orders') }),
        edge('proxy', 'pagos', { kind: 'pathPrefix', value: path('payments') }),
        edge('proxy', 'web'),
      ],
    },
  }
}
