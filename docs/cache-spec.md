# Cache (cache-aside, claves reales) — Spec

> Decisiones del grilling del 2026-10-21. Se apoya en `docs/spec.md`, `docs/dsl-spec.md` y `docs/sessions-spec.md`.

## 1. Qué cambia

Hoy la Cache modela **read-through**: la Cache reenvía los MISS a la base. El patrón más común es **cache-aside**: el **servicio** consulta la Cache, y si hay MISS va él mismo a la base y después escribe la clave en la Cache. Además, el HIT hoy sale al azar; se agrega un modo con **claves reales**.

## 2. Componente Cache

### 2.1 Rol según la topología

- **Sin salidas conectadas → hoja (cache-aside).** Responde a operaciones de cache, no reenvía nada:
  - `meta.cacheOp = 'get'`: **HIT** → 200 con `meta.cacheHit = true` y label "HIT". **MISS** → **200** con `meta.cacheHit = false` y label "MISS". Un MISS es operación normal: no cuenta como error (como `GET` de Redis devolviendo nil).
  - `meta.cacheOp = 'set'`: guarda la clave y responde 200.
  - Un request **sin `cacheOp`** (por ejemplo un `query Cache` escrito a mano) se trata como `get`.
- **Con salidas → read-through** (compatibilidad con diagramas viejos). Un HIT responde la Cache misma. Un MISS reenvía a su primera salida, y la respuesta que vuelve se **guarda** (en modo claves) y se reenvía hacia atrás. Al reenviar, la Cache **quita** `cacheOp` del meta (el destino de abajo recibe un request normal).

### 2.2 Modo

Campo **"Modo"**:

| Modo | HIT cuando | Campos visibles |
|---|---|---|
| **Claves reales** (default para Caches nuevas) | La clave está guardada y no venció | **Capacidad** (1–1000 claves, default 50), **TTL** (ms, 0 = no vence, default 0) |
| **Aleatorio** | `random() < Hit rate` | **Hit rate** (0–1, default 0.8) |

- **Clave:** `meta.cacheKey` si viene, si no `meta.path`, si no `'/'`.
- **Expulsión:** si la Cache está llena, sale la clave **menos usada recientemente** (LRU; un get con HIT la renueva).
- **TTL:** una clave vencida cuenta como MISS y se borra. Se mide en tiempo de simulación.
- **En modo Aleatorio,** `set` responde 200 sin guardar nada.
- **Grafos viejos:** una Cache sin `mode` se migra a **Aleatorio** al cargar, con el mismo `hitRate`. Así se comporta como antes.

Se mantienen `processingTime` (default 50) y el toggle Activo. Antes la Cache no tenía `up`; se agrega con default `true`. Si está caída responde 503, como cualquier componente con procesamiento. Al apagarla (Activo off) **pierde todas sus claves**, como un Redis que se reinicia (igual que `session memory`). Cambiar el Modo pone en cero el hit %.

### 2.3 Estado visible

El nodo muestra **🔑 N** (claves guardadas, solo en modo claves) y **hit % real** (HITs / (HITs + MISSes) desde el último reset).

Los llamadores distinguen HIT/MISS por `meta.cacheHit`, nunca por el código. Cualquier respuesta de error (503, cola llena) es una **falla de la Cache**.

## 3. Servicio sin DSL: cache-aside automático

Si un Servicio **sin comportamiento** tiene entre sus salidas al menos una Cache **hoja** (sin salidas):

1. Procesa (`processingTime`, igual que hoy).
2. Manda `get` a la Cache. Si hay varias Caches hoja, se usa la primera.
3. Según la respuesta:
   - **HIT:** responde 200 sin llamar al resto.
   - **MISS:** llama a sus **otras** salidas (las que no son Caches hoja) con el modo de siempre (paralelo o secuencial).
     - Si todas responden ok, manda `set` a la Cache **sin esperar** (fire-and-forget) y responde 200.
     - Si alguna falla, responde 502 y no escribe.
   - **Cache caída (503):** la ignora y sigue como MISS, pero sin `set`. Una cache caída no debe tirar el servicio.

