# DSL de arquitectura — Spec

> Decisiones del 2026-10-26. Complementa `docs/spec.md` y `docs/dsl-spec.md`; si algo cambia, se cambia primero acá.

## 1. Qué es

Un formato de texto para **describir un grafo entero** (nodos, configuración, conexiones y comportamiento), inspirado en PlantUML. El objetivo principal es que sea **fácil de escribir a mano**: armar un escenario en un editor de texto, pegarlo en un issue o pedírselo a un LLM.

- **Exportar** genera este texto. **Importar** acepta este texto o el JSON de antes.
- El JSON sigue siendo el formato interno: `localStorage` y el link `#g=` no cambian.
- Las palabras clave están en inglés, igual que en el DSL de comportamiento. Los nombres de los nodos son libres.

## 2. Ejemplo

```
# Orquestación de una compra

client Web
  rate: 2
  mix: /ordenes x3, /productos

service Órdenes
  capacity: 16
  queueMax: 20
  behavior:
    on request /ordenes:
      call Stock /reservas
      call Pagos /cobros or reply 402
      reply 201

service Stock, Pagos
  capacity: 4
database DB Stock, DB Pagos

Web --> Órdenes --> Stock, Pagos
Stock --> DB Stock
Pagos --> DB Pagos
```

Con rutas, eventos y pesos:

```
client Web
reverse-proxy Gateway
load-balancer LB
  algorithm: weighted
service Usuarios
service API A, API B
broker Eventos
subscriber Mails

Web --> Gateway --> Usuarios [/usuarios], LB [/api]
LB --> API A [x3], API B
API A --> Eventos --> Mails [UsuarioCreado]
```

## 3. Gramática

- Una línea por sentencia. Las líneas en blanco se ignoran.
- **Comentarios:** `#` al principio de la línea, o `#` seguido de espacio o de fin de línea en cualquier lugar. Así `color: #3b82f6` no es un comentario. Dentro de un bloque `behavior:` el texto pasa tal cual al DSL de comportamiento, que tiene sus propias reglas.
- **Indentación:** de 2 espacios, sin tabs, igual que el DSL de comportamiento. Un tab es error.
- `@architecture v1` en la primera línea es **opcional**: si falta se asume `v1`. El export siempre lo escribe.

```
archivo     := ['@architecture' versión] sentencia*
sentencia   := declaración | conexión
declaración := tipo nombres (['as' alias] ['at' col ',' fila], en cualquier orden)
               (bloque de 'clave: valor', indentado 2 espacios)
nombres     := nombre (',' nombre)*
conexión    := grupo ('-->' grupo)+
grupo       := destino (',' destino)*
destino     := ref ['[' atributos ']']
ref         := alias | nombre
```

- **Nombre:** el resto del texto hasta `,`, `as`, `at`, `-->`, `[` o el fin de línea, sin espacios en los bordes. Puede tener espacios (`DB Stock`). Si contiene alguno de esos separadores, va entre comillas: `"Pagos, Cobros"`. Las comillas siempre se pueden usar.
- Una línea que contiene `-->` es una conexión. Si no, es una declaración y su primera palabra tiene que ser un tipo.

## 4. Tipos

| Palabra | Atajo | Componente |
|---|---|---|
| `client` | — | Cliente |
| `service` | — | Servicio |
| `database` | `db` | Base de datos |
| `load-balancer` | `lb` | Load Balancer |
| `reverse-proxy` | `proxy` | Reverse Proxy |
| `cache` | — | Cache |
| `queue` | — | Cola |
| `worker` | — | Worker |
| `dlq` | — | DLQ |
| `broker` | — | Broker |
| `subscriber` | — | Suscriptor |

- Son los `type` del registro (`src/components`). El export escribe siempre la palabra completa.
- **Varios nombres en una declaración** (`service Stock, Pagos`) crean un nodo por nombre. El bloque de configuración se aplica a todos. Con varios nombres no se permiten `as` ni `at` (error `multi-alias`). `as` y `at` pueden ir en cualquier orden (el export escribe `as` y después `at`). El nombre termina en el primer `[` sin comillas: `service A [x]` es un `bad-attribute`. Un nombre vacío se escribe entre comillas (`service ""`); sin comillas es `missing-name`.

## 5. Nombres y alias

