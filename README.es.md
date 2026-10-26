# Architecture Playground

[English version](README.md)

Un playground para armar arquitecturas en un canvas (clientes, servicios, bases de datos, load balancers, proxies reversos, caches, colas, workers, DLQs, brokers y suscriptores) y ver cómo fluyen los requests, mensajes y eventos entre los componentes. Se puede cambiar la configuración de cada componente (capacidad, tiempo de proceso, caídas, etc.) para ver cómo se comporta el sistema bajo carga.

Incluye 7 presets para empezar:

- **Load Balancer**: dos clientes reparten su tráfico entre tres servidores con round robin.
- **Sesiones**: la sesión en memoria del servidor (401 constantes detrás de un round robin), en un store clave-valor compartido y en un JWT, lado a lado.
- **Sync vs cola**: el mismo tráfico contra un servicio síncrono (se satura con 503) y contra una cola con workers (responde 202).
- **Pub/sub**: un evento se publica en el broker y llega a cuatro suscriptores; uno es lento y se atrasa.
- **Reverse Proxy**: el proxy enruta por prefijo de path a cada servicio, corta con 401 al cliente sin credenciales y cachea `/static` en el borde.
- **Cache**: cache-aside; el servicio le pregunta a la Cache por cada producto y en un MISS va a la base. Con 10 productos y lugar para 5, se ven las expulsiones (LRU) y la carga de la base.
- **Orden de compra**: la misma compra orquestada (Órdenes llama a cada servicio y espera) y coreografiada (Órdenes publica un evento y cada servicio reacciona por su cuenta), armada con el DSL de comportamiento.

Un Cliente envía a su primera salida (la primera arista que se conectó desde él).

La interfaz está en español e inglés: el selector `ES | EN` de la toolbar cambia el idioma al instante (también `?lang=es` / `?lang=en` en la URL). Sin elección guardada se usa el idioma del navegador. Los presets se cargan en el idioma actual; los nombres de los nodos que ya armaste no se traducen.

Online (una vez publicado el repo): https://gastonprieto.github.io/architecture-playground/

## Arquitectura como texto

El botón **Texto** de la toolbar abre un popup con el grafo entero escrito en un formato tipo PlantUML; editalo y apretá **Aplicar** (Ctrl+Enter) para reemplazar el grafo en un solo paso de deshacer. Exportar e Importar usan el mismo formato (`.arch`); si un archivo tiene errores, se abre el popup con el texto y la lista de errores, sin tocar el grafo actual.

```
client Web
  rate: 2

service Api
  capacity: 8

database DB

Web --> Api --> DB
```

El formato completo está en [docs/graph-dsl-spec.md](docs/graph-dsl-spec.md).

## Comportamiento (DSL)

Servicio, Worker y Suscriptor tienen un campo **Comportamiento**: un texto corto que decide qué hace el nodo con cada request, evento o mensaje (a quién llama, en qué orden, qué publica y con qué código responde). Vacío o con errores, el nodo usa su comportamiento por defecto. Se edita desde el inspector ("Editar comportamiento") y los nodos que lo usan muestran un badge `DSL`. Los destinos se nombran por el nombre del nodo conectado. El ejemplo es ilustrativo: valida solo en un nodo conectado a nodos con esos nombres (Base de datos, Stock, Pagos, Mails, Facturas) y a un Broker.

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

## Sesiones y autenticación

Se puede mostrar dónde vive la sesión de un usuario y quién autentica:

- **Cliente**: tiene **Usuarios** (cada uno con su cookie) y **Autenticación** (con login o sin credenciales). Con más de un usuario, el nodo muestra 🍪 logueados/N.
- **Paso `session`** del DSL: `session memory` (en el servidor), `session <Base>` (en una base compartida) o `session jwt` (en el token, que no se puede revocar). Una cookie que el servidor no conoce da `401` y el usuario se vuelve a loguear.
- **Base de datos**: tiene **Tipo** (relacional, clave-valor o documental). La clave-valor es rápida pero volátil: si se reinicia, pierde las sesiones.
- **Load Balancer**: **Sticky sessions** manda a cada usuario al servidor que le dio la cookie.
- **Reverse Proxy**: **Autenticación** (ninguna, credenciales o JWT) corta en la puerta con `401` a quien no trae credenciales.

El preset **Sesiones** pone los tres casos lado a lado. La spec está en [docs/sessions-spec.md](docs/sessions-spec.md).

## Cache

- **Cache**: sin salidas es una cache **cache-aside** (el servicio le pregunta y, tras un MISS, va a la base y guarda la clave); con salidas es **read-through**. **Modo** Claves reales (Capacidad con expulsión LRU y TTL) o Aleatorio (Hit rate). El nodo muestra 🔑 claves y hit %.
- **Servicio**: conectado a una Cache sin salidas hace cache-aside automático, sin DSL.
- **Paso `cache X:`** del DSL: el bloque corre solo en un MISS y, si sale bien, la clave se guarda sin esperar.
- **Reverse Proxy**: cache de borde (Apagada, Aleatoria o Claves reales) solo para los **Paths cacheables** (vacío = todos).

La spec está en [docs/cache-spec.md](docs/cache-spec.md).

## Solo flujo

El switch **Carga real | Solo flujo** de la barra de métricas sirve para ver por dónde va el tráfico sin pelearte con la capacidad: nada se satura ni falla por azar (capacidad, clientes en espera, cola máx., rate limit, tasa de fallo y `fail N%` del DSL quedan sin efecto). Lo único que corta un flujo es un componente **apagado**, o la lógica del propio flujo (rutas, sesiones, auth). Al activarlo o desactivarlo los contadores arrancan de cero. No cambia la configuración guardada.

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
- `inputs()`: aristas de entrada del nodo (`edgeId`, `source`, `sourceType`). Un consumidor las usa para saber a qué cola/broker pedirle trabajo.
- `pull(source)`: pide (pull) el próximo mensaje a un upstream (cola/broker): manda un salto `poll` hacia `source`. El upstream responde en su `onPoll` entregando un mensaje si tiene.
- `freeSlots()`: slots de proceso libres ahora (`capacity − inFlight`), para que el consumidor pida solo lo que puede tomar.
- `flowOnly`: `true` en modo solo flujo; un componente con fallos aleatorios propios no debería fallar.
- `peer(id)`: tipo y configuración de otro nodo.
- `newMessage(kind, meta, parent?)`: crea un mensaje nuevo.

Además de `onMessage`/`onResponse`, un componente puede definir `onPoll(msg, ctx)`: lo llama el motor cuando un consumidor hace `pull` hacia él (la cola y el broker entregan ahí un mensaje por pedido, en vez de empujar).

También están disponibles `ctx.nodeId`, `ctx.now`, `ctx.config` y `ctx.state`.

## Especificación

El diseño completo está en [docs/spec.md](docs/spec.md); el DSL de comportamiento, en [docs/dsl-spec.md](docs/dsl-spec.md).

## Deploy

El workflow `.github/workflows/deploy.yml` corre los tests, hace el build y publica `dist/` en GitHub Pages en cada push a `main`.
