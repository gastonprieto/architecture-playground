# Architecture Playground

Un playground para armar arquitecturas en un canvas (clientes, servicios, bases de datos, load balancers, proxies reversos, caches, colas, workers, DLQs, brokers y suscriptores) y ver cómo fluyen los requests, mensajes y eventos entre los componentes. Se puede cambiar la configuración de cada componente (capacidad, tiempo de proceso, caídas, etc.) para ver cómo se comporta el sistema bajo carga.

Incluye 4 presets para empezar:

- **Load balancer**: dos clientes reparten su tráfico entre tres servidores con round robin.
- **Sync vs cola**: el mismo tráfico contra un servicio síncrono (se satura con 503) y contra una cola con workers (responde 202).
- **Pub/sub**: un evento se publica en el broker y llega a cuatro suscriptores; uno es lento y se atrasa.
- **Proxy reverso**: el proxy enruta por prefijo de path a cada servicio.

Online (una vez publicado el repo): https://gastonprieto.github.io/architecture-playground/

## Cómo correrlo

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests (vitest)
npm run build    # build de producción en dist/
```

## Cómo agregar un tipo de componente

Cada componente es una definición creada con `defineComponent` en `src/components/`. Ejemplo, un `rate-limiter` (basado en `database.ts` y `service.ts`):

```ts
// src/components/rate-limiter.ts
import { defineComponent, processingFields } from '../engine/registry'

export interface RateLimiterConfig {
  name: string
  up: boolean
  processingTime: number
  capacity: number
  queueMax: number
  maxPerSecond: number
}

export interface RateLimiterState {
  windowStart: number
  count: number
}

export const rateLimiter = defineComponent<RateLimiterConfig, RateLimiterState>({
  type: 'rate-limiter',
  label: 'Rate limiter',
  icon: '🚦',
  color: 'slow',
  config: {
    ...processingFields,
    maxPerSecond: { type: 'number', label: 'Máx. por segundo', default: 5, min: 1, max: 100 },
  },
  initialState: () => ({ windowStart: 0, count: 0 }),
  onMessage(msg, ctx) {
    if (ctx.now - ctx.state.windowStart >= 1000) {
      ctx.state.windowStart = ctx.now
      ctx.state.count = 0
    }
    if (++ctx.state.count > ctx.config.maxPerSecond) {
      ctx.reply(msg, { status: 'error', code: 429 })
      return
    }
    ctx.process(msg, () => {
      const [next] = ctx.outputs()
      if (next) ctx.send(next.target, msg)
      else ctx.reply(msg, { status: 'ok', code: 200 })
    })
  },
  onResponse(res, ctx) {
    ctx.forwardResponse(res)
  },
})
```

Después hay que registrarlo en `src/components/index.ts`, agregándolo a la lista `builtins` (que alimenta `defaultRegistry`):

```ts
import { rateLimiter } from './rate-limiter'

const builtins: ComponentDef[] = [/* ... */, rateLimiter]
```

`defineComponent` agrega automáticamente el campo `name`. Los campos de `config` se muestran solos en el panel de propiedades.

### API de `ctx`

- `send(target, msg)`: envía un mensaje a otro nodo (agrega este nodo al `trail`).
- `reply(msg, { status, code })`: responde al origen del mensaje.
- `forwardResponse(res)`: pasa una respuesta un salto más hacia atrás.
- `drop(msg, reason, code?)`: descarta el mensaje.
- `process(msg, done)`: ocupa un slot de capacidad durante `processingTime` y luego llama a `done` (si no hay lugar, encola o rechaza).
- `schedule(ms, fn)`: ejecuta `fn` después de `ms` de tiempo simulado.
- `label(text, tone)`: muestra una etiqueta sobre el nodo.
- `random()`: número aleatorio determinístico del motor.
- `outputs()`: aristas de salida del nodo (`edgeId`, `target`, `targetType`, `rule`).
- `peer(id)`: tipo y configuración de otro nodo.
- `newMessage(kind, meta, parent?)`: crea un mensaje nuevo.

También están disponibles `ctx.nodeId`, `ctx.now`, `ctx.config` y `ctx.state`.

## Especificación

El diseño completo está en [docs/spec.md](docs/spec.md).

## Deploy

El workflow `.github/workflows/deploy.yml` corre los tests, hace el build y publica `dist/` en GitHub Pages en cada push a `main`.
