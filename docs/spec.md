# Architecture Playground — Spec

> Fuente de verdad de las decisiones tomadas en el grilling del 2026-10-19.
> Si algo de acá cambia, se cambia primero en este documento.

## 1. Qué es

Una app web para **armar una arquitectura arrastrando componentes a un canvas** y **ver animado cómo fluye la comunicación** (requests, mensajes, eventos) entre ellos.

- Propósito: **didáctico primero** (charlas, explicar a otros), con un modelo de eventos que permita crecer hacia un **simulador** (latencias, fallas, retries) sin reescribir.
- Origen: generaliza los componentes de los decks `presentacion-load-balancer`, `presentacion-colas-mensajes`, `presentacion-eventos-brokers` y `presentacion-proxy-reverso`. En esos decks cada simulador (`Sim`, `MsgSim`, `RouteSim`) tiene el flujo y la topología hardcodeados; acá **el flujo lo define el grafo que arma el usuario**.

## 2. Stack y deploy

| Tema | Decisión |
|---|---|
| Build | Vite + React + TypeScript |
| Canvas | React Flow (`@xyflow/react`) |
| Tests | Vitest (motor headless con reloj determinístico) |
| Backend | Ninguno |
| Persistencia | `localStorage` + export/import JSON + link compartible (estado comprimido en el hash de la URL) |
| Hosting | GitHub Pages, deploy con GitHub Actions en cada push a `main` (`base: '/architecture-playground/'`) |
| Idiomas | Español e inglés, con selector en la toolbar (`ES \| EN`; inicial: `?lang=`, la elección guardada o el idioma del navegador). Código, tipos y commits en inglés |
| Estética | Paleta y estilo SVG de los decks (ver §8) |
| Plataforma | Desktop-first; en mobile solo visualizar y correr presets (sin edición) |

El repo remoto en GitHub se crea al llegar a la etapa de deploy, con confirmación explícita.

## 3. Arquitectura del código

```
src/
  engine/        # TS puro, sin React ni DOM. Testeable headless y embebible.
    clock.ts     # tiempo de simulación, velocidad, pause/step
    graph.ts     # nodos, aristas dirigidas, reglas en aristas
    message.ts   # tipos de mensaje, ids, trazas
    registry.ts  # defineComponent + registro de tipos
    simulation.ts# orquesta: entrega mensajes, llama handlers, emite eventos
    metrics.ts   # throughput, latencias p50/p95, errores
  components/    # un archivo por tipo de componente (client.ts, cache.ts, ...)
  presets/       # arquitecturas de ejemplo (JSON del grafo)
  ui/            # React: canvas, paleta, inspector, toolbar, overlays de animación
  persistence/   # localStorage, export/import, hash de URL
```

Regla: `engine/` y `components/` **no importan nada de `ui/`**. La UI se suscribe a los eventos del motor.

## 4. Motor

### 4.1 Reloj

- Tiempo de simulación en ms, independiente del tiempo real: `simTime += realDt * speed`.
- Controles: play, pause, step (avanza un tick fijo), velocidad (`-` / `+`, como en los decks).
- En tests el reloj se avanza manualmente (`clock.advance(ms)`): sin `requestAnimationFrame` ni timers reales.
- Scheduler interno: cola de prioridad de acciones programadas `(at, fn)`.

### 4.2 Grafo

- **Nodos**: `{ id, type, position, config }`; el estado runtime vive en el motor, no en el grafo serializado.
- **Aristas dirigidas** `{ id, source, target, rule?, weight? }` (`weight`: número ≥ 0, lo usa el Load Balancer `weighted`). Cualquier cosa se puede conectar con cualquier cosa; no hay validación de tipos, salvo que los componentes solo-origen (`inputs: false` en el def; hoy solo el Cliente) no tienen puerto de entrada y no se les puede conectar nada. Una arista vieja hacia un Cliente se sigue cargando y dibujando (termina en su borde izquierdo). El componente decide qué hacer con sus salidas.
- **Regla en arista** (opcional), usada por los componentes que rutean (Proxy, Broker):
  - `path startsWith <prefijo>`
  - `eventType = <tipo>`
  - Se muestra como label sobre la arista en el canvas.