- **El nombre identifica al nodo.** Las conexiones lo referencian por nombre, y el DSL de comportamiento también (`call Stock /reservas`).
- **Si dos nodos se llaman igual**, al menos uno necesita un alias: `service Órdenes as ord2`. En las conexiones, el alias se busca primero y después el nombre. Si un nombre corresponde a más de un nodo y no hay alias que lo desambigüe, el error es `ambiguous-ref`.
- **Ids:** el id de cada nodo es su alias o, si no tiene, un slug de su nombre (`DB Stock` → `db-stock`, con sufijo `-2`, `-3` si se repite). El id de cada conexión es `<origen>-<destino>`, igual que en `presets/helpers.ts`.
- **El export** escribe `as` solo en los nodos que comparten nombre, usando su id como alias.

## 6. Configuración

Cada línea indentada debajo de una declaración es `clave: valor`. La clave es el nombre del campo en el código (`processingTime`, `queueMax`, `cacheablePaths`…). **Lo que no se escribe toma el default** del componente, igual que `node()` en los presets.

| Tipo de campo | Sintaxis | Ejemplo |
|---|---|---|
| number | número; acepta el sufijo de su unidad | `processingTime: 400ms`, `rate: 5`, `failRate: 0.1` |
| boolean | `true`/`false`, o `on`/`off` | `sticky: true`, `up: off` |
| select | el valor de la opción | `algorithm: least-connections` |
| text | el resto de la línea (comillas opcionales) | `emits: PagoAprobado` |
| color | `#rrggbb` | `color: #d97706` |
| list | elementos separados por coma | `cacheablePaths: /static, /img` |
| mix | `valor [xPeso]` separados por coma (peso default 1) | `mix: /ordenes x3, /productos` |
| behavior | `behavior:` y un bloque indentado debajo | ver el ejemplo de §2 |

- **`behavior:`** abre un bloque que termina en la primera línea con la misma indentación que la clave, o menos. Las líneas se guardan sin la indentación común, con `\n` al final.
  - Los errores **dentro** del DSL de comportamiento no son errores de import: el nodo se carga igual y muestra el badge "⚠ DSL", como hoy.
- **`name`** no se escribe como clave: va en la declaración.
- **Cliente:** si faltan `ip` o `color`, se asignan como hoy al cargar un grafo (`backfillClients`).

## 7. Conexiones

- **Cadena:** `A --> B --> C` crea A→B y B→C.
- **Fan-out y fan-in:** cada lado puede ser una lista. `A --> B, C` crea A→B y A→C. `A, B --> C` crea A→C y B→C.
- **Atributos** entre `[...]` después del destino, separados por espacio o coma:

| Atributo | Forma corta | Forma larga | Resultado |
|---|---|---|---|
| Prefijo de path | `[/api]` | `[path /api]` | `rule: { kind: 'pathPrefix', value: '/api' }` |
| Tipo de evento | `[OrdenCreada]` | `[event OrdenCreada]` | `rule: { kind: 'eventType', value: 'OrdenCreada' }` |
| Peso | `[x3]` | `[weight 3]` | `weight: 3` |

- **La forma corta se deduce:** si empieza con `/` es un path, `xN` es un peso y cualquier otra cosa es un evento. Para un evento que se llame literalmente `x3` está la forma larga.
- Se puede combinar una regla con un peso: `[/api x3]`. Dos reglas en la misma conexión son error (`duplicate-rule`).
- Los atributos van en el destino. En una cadena, `A --> B [/x] --> C` le aplica la regla a A→B.
- La misma conexión escrita dos veces es error (`duplicate-edge`). Una conexión puede referenciar un nodo declarado más abajo.

## 8. Posiciones y layout automático

- **`at col,fila`** usa la grilla de los presets: `x = col × 250`, `y = fila × 120` (`COL`/`ROW`, que pasan a `src/persistence`). Admite decimales: `at 3,3.75`.
- **Sin `at`, el import acomoda los nodos solo**:
  1. **Columna = capa:** el camino más largo desde un nodo sin entradas. Los ciclos se cortan ignorando las aristas hacia atrás de un DFS que recorre en orden de declaración.
  2. **Fila:** orden de declaración dentro de la columna, más una pasada de baricentro respecto de la columna anterior para reducir cruces.
  3. Los nodos aislados quedan en la columna 0, debajo del resto.
- **Mezcla:** los nodos con `at` quedan donde dicen. Los que no tienen `at` toman su columna del layout y la primera fila libre de esa columna.
- **El export** escribe siempre `at`, con col y fila redondeadas a 2 decimales (2,5 px × 1,2 px), para que reimportar no mueva el diagrama.

## 9. Export

Texto canónico, estable y fácil de diffear:

1. `@architecture v1` y una línea en blanco.
2. **Una declaración por nodo**, en el orden del grafo, con `at` y solo los campos distintos del default, en el orden del registro. Una línea en blanco entre nodos que tienen bloque de configuración.
3. **Una línea de conexiones por origen** (`A --> B, C [/x]`), en el orden de la primera conexión de cada origen. No se arman cadenas.
4. **Nombres entre comillas** solo si hace falta (§3).

Archivo: `arquitectura.arch` / `architecture.arch` (i18n `toolbar.exportFilename`).

**Ida y vuelta:** `parse(print(g))` es igual a `g` salvo los ids (§5), el redondeo de las posiciones (§8) y los campos de config desconocidos para el registro, que se descartan. Se prueba con todos los presets.

## 10. Import

- **Detección:** si el primer carácter que no es espacio es `{`, el archivo es JSON (`parseGraph`). Si no, es este DSL.
- **Resultado:** un `Graph` que pasa por `prepareGraph` como cualquier otra entrada.
- **Errores:** el import es todo o nada. Si hay errores, el grafo actual no cambia. Cada error tiene un código (`errors.<code>` en i18n), la línea y parámetros:

| Código | Ejemplo de mensaje |
|---|---|
| `tab` / `bad-indent` | `línea 4: indentación inválida` |
| `unknown-type` | `línea 2: "servise" no es un tipo, ¿quisiste decir "service"?` |
| `unknown-key` | `línea 5: "capacty" no existe en service, ¿quisiste decir "capacity"?` |
| `bad-value` | `línea 6: "rápido" no es un número` / `algorithm: opciones: round-robin, …` |
| `out-of-range` | `línea 6: capacity va de 1 a 50` |
| `unknown-ref` | `línea 12: "Stok" no está declarado, ¿quisiste decir "Stock"?` |
| `ambiguous-ref` | `línea 12: hay dos nodos "Órdenes"; usá "as"` |
| `duplicate-alias` / `duplicate-edge` / `duplicate-rule` | — |
| `multi-alias` | `línea 3: "as" y "at" no van con varios nombres` |
| `missing-colon` | `línea 5: falta ":" (clave: valor)` |
| `duplicate-key` | `línea 7: "capacity" ya está definido` |
| `missing-name` / `bad-attribute` / `unknown-version` | — |

- **Sugerencias:** si la distancia de Levenshtein es de 2 o menos, se sugiere el tipo, la clave o el nombre más parecido.
- Si hay errores, la UI muestra **todos**, no solo el primero.

## 11. UI

- **Exportar:** baja el `.arch`.
- **Importar:** acepta `.arch`, `.txt` y `.json`. Si un archivo DSL tiene errores, se abre el popup "Texto" con ese contenido y todos sus errores, para corregirlo ahí. Un JSON inválido muestra el toast de siempre.
- **Finales de línea:** se aceptan CRLF y un BOM inicial.
- **Nuevo botón "Texto"** en la Toolbar: abre un popup con el grafo actual escrito en el DSL.
  - Es un textarea monoespaciado con números de línea.
  - Los errores se ven en vivo debajo (`línea N: …`).
  - **"Aplicar"** reemplaza el grafo y cuenta como **un solo paso de Deshacer**. Con errores, el botón queda deshabilitado.
  - **"Cancelar"** o Esc cierran sin cambios.
  - Reusa el `Modal` y el patrón de `BehaviorEditor`. Es la forma principal de "escribir" un escenario.
- Todo con i18n (es/en). Las palabras clave son las mismas en los dos idiomas.

## 12. Implementación

- `src/persistence/dsl/`: `parse.ts` (texto → `Graph` + errores), `print.ts` (`Graph` → texto), `layout.ts` (auto-layout). Las tres partes son puras.
- `serialize.ts` mantiene `parseGraph` para JSON. Se agrega `parseAny(text)`, que detecta el formato.
- **Tests:**
  - round-trip de todos los presets
  - cada código de error
  - layout de cadenas, fan-out y ciclos
  - mezcla de nodos con y sin `at`
  - `behavior` con varios niveles de indentación
  - `#` en colores frente a comentarios

## 13. Fuera de alcance

- Exportar a PlantUML real para renderizar diagramas. Es una feature aparte, solo de salida.
- Resaltado de sintaxis y autocompletado en el popup.
- Conservar los comentarios de nivel grafo al reexportar.
- Usar el DSL en `localStorage` o en el link `#g=`.
