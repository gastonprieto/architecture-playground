# DSL de comportamiento — Spec

> Decisiones del grilling del 2026-10-21. Complementa `docs/spec.md`; si algo cambia, se cambia primero acá.

## 1. Qué es

Un lenguaje de texto chico para describir **qué hace un componente con lo que recibe**. Cada línea es un paso: llamar a otro servicio, consultar la base, encolar, publicar un evento, responder.

Sirve para armar escenarios que hoy no se pueden expresar: orquestación vs coreografía, sagas, fan-out, fallbacks, degradación y fallas parciales.

- **Dónde:** campo `behavior` (texto) en **Servicio, Worker y Suscriptor**.
- **Vacío = comportamiento actual** (llamar a todas las salidas, etc.), así los presets y grafos existentes no cambian.
- **Con DSL válido, el DSL manda:** reemplaza el comportamiento por defecto, incluido el campo "Emite evento" del Suscriptor.
- **Con DSL inválido:** el componente sigue con el comportamiento por defecto y el nodo muestra un badge "DSL con errores". Así un typo no rompe la demo en vivo.

## 2. Ejemplo

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

## 3. Gramática

- Una línea por instrucción. Los comentarios empiezan con `#` y van hasta el final de la línea. Las líneas en blanco se ignoran.
- Los bloques van **por indentación de 2 espacios**, sin llaves ni tabs: un tab es error.
- Las palabras clave van en minúscula.

```
programa  := handler*
handler   := 'on' ( 'request' [prefijo] | 'event' [Tipo] | 'message' ) ':'  bloque
bloque    := paso+                         (indentado 2 espacios más que su cabecera)
paso      := 'call'    destino path  [mod]
           | 'query'   destino       [mod]
           | 'enqueue' destino       [mod]
           | 'publish' Tipo          [mod]
           | 'parallel:' bloque
           | 'wait'  ms
           | 'fail'  N'%' [código]
           | 'reply' código
           | 'session' ( 'memory' | 'jwt' | destino ) [mod]   (mod sin nowait)
mod       := 'nowait' | 'or' 'reply' código | 'or' 'continue'
destino   := nombre de un nodo conectado (resto de la línea hasta un path o modificador; comillas opcionales)
path      := token que empieza con '/'
```

## 4. Handlers

| Handler | Se dispara con | Selección |
|---|---|---|
| `on request [/prefijo]` | requests | Gana el **prefijo más largo** que matchee `meta.path` (misma regla que el Reverse Proxy). `on request` sin path es el default. Si nada matchea → **404**. |
| `on event [Tipo]` | eventos (de un Broker) | Match exacto de `meta.eventType`; sin tipo es el default. Si nada matchea → **ack** silencioso. |
| `on message` | mensajes (de una Cola) | Uno solo. Si no hay → **ack**. |

- Cualquiera de los tres componentes puede declarar cualquier handler. Por ejemplo, un Servicio puede tener `on event` y suscribirse a un Broker.
- Dos handlers iguales (mismo verbo y mismo prefijo o tipo) son error de validación.

## 5. Pasos