### 4.3 Mensajes

```ts
type MessageKind = 'request' | 'message' | 'event' | 'response'

interface Message {
  id: string
  kind: MessageKind
  meta: { path?: string; eventType?: string; clientId?: string; clientIp?: string; clientName?: string; clientColor?: string; [k: string]: unknown }
  trail: NodeId[]        // camino recorrido; los requests vuelven por acá
  createdAt: number      // simTime
  status?: 'ok' | 'error'
  code?: number          // 200, 202, 401, 429, 503, ...
  parentId?: string      // copia/derivado (ej. message encolado a partir de un request)
  depth?: number         // saltos de sus ancestros (parent.depth + parent.trail.length); el corte `loop` cuenta depth + trail
  attempt?: number       // reintentos en Queue
  replyTo?: string       // en un response: id del mensaje que responde
}
```

- **request**: espera respuesta; la respuesta recorre `trail` en sentido inverso.
- **message**: fire-and-forget, punto a punto (Queue → Worker).
- **event**: fire-and-forget, fan-out (Broker → Subscribers).
- **response**: viaja **salto a salto** por el `trail` invertido. Cada nodo intermedio puede interceptarlo (`onResponse`, ej. Cache que guarda) o dejarlo pasar. También sirve de ack/nack (Worker → Queue, Subscriber → Broker).
- Si un nodo recibe algo y no tiene adónde mandarlo, falla visiblemente (`503` / label flotante en el canvas). Un request descartado (`ctx.drop`) le devuelve al origen un response de error con ese código.
- Cada salto dura `HOP_MS = 600` ms de simulación. Un mensaje con `trail` de más de `MAX_TRAIL = 32` nodos se descarta con razón `loop` (protege contra ciclos).

### 4.4 Contrato de componente

```ts
defineComponent({
  type: 'cache',
  label: 'Cache',
  icon: '⚡',
  color: 'redis',
  config: {
    hitRate: { type: 'number', min: 0, max: 1, step: 0.05, default: 0.8, label: 'Hit rate' },
  },
  initialState: () => ({ hits: 0, misses: 0 }),
  onMessage(msg, ctx) { /* ... */ },
  onTick?(ctx) { /* generadores, ej. Client */ },
})
```

`ctx` expone:

| API | Para qué |
|---|---|
| `ctx.config`, `ctx.state` | config del usuario y estado runtime del nodo |
| `ctx.outputs(filter?)` | aristas salientes (con su regla) |
| `ctx.send(edgeOrNode, msg, { delay? })` | enviar a un vecino |
| `ctx.reply(msg, { status, code, delay? })` | responder un request por su `trail` |
| `ctx.drop(msg, reason)` | descartar con error visible (`reason` es un código estable en inglés, ver §4.5) |
| `ctx.process(msg, fn)` | ocupar un slot de `capacity` durante `processingTime` y luego `fn` (encola si no hay slot) |
| `ctx.schedule(ms, fn)` | acciones diferidas |
| `ctx.now`, `ctx.random()` | tiempo y RNG con seed (reproducible en tests) |

- Todos los tipos tienen un campo `name` (texto, default = label del tipo) para nombrarlos ("Órdenes", "Facturación").
- El `config` declarativo **genera el inspector** automáticamente (habilita a futuro tipos definidos por el usuario desde la UI).
- Agregar un tipo = crear `src/components/<type>.ts` y registrarlo en `src/components/index.ts`. El core no se toca.

### 4.5 Eventos que emite el motor

`message:sent { msg, from, to, edgeId, duration }`, `message:arrived`, `message:dropped { msg, at, reason, code? }`, `node:stats { nodeId, stats }`, `node:label { nodeId, text, tone }`, `metrics:tick`. Reiniciar es crear una `Simulation` nueva (no hay evento de reset).

`reason` y el `text` de `node:label` son **códigos estables en inglés**, no texto de UI: `down` (caído), `queue-full` (cola llena), `loop`, `removed`, `unknown-type`, `no-output` (sin salida), `no-dlq`, `no-subscribers`, `no-targets` (sin destinos disponibles), `no-origin-queue`, `client-rejects-requests`, `dlq-rejects-requests`; labels `retry`, `no-subscribers` y los literales `HIT`, `MISS`, `202`, `DLQ`. La UI los traduce (`reasons.<code>`, `labels.<code>`) y muestra crudo un código desconocido. `engine/` y `components/` no importan nada de `i18n/`.

