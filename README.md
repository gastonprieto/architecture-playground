# Architecture Playground

[English version](README.en.md)

Un playground para armar arquitecturas en un canvas (clientes, servicios, bases de datos, load balancers, proxies reversos, caches, colas, workers, DLQs, brokers y suscriptores) y ver cómo fluyen los requests, mensajes y eventos entre los componentes. Se puede cambiar la configuración de cada componente (capacidad, tiempo de proceso, caídas, etc.) para ver cómo se comporta el sistema bajo carga.

Incluye 5 presets para empezar:

- **Load Balancer**: dos clientes reparten su tráfico entre tres servidores con round robin.
- **Sync vs cola**: el mismo tráfico contra un servicio síncrono (se satura con 503) y contra una cola con workers (responde 202).
- **Pub/sub**: un evento se publica en el broker y llega a cuatro suscriptores; uno es lento y se atrasa.
- **Reverse Proxy**: el proxy enruta por prefijo de path a cada servicio.
- **Orden de compra**: la misma compra orquestada (Órdenes llama a cada servicio y espera) y coreografiada (Órdenes publica un evento y cada servicio reacciona por su cuenta), armada con el DSL de comportamiento.

Un Cliente envía a su primera salida (la primera arista que se conectó desde él).

La interfaz está en español e inglés: el selector `ES | EN` de la toolbar cambia el idioma al instante (también `?lang=es` / `?lang=en` en la URL). Sin elección guardada se usa el idioma del navegador. Los presets se cargan en el idioma actual; los nombres de los nodos que ya armaste no se traducen.

Online (una vez publicado el repo): https://gastonprieto.github.io/architecture-playground/

## Comportamiento (DSL)

Servicio, Worker y Suscriptor tienen un campo **Comportamiento**: un texto corto que decide qué hace el nodo con cada request, evento o mensaje (a quién llama, en qué orden, qué publica y con qué código responde). Vacío o con errores, el nodo usa su comportamiento por defecto. Se edita desde el inspector ("Editar comportamiento") y los nodos que lo usan muestran un badge `DSL`. Los destinos se nombran por el nombre del nodo conectado.

```
on request /ordenes:
  query Base de datos
  parallel:
    call Stock /reservas
    call Pagos /cobros or reply 402
  call Mails /enviar nowait
  publish OrdenCreada
  enqueue Facturas
  reply 201

on request:
  reply 404

on event PagoRechazado:
  call Stock /liberar or continue

on message:
  fail 10%
  query Base de datos
```

La referencia completa está en [docs/dsl-spec.md](docs/dsl-spec.md).

## Cómo correrlo

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests (vitest; requiere Node >= 22.22.2)
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

Los textos de la definición (`label`, labels de campos, opciones y acciones) son el fallback. Para traducirlos, agregá las claves en `src/i18n/es.ts` y `src/i18n/en.ts` (las dos con las mismas claves; el tipo `Dict` lo verifica):

```ts
'rate-limiter': {
  label: 'Rate limiter',
  fields: { maxPerSecond: 'Máx. por segundo' }, // en: 'Max per second'
},
```

`name`, `up`, `processingTime`, `capacity` y `queueMax` ya tienen claves compartidas (`fields.<key>`). Las razones de `drop` y los textos de `label` son códigos estables en inglés (`'queue-full'`, `'retry'`); la UI busca `reasons.<code>` / `labels.<code>` y si no existe muestra el código tal cual.

### API de `ctx`

- `send(target, msg)`: envía un mensaje a otro nodo (agrega este nodo al `trail`).
- `reply(msg, { status, code })`: responde al origen del mensaje.
- `forwardResponse(res)`: pasa una respuesta un salto más hacia atrás.
- `drop(msg, reason, code?)`: descarta el mensaje (y le devuelve un response de error a quien lo envió). `reason` es un código (`'down'`, `'queue-full'`, `'no-output'`…).
- `process(msg, done)`: ocupa un slot de capacidad durante `processingTime` y luego llama a `done` (si no hay lugar, encola o rechaza).
- `schedule(ms, fn)`: ejecuta `fn` después de `ms` de tiempo simulado.
- `label(text, tone)`: muestra una etiqueta sobre el nodo (`text` es un código, ej. `'retry'`, o un literal como `'HIT'`).
- `random()`: número aleatorio determinístico del motor.
- `outputs()`: aristas de salida del nodo (`edgeId`, `target`, `targetType`, `rule`).
- `peer(id)`: tipo y configuración de otro nodo.
- `newMessage(kind, meta, parent?)`: crea un mensaje nuevo.

También están disponibles `ctx.nodeId`, `ctx.now`, `ctx.config` y `ctx.state`.

## Especificación

El diseño completo está en [docs/spec.md](docs/spec.md); el DSL de comportamiento, en [docs/dsl-spec.md](docs/dsl-spec.md).

## Deploy

El workflow `.github/workflows/deploy.yml` corre los tests, hace el build y publica `dist/` en GitHub Pages en cada push a `main`.
