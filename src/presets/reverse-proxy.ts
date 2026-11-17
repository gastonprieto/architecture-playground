import { CLIENT_COLORS } from '../components/client'
import type { Lang } from '../i18n'
import { edge, node, presetText, ROW, type PresetShape, START_RATE } from './helpers'

/** Routing and auth at the door: path prefixes pick the service, and a client without credentials gets 401. */
export function reverseProxyPreset(lang: Lang): PresetShape {
  const { text, guide } = presetText(lang, 'reverse-proxy')
  const path = (key: 'users' | 'orders' | 'payments' | 'static') => text(`paths.${key}`)
  const mix = [path('users'), path('orders'), path('payments'), path('static')].map((value) => ({ value, weight: 1 }))
  return {
    id: 'reverse-proxy',
    ...guide,
    // Clients start at START_RATE; these are the rates the demo is tuned for.
    demoRates: { 'web-client': 3, mobile: 3, anon: 1 },
    graph: {
      nodes: [
        node('web-client', 'client', 0, 0.5 * ROW, text('nodes.web'), { rate: START_RATE, mix, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        node('mobile', 'client', 0, 1.5 * ROW, text('nodes.mobile'), { rate: START_RATE, mix, ip: '10.0.0.2', color: CLIENT_COLORS[1] }),
        // No credentials: the gateway answers 401 and its requests never reach a service.
        node('anon', 'client', 0, 2.5 * ROW, text('nodes.anon'), { rate: START_RATE, mix, ip: '10.0.0.3', color: CLIENT_COLORS[2], auth: 'none' }),
        node('proxy', 'reverse-proxy', 1, 1.5 * ROW, text('nodes.proxy'), { auth: 'credentials' }),
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

/** An edge cache on real keys for static content only: Web gets cached, Pagos never does. */
export function edgeCachePreset(lang: Lang): PresetShape {
  const { text, guide } = presetText(lang, 'edge-cache', 'reverse-proxy')
  const statics = text('paths.static')
  const payments = text('paths.payments')
  const mix = [statics, payments].map((value) => ({ value, weight: 1 }))
  return {
    id: 'edge-cache',
    ...guide,
    demoRates: { 'web-client': 3, mobile: 3 },
    related: ['cache'],
    graph: {
      nodes: [
        node('web-client', 'client', 0, 0, text('nodes.web'), { rate: START_RATE, mix, ip: '10.0.0.1', color: CLIENT_COLORS[0] }),
        node('mobile', 'client', 0, ROW, text('nodes.mobile'), { rate: START_RATE, mix, ip: '10.0.0.2', color: CLIENT_COLORS[1] }),
        node('proxy', 'reverse-proxy', 1, 0.5 * ROW, text('nodes.proxy'), { cache: 'keys', cacheablePaths: [statics] }),
        node('pagos', 'service', 2, 0, text('nodes.payments')),
        node('web', 'service', 2, ROW, text('nodes.site')),
      ],
      edges: [
        edge('web-client', 'proxy'),
        edge('mobile', 'proxy'),
        edge('proxy', 'pagos', { kind: 'pathPrefix', value: payments }),
        edge('proxy', 'web'),
      ],
    },
  }
}