El grafo se puede editar **con la simulación corriendo** (`sim.setGraph(graph)`): los nodos que siguen conservan su estado, los nuevos arrancan vacíos y los mensajes hacia nodos o aristas borrados se descartan. Así se puede "agregar un server" en vivo como en los decks.
La capa visual anima a partir de estos eventos; el motor no sabe nada de SVG.

### 4.6 Realismo del MVP

Componentes que procesan (Service, Database, Worker, Subscriber) tienen:

- `processingTime` (ms)
- `capacity` (slots concurrentes) — excedente va a cola interna con `queueMax`; si se llena → `503`
- toggle **up/down** — caído: rechaza con `503` (razón `down`)

Fuera del MVP: latencia por arista, jitter, timeouts, retries con backoff en el cliente.

### 4.7 Modo solo flujo

`sim.setFlowOnly(on)` deja ver solo por dónde va el tráfico, sin tener que ajustar capacidades. Con el modo activo nada falla por carga ni por azar:

- `capacity` y `queueMax` son ilimitados, tanto en el procesamiento como en la config que lee cada componente (Cola máx. de la Cola, Capacidad de claves de Cache y Reverse Proxy).
- `rateLimit` del Reverse Proxy y `failRate` del Worker quedan en 0; el paso `fail N%` del DSL no falla (`ctx.flowOnly`).
- Lo único que hace fallar un flujo por estado de un nodo es que esté **apagado** (`up: false`). Los fallos de la lógica del flujo siguen: sin salida, `404` por ruta, `401` de sesiones y auth, `reply <code>` del DSL.
- `processingTime` se respeta. Un consumidor pull sigue pidiendo trabajo según su `capacity` configurada (`ctx.freeSlots()` no cambia), así que lo que no alcanza a procesar espera en la cola en vez de rechazarse.
- Activarlo o desactivarlo reinicia los contadores `ok`/`errors` y las métricas, para que muestren solo cómo terminó el tráfico en el modo actual. Al activarlo, lo que esperaba en la cola interna de un nodo arranca de inmediato.

La config guardada no cambia: el modo se aplica en el motor y es estado de la sesión (no va en el link ni en el export). En la UI es el switch `Carga real | Solo flujo` al inicio de la barra de métricas, al lado de los números que reinicia y lejos de los controles de ejecución de la toolbar.

## 5. Catálogo de componentes (MVP)

