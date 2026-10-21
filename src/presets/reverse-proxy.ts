import { CLIENT_COLORS } from '../components/client'
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
    // Clients start idle (0 req/s); these are the rates the demo is tuned for.
    demoRates: { 'web-client': 3, mobile: 3, anon: 1 },
    graph: {
      nodes: [
        node('web-client', 'client', 0, 0.5 * ROW, text('nodes.web'), { rate: 0, mix, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        node('mobile', 'client', 0, 1.5 * ROW, text('nodes.mobile'), { rate: 0, mix, ip: '10.0.0.2', color: CLIENT_COLORS[1] }),
        // No credentials: the gateway answers 401 and its requests never reach a service.
        node('anon', 'client', 0, 2.5 * ROW, text('nodes.anon'), { rate: 0, mix, ip: '10.0.0.3', color: CLIENT_COLORS[2], auth: 'none' }),
        // Edge cache on real keys for static content only: Web gets cached, Pagos never does.
        node('proxy', 'reverse-proxy', 1, 1.5 * ROW, text('nodes.proxy'), { auth: 'credentials', cache: 'keys', cacheablePaths: [path('static')] }),
        node('usuarios', 'service', 2, 0, text('nodes.users')),
        node('ordenes', 'service', 2, ROW, text('nodes.orders')),
        node('pagos', 'service', 2, 2 * ROW, text('nodes.payments')),
        node('web', 'service', 2, 3 * ROW, text('nodes.site')),
      ],
      edges: [
        edge('web-client', 'proxy'),
        edge('mobile', 'proxy'),
        edge('anon', 'proxy'),
        edge('proxy', 'usuarios', { kind: 'pathPrefix', value: path('users') }),
        edge('proxy', 'ordenes', { kind: 'pathPrefix', value: path('orders') }),
        edge('proxy', 'pagos', { kind: 'pathPrefix', value: path('payments') }),
        edge('proxy', 'web'),
      ],
    },
  }
}