Un Servicio sin Cache hoja sigue funcionando exactamente igual que hoy.

## 4. DSL: paso `cache`

```
on request /productos:
  cache Cache:              # get de la clave (path) en "Cache"
    query Base de datos     # solo si fue MISS
  reply 200                 # al salir del bloque tras un MISS (sin error), set de la clave
```

- **Sintaxis:** `cache <Destino> [mod]:` seguido de un bloque indentado obligatorio. Los modificadores son `or reply N` / `or continue`. `nowait` no aplica: da el error `cache-nowait`.
- **Destino:** una Cache conectada. Otro tipo da `wrong-verb` con sugerencia.
- **HIT:** se saltea el bloque y sigue.
- **MISS:** corre el bloque. Si termina sin error, manda `set` **sin esperar** (fire-and-forget) y sigue. Si un paso del bloque falla, el error se propaga como en cualquier paso y no se escribe.
- **Falla de la Cache** (caída o cola llena): falla del paso, 503 por default, o el modificador. Con `or continue` se trata como MISS: corre el bloque y no escribe.
- **Clave:** el `meta.path` del request que maneja el handler.
- **En `on event` / `on message`:** la clave es `meta.eventType` o el id del mensaje. Mismo comportamiento, poco común.
- **Validación:**
  - bloque vacío → `empty-block`;
  - destino no conectado → `not-connected`;
  - destino que no es Cache → `wrong-verb`.

## 5. Reverse Proxy: cache de borde

- `cacheHitRate` se reemplaza por **"Cache"**: **Apagada** (default), **Aleatoria** u **Claves reales**.
  - **Aleatoria** muestra **Hit rate**.
  - **Claves reales** muestra **Capacidad** y **TTL**, con la misma semántica que el componente.
- **Claves reales en el proxy:**
  - **HIT:** el proxy responde 200 con label "HIT".
  - **MISS:** rutea normalmente y, cuando la respuesta vuelve ok, guarda la clave (el path).
- **"Paths cacheables":** lista de prefijos. Solo los requests cuyo `path` empieza con alguno pasan por la cache; el resto va siempre al servicio.
  - **Lista vacía** = todos los paths. El inspector lo aclara con "vacío = todos".
  - **Proxies nuevos:** arrancan con `['/static']`.
- **Orden** sin cambios: rate limit → auth → cache → rutear.
- **Migración de grafos viejos:** `cacheHitRate > 0` → Cache **Aleatoria** con ese Hit rate y lista vacía (todos). Si no, **Apagada**. El campo viejo se descarta.

## 6. UI

- **Campos condicionales:** los campos se muestran según el modo elegido. El motor declara la condición en el campo (`showIf`).
- **Tipo de campo nuevo `list`** (lista de strings), con el editor de filas del Mix pero sin peso, para "Paths cacheables".
- **Contadores:** en Cache y en el proxy con cache en Claves reales, 🔑 claves y hit % real.
- **Info ⓘ:** se actualiza para Cache (cache-aside vs read-through, modos, LRU, TTL), Servicio (cache-aside automático), Reverse Proxy (paths cacheables) y DSL (`cache X:`).
- **Todo i18n.**

## 7. Presets

- **"Cache" (nuevo):**
  - Cliente con Mix de 10 paths `/productos/1` … `/productos/10` y tasa 0 (`demoRates`).
  - Servicio sin DSL, con salidas a **Cache** (Claves reales, Capacidad 5) y **Base de datos** (relacional).
  - Muestra el warm-up, los MISS por expulsión (10 claves y capacidad 5) y la carga de la base. Subiendo la Capacidad a 10, la base casi no recibe nada.
- **"Proxy reverso":** Cache en **Claves reales**, Paths cacheables `['/static']`. Web se cachea; Pagos, nunca.

## 8. Fuera de alcance

- Métodos HTTP (GET/POST): la cacheabilidad se decide por path.
- Invalidación explícita (borrar claves al escribir).
- Datos viejos / consistencia.