| Tipo | Label (UI) | Comportamiento |
|---|---|---|
| `client` | Cliente | Genera requests o eventos con `rate` (req/s; default `0`: un cliente recién soltado no manda nada hasta que se sube la tasa o se usa "enviar 1" / "ráfaga") y un **mix** de `path`/`eventType` configurable. Tiene una **IP** (texto; al soltarlo desde la paleta se le asigna la siguiente libre `10.0.0.N`; los presets la fijan) que viaja en `meta.clientIp` junto a `clientId` y `clientName`. Tiene un **color** (6 muestras fijas; al soltarlo toma el siguiente libre) que viaja en `meta.clientColor` y pasa a todo lo derivado (llamadas de un Servicio, mensajes de la Cola, eventos del Broker): los paquetes se pintan con ese color y las respuestas suman un borde verde/rojo según ok/error. Acciones manuales: "enviar 1" y "ráfaga de N". Recibe respuestas y alimenta métricas de latencia. **Usuarios** (1–50, default 1): reparte sus mensajes entre ellos en orden; cada uno tiene su propia cookie de sesión y, con más de uno, su propia IP (`<ip>#k`) para el IP Hash. **Autenticación**: "Con login" (default; el request lleva `credentials` y la cookie del usuario si la tiene) o "Sin credenciales". Guarda la cookie que llega en `setSession` y la borra con un `401` `session-lost`; un `401` `unauthenticated` no cambia nada. El nodo muestra **🍪 logueados/N** con más de un usuario o si alguno está logueado (ver [sesiones](sessions-spec.md)). |
| `load-balancer` | Load Balancer | Reparte cada request a **una** salida según algoritmo: `round-robin`, `least-connections`, `random`, `ip-hash` (hashea `meta.clientIp`; si está vacía, `clientId`), `weighted` (smooth weighted round-robin según el **peso de cada conexión**, `weight` en la arista, editable en el inspector del LB o de la arista; sin peso = 1, peso 0 = nunca, todos los disponibles en 0 = parejo; el canvas muestra el % efectivo como label de la arista). Toggle de **health checks**: si está activo, saca de rotación las salidas caídas; si no, les sigue mandando y fallan. Toggle **Sticky sessions** (default off): recuerda qué servidor emitió cada cookie (`setSession`) y le manda ahí los requests de ese usuario, por encima del algoritmo; si ese servidor ya no está disponible, elige el algoritmo y actualiza el mapa. Con health checks apagados, el usuario pegado a un servidor caído sigue fallando. |
| `reverse-proxy` | Reverse Proxy | Elige la salida cuya regla matchee `path` (prefijo más largo gana; una arista sin regla equivale a `/`). Sin match → `404`. Features opcionales en config: **Autenticación** `auth` (`none` default; `credentials`: sin credenciales ni cookie → `401` `unauthenticated` sin rutear; `jwt`: igual, y a quien entra con credenciales sin token le emite `jwt:<id>` en la respuesta, pisando la cookie que haya puesto un servicio), `rateLimit` (req/s → `429`) y una **cache de borde** `cache` (`off` default, `random` con `hitRate`, o `keys`: claves reales = el path, con `capacity` y `ttl`, LRU y TTL como la Cache; un MISS se rutea y la respuesta ok guarda la clave). Solo pasan por la cache los requests cuyo path empieza con algún prefijo de **Paths cacheables** `cacheablePaths` (lista; vacía = todos; default `['/static']`). Un HIT lo responde él con `200` (label HIT, `meta.cacheHit`). En modo `keys` el nodo muestra 🔑 claves y hit %. Orden: rate limit → auth → cache → ruteo. Migraciones al cargar el grafo: `authFailRate > 0` → `auth: 'credentials'`; `cacheHitRate > 0` → `cache: 'random'` con ese `hitRate` y `cacheablePaths: []` (si no, `cache: 'off'`). Ver [cache](cache-spec.md#5-reverse-proxy-cache-de-borde). |
| `service` | Servicio | Sin salidas: procesa y responde. Con salidas: procesa y llama a sus dependencias en modo `parallel` (default) o `sequential`; responde cuando vuelven todas, error si alguna falla. Si una salida es Queue o Broker, solo espera el `202`/ack. **Cache-aside automático:** si una salida es una Cache **hoja** (sin salidas), primero le pide la clave (`get`); HIT → responde `200` sin llamar al resto; MISS → llama a las otras salidas y, si todas salen bien, manda `set` sin esperar; si alguna falla → `502` sin `set`; Cache caída → sigue como MISS sin `set` ([cache](cache-spec.md#3-servicio-sin-dsl-cache-aside-automático)). Campo **`behavior`** (Comportamiento): un texto en el [DSL de comportamiento](dsl-spec.md) que, si es válido, reemplaza este comportamiento por defecto (qué llamar, en qué orden, con qué código responder). |
| `database` | Base de datos | Procesa (query) y responde. **Tipo**: Relacional (🗄️, 300 ms, default), Clave-valor (🗝️, 20 ms) o Documental (📄, 80 ms); el nodo muestra el ícono y "Base de datos · tipo", y al cambiarlo en el inspector se aplica el tiempo de proceso sugerido salvo que se haya editado. Guarda sesiones para `session <Base>` (`sessionOp` check/create → `200` o `404`) y muestra **🍪 N**; la clave-valor es volátil: al volver de Activo = off pierde sus sesiones. |
| `cache` | Cache | Su papel depende de la topología. **Sin salidas = hoja (cache-aside):** responde `meta.cacheOp` `get` (sin `cacheOp` también) con `200` y `meta.cacheHit` true/false (label HIT/MISS; un MISS no es error) y `set` guardando la clave. **Con salidas = read-through:** un HIT responde ella; un MISS se reenvía a la primera salida (sin `cacheOp`) y la respuesta ok se guarda al volver. **Modo** `keys` (default; clave = `meta.cacheKey` o el path; **Capacidad** 1–1000 claves con expulsión LRU, **TTL** en ms de simulación, 0 = no vence) o `random` (HIT con `hitRate`; `set` no guarda). `processingTime` 50 y toggle Activo (caída → `503`; al apagarse pierde sus claves). El nodo muestra 🔑 claves (modo `keys`) y hit % real. Una Cache vieja sin `mode` se migra a `random` al cargar. Ver [cache](cache-spec.md). |
| `queue` | Cola | Al recibir un request responde **`202` al instante** y encola un `message` derivado. Empuja mensajes a los Workers **libres** conectados (push). Si el worker falla, reintenta hasta `maxRetries`; luego envía a la salida que sea un nodo `dlq`. `queueMax` lleno → rechaza. Muestra los mensajes encolados como celdas. |
| `dlq` | DLQ | Acumula mensajes muertos; muestra contador. Botón "reprocesar" (los devuelve a la cola de origen). |
| `worker` | Worker | Consume `message`s: procesa con `processingTime`/`capacity`, con `failRate` configurable (simula mensajes venenosos). Puede tener salidas (ej. DB) como un Service. Campo **`behavior`** (Comportamiento): cualquier DSL válido en el [DSL de comportamiento](dsl-spec.md) reemplaza el default (y `failRate`); sin un handler `on message`, cada mensaje se confirma sin hacer nada. |
| `broker` | Broker | Al recibir un `event` (o request, al que responde `202`) hace **fan-out** a todas las salidas cuya regla matchee `eventType` (sin regla = recibe todo). Mantiene una **lane (buffer) por suscriptor** y solo le empuja cuando tiene capacidad libre y está arriba: cada suscriptor va a su ritmo y uno caído acumula eventos (consistencia eventual). |
| `subscriber` | Suscriptor | Consume eventos a su ritmo (`processingTime`/`capacity`); puede emitir eventos nuevos hacia sus salidas (cadenas de eventos). Campo **`behavior`** (Comportamiento): cualquier DSL válido en el [DSL de comportamiento](dsl-spec.md) reemplaza el default (y `emits`); sin un handler `on event`, cada evento se confirma sin hacer nada. |

Fuera del MVP (se agregan después como config): TLS, compresión, rolling deploy, réplicas como nodo agrupado.

## 6. UI

- **Paleta lateral** con los tipos del registry; drag & drop al canvas.
- **Canvas** (React Flow): mover, conectar, seleccionar, borrar nodos y aristas, zoom/pan. Sin auto-layout.
- **Inspector**: panel generado desde `config` del tipo; para aristas, editor de regla.
- **Info por componente**: un botón ⓘ en cada tile de la paleta y en el encabezado del inspector abre un modal "Cómo funciona" con qué es, cómo se comporta (códigos que puede responder), qué hace cada campo de config y un tip para la clase. El texto vive en `components.<type>.info` (es/en); un tipo sin info muestra "Sin información".
- **Undo/redo** de cambios estructurales y de config.
- **Toolbar**: play/pause, step, velocidad, reset, presets, export/import, copiar link, selector de idioma `ES | EN`. Un import inválido muestra el error traducido (`parseGraph` devuelve códigos: `invalid-json`, `unknown-format`, `dangling-edge` + `edgeId`).
- **Idiomas**: los textos viven en `src/i18n/` (`es.ts`, `en.ts` con las mismas claves). Los presets se cargan en el idioma actual; los nombres de los nodos que ya armó el usuario no se traducen.
- **Overlay de animación**: paquetes viajando por las aristas (círculos para requests, cuadrados para messages, rombos para events), coloreados por estado, o con el color del cliente que los originó (las respuestas con borde ok/error); labels flotantes (`503`, `401`, `✔`, `202`).
- **Por nodo**: contadores en vivo (en proceso, en cola, ok, errores), badge up/down, para sesiones 🍪 (Cliente: logueados/N; Servicio con `session memory` y Base de datos: sesiones guardadas) y, para caches, 🔑 claves guardadas y hit % real (Cache; Reverse Proxy con cache en Claves reales).
- **Campos condicionales**: un campo puede declarar `showIf` (`equals` / `notEquals` sobre otro campo) y el inspector lo oculta cuando no aplica (p. ej. Capacidad/TTL solo en Claves reales). Un campo `list` (lista de strings) se edita con filas como el Mix, sin peso.
- **Barra global de métricas**: throughput, latencia p50/p95, tasa de error. (Gráficos tipo `widgets.js` en una segunda iteración.)

## 7. Presets

Cargables con un click; cada uno reproduce un deck y sirve como test de integración del motor. Los clientes de los presets arrancan en **0 req/s** (el usuario decide cuándo arranca el tráfico); cada preset guarda en `demoRates` la tasa para la que está calibrado, que usan los tests:

1. **Load balancer** — 2 clientes → LB → 3 servicios → DB.
2. **Sesiones** — tres carriles, cada uno con un Cliente de 5 usuarios con login → LB round robin sin sticky, con health checks → 3 servicios (1 req/s de demo): `session memory` (401 `session-lost` y re-login constantes), `session Sesiones` contra una Base clave-valor compartida, y `session jwt`. Ver [sesiones](sessions-spec.md#10-presets).
3. **Sync vs cola** — cliente → servicio (sync) / cliente → cola → 3 workers + DLQ.
4. **Pub/sub** — Órdenes → Broker → Facturación, Stock, Mails, Analytics.
5. **Proxy reverso** — Navegador + App móvil + un cliente Sin credenciales → Proxy (Autenticación = Credenciales; Cache en Claves reales con Paths cacheables `['/static']`) → Usuarios, Órdenes, Pagos, Web (reglas por path). El cliente sin credenciales recibe `401` en la puerta. `/static` se responde desde la cache del proxy; Pagos nunca.
6. **Cache** — Cliente (Mix de 10 paths `/productos/1` … `/productos/10`, 5 req/s de demo) → Servicio sin DSL (con holgura: proceso 100 ms, capacidad 20, cola 50) → Cache (Claves reales, Capacidad 5) + Base de datos (relacional). Muestra el cache-aside automático: warm-up, MISS por expulsión (10 claves en 5 lugares) y la carga de la base; con Capacidad 10 la base casi no recibe nada. Ver [cache](cache-spec.md#7-presets).
7. **Orden de compra** — orquestación vs coreografía con el [DSL de comportamiento](dsl-spec.md#9-preset-orden-de-compra). Arriba, Cliente → Órdenes, que llama a Stock, Pagos (`or reply 402`) y Mails (`nowait`) y responde `201`; cada uno consulta su BD. Abajo, Cliente → Órdenes, que guarda en su BD, publica `OrdenCreada` y responde `202`; Broker → Stock, Pagos y Mails (Suscriptores con `on event OrdenCreada`), cada uno con su BD.

## 8. Estética (de `presentaciones-guideline`)

```
--bg #0a0f1f  --panel #111a33  --panel-2 #0e1630  --line #24304f
--text #e2e8f0  --muted #94a3b8  --dim #64748b
--cyan #38bdf8  --green #4ade80  --yellow #facc15  --red #f87171
--orange #fb923c  --purple #a78bfa  --pink #f472b6  --teal #2dd4bf
```

Colores por significado (de `sim.js`): `req #7dd3fc`, `ok #4ade80`, `slow #facc15`, `err #f87171`, `hc #c084fc`, `redis #fb7185`, `db #2dd4bf`.
Aristas como curvas cúbicas (lógica `cubic`/`edge` de `sim.js`). Fuentes: Inter + monospace.

## 9. Proceso

1. Este spec → revisión del usuario.
2. Plan de implementación por etapas: **motor + tests → canvas → componentes → presets → persistencia → deploy**.
3. TDD en el motor y los componentes (Vitest, reloj determinístico, RNG con seed).

## 10. Fuera de alcance (por ahora)

- Crear tipos de componente desde la UI (el `config` declarativo lo prepara).
- Backend, cuentas, colaboración en tiempo real.
- Edición en mobile.
- Gráficos históricos de métricas.
- Latencia por arista, timeouts, backoff.