| Paso | Destinos válidos | Qué hace | ¿Espera? |
|---|---|---|---|
| `call X /path` | Servicio, Load Balancer, Reverse Proxy | Request hijo con `meta.path = /path`. El path es **obligatorio**. | Sí, la respuesta |
| `query X` | Base de datos, Cache | Request hijo, sin path. | Sí, la respuesta |
| `enqueue X` | Cola | Request a la Cola, que responde 202 y encola. | Sí, solo el 202 |
| `publish Tipo` | todos los Broker conectados | Request a cada Broker con `meta.eventType = Tipo`, que responde 202 y hace fan-out. | Sí, solo el 202 de cada uno |
| `parallel:` | — | Corre sus pasos a la vez y sigue cuando **todos** terminaron. | Sí |
| `wait ms` | — | Espera `ms` de simulación, ocupando el slot. | Sí |
| `fail N% [código]` | — | Con probabilidad N%: corta el handler con `código` (default 500). En `on event` y `on message` es un **nack**. | — |
| `reply código` | — | Responde y **termina** el handler. `código < 400` es ok y si no, error. En eventos y mensajes es ack o nack. | — |
| `session memory \| jwt \| X` | `memory`, `jwt` o una Base de datos conectada | Verifica la sesión del request ([sesiones](sessions-spec.md#4-dsl-paso-session)): cookie válida → sigue; cookie desconocida → **401** `session-lost`; sin cookie y con credenciales → login (crea la sesión y la respuesta final lleva `setSession`); sin nada → **401** `unauthenticated`. Con `memory` la sesión vive en el componente; con `X`, en la base (ida y vuelta); con `jwt`, en el token (no se puede revocar). En eventos y mensajes se ignora. No admite `nowait`. | Sí, con una base |

**Sin `reply`:** al llegar al final del handler se responde **200** a un request, o ack a un evento o mensaje.

### Errores de un paso y modificadores

- **Por defecto:** si `call`, `query`, `enqueue` o `publish` vuelve con error, el handler **corta y responde 502**. En `on event` y `on message` hace nack.
- **`or reply N`:** si falla, responde N y termina.
- **`or continue`:** si falla, sigue con el paso siguiente.
- **`nowait`:** no espera la respuesta ni el 202: sigue enseguida y el resultado se ignora cuando llega. Combinarlo con `or ...` es error de validación, porque `nowait` ya ignora el resultado.
- **Dentro de `parallel:`:** un paso que falla sin modificador marca el bloque como fallido. El bloque espera a todos y después responde 502.
- **`session` contra una base que falla** (caída, cola llena): el paso falla con **503** por default (acepta `or reply N` / `or continue`). A diferencia de `call`, dentro de `parallel:` ese 503 **termina el handler enseguida**, sin esperar al resto del bloque. Los `401` de sesión también terminan el handler.

**`call X nowait` vs `enqueue X`:** los dos "no esperan", pero con `nowait` el request **se pierde** si X está caído o saturado. Con `enqueue`, la Cola lo guarda y lo reintenta. Esta diferencia es una lección de la charla.

## 6. Ejecución y capacidad

- El handler corre **dentro de un slot de capacidad** del componente: entra, ocupa un slot, espera `processingTime` (espera implícita inicial), ejecuta los pasos y libera el slot al terminar (al hacer `reply` o al llegar al final).
- Cola interna, `queueMax`, up/down y 503 funcionan igual que hoy.
- Los mensajes hijos copian el `meta` del mensaje original (color del cliente, IP, etc.). `call` pisa `path` y `publish` pisa `eventType`.
- **Requests hijos:** cada uno tiene `parentId = id del mensaje original`. Las respuestas que llegan para un handler que ya terminó, como en `nowait`, se descartan sin efecto.
- `fail N%` usa el RNG con seed de la simulación, así que es determinístico.

## 7. Validación

La validación es **pura**: recibe el texto y la lista de salidas conectadas (`{ nombre, tipo }`) y devuelve el programa y los errores con número de línea. Se usa en el inspector (en vivo) y en el motor (al cargar la config).

**Errores** (texto i18n, con línea):

- Sintaxis:
  - indentación inválida o tab
  - palabra desconocida
  - `:` faltante
  - número inválido
  - `fail` fuera de 0–100
  - código fuera de 100–599
- `call` sin path.
- Destino no conectado: `"Pagos" no está conectado`.
- Nombre ambiguo: dos salidas con el mismo nombre.
- Verbo incorrecto para el tipo de destino, con sugerencia:
  - `call Base de datos` → "¿quisiste decir query?"
  - `query Pagos` → "¿quisiste decir call?"
  - `call Cola` → "¿quisiste decir enqueue?"
- `publish` sin ningún Broker conectado.
- `nowait` combinado con `or`.
- Handler duplicado.

Si no hay errores, el programa queda activo. Si hay al menos uno, se ignora el DSL completo (comportamiento por defecto) y aparece el badge.

## 8. UI

- **Inspector:** el Servicio, Worker o Suscriptor muestra un resumen del comportamiento ("Por defecto", "2 handlers" o "⚠ 1 error") y un botón **"Editar comportamiento"**.
- **Popup del editor:**
  - textarea monoespaciado con números de línea
  - errores en vivo debajo (`línea 3: …`)
  - botón **"Insertar ejemplo"**, con template según el tipo de componente
  - referencia del DSL al costado (la misma que se ve en el ⓘ)
- **Cierre:** **Guardar** / **Cancelar**; Esc cancela.
  - Se puede guardar con errores.
  - Cada guardado es **un solo paso de Deshacer**.
  - El popup bloquea el fondo y maneja el teclado igual que el panel de info.
- **Badge en el nodo:** "DSL" cuando hay un comportamiento activo y "⚠ DSL" cuando tiene errores.
- **Todo i18n (es/en),** incluidos los mensajes de error. Las palabras clave del DSL son las mismas en ambos idiomas, en inglés.

## 9. Preset "Orden de compra"

Dos carriles que comparan orquestación con coreografía:

1. **Orquestación:**
   - Cliente → Órdenes, con `call Stock /reservas`, `call Pagos /cobros or reply 402` y `call Mails /enviar nowait`.
   - Cada uno de Stock, Pagos y Mails hace `query` a su Base de datos.
2. **Coreografía:**
   - Cliente → Órdenes, con `query Base de datos`, `publish OrdenCreada` y `reply 202`.
   - Broker → Stock, Pagos y Mails, cada uno con `on event OrdenCreada:` y su `query`.

Los nombres se traducen en EN. El DSL usa los nombres de cada idioma, porque los destinos se referencian por nombre.

## 10. Fuera de alcance

- `if` generales, variables, loops y timeouts.
- Autocompletado y resaltado de sintaxis.
- Sesiones: van después, con una primitiva `session`; ver el roadmap.
