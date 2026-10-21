# Sesiones y autenticación — Spec

> Decisiones del grilling del 2026-10-21. Se apoya en `docs/spec.md` y `docs/dsl-spec.md`. Si algo cambia, se cambia primero acá.

## 1. Qué es

Permite modelar **dónde vive la sesión de un usuario** y **quién autentica**, para mostrar en vivo los escenarios del deck de load balancer:

- **Sesión en memoria del servidor.** Un LB round robin produce 401 constantes. Con sticky funciona, hasta que se cae un servidor.
- **Sesión en un store compartido (una base de datos).** Cualquier servidor atiende a cualquier usuario. Si el store es clave-valor y se reinicia, las sesiones se pierden.
- **JWT.** No necesita store ni sticky. La sesión no se puede revocar (fuera de alcance, se menciona en el ⓘ).
- **Auth en el API gateway.** Los clientes sin credenciales se cortan en la puerta con 401.

## 2. Cliente

**Campos nuevos:**

- **"Usuarios"**: número de 1 a 50, default 1. El Cliente reparte sus mensajes entre sus usuarios en orden (round robin).
  - Cada usuario tiene **su propia cookie** de sesión.
  - Cada usuario tiene su propia identidad para el IP Hash: `meta.clientIp = "<ip>#<k>"` (k de 1 a N) cuando Usuarios > 1. Con 1 usuario la IP queda igual que hoy.
- **"Autenticación"**:
  - **Con login** (default): el request lleva `meta.credentials = true` y, si el usuario tiene cookie, `meta.sessionId`.
  - **Sin credenciales**: el request no lleva credenciales ni cookie, nunca.

**Respuestas:**

- Si la respuesta trae `meta.setSession`, el Cliente guarda esa cookie para el usuario que hizo el request. El usuario se identifica con `meta.userIndex`.
- Si la respuesta es un **401 con `meta.authError = 'session-lost'`**, el Cliente borra la cookie de ese usuario. Su próximo request vuelve a loguearse, porque manda credenciales sin cookie.
- Un 401 `unauthenticated` no cambia nada: el Cliente sin credenciales sigue recibiendo 401.

**Contador:** el nodo Cliente muestra **"🍪 logueados/N"** cuando hay al menos un usuario logueado o tiene más de un usuario (Usuarios > 1). Un Cliente de un solo usuario sin cookie no muestra nada, para no ensuciar los grafos que no usan sesiones.

## 3. Motor: respuesta con meta

`ctx.reply(msg, { status, code, meta? })` acepta un parche de `meta` que se aplica sobre la respuesta, por ejemplo `setSession` o `authError`.

Las respuestas viajan salto a salto y conservan su `meta`, así un LB o un proxy en el camino puede leerla (para sticky o para emitir un JWT).

## 4. DSL: paso `session`

```
session memory
session jwt
session <Base de datos>      # nombre de una base conectada (comillas opcionales)
```

**Semántica** (para un request; en eventos y mensajes el paso se ignora y sigue):

| Situación | Resultado |
|---|---|
| Hay cookie válida | sigue |
| Hay cookie, pero no existe en ese almacenamiento (o es de otro tipo, p. ej. un `sid` en `jwt`) | **401** `authError: 'session-lost'` y termina el handler |
| No hay cookie, hay credenciales | **login**: crea la sesión, la guarda y sigue; la respuesta final del handler lleva `setSession` |
| No hay cookie ni credenciales | **401** `authError: 'unauthenticated'` y termina el handler |
| La base no responde (caída, cola llena) | **falla el paso**: 503 por default; acepta `or reply N` / `or continue` como `call` |

**Almacenamiento:**

- **`memory`:** el conjunto de sesiones vive en el estado del componente (Servicio, Worker o Suscriptor). Se **vacía** cuando el componente pasa a Activo = off. Si el nodo se borra, también se pierde.
- **`<Base de datos>`:**
  - Un request al nodo base con `meta.sessionOp = 'check' | 'create'` y `meta.sessionId`. Ida y vuelta: dos saltos más el `processingTime` de la base.
  - La base responde 200 (existe o creada) o 404 (no existe).
  - Destino válido: solo componentes de tipo `database`. Usar otro tipo da `wrong-verb` / `session-target`.
- **`jwt`:**
  - El token es `jwt:<id>`. Cualquier token con prefijo `jwt:` es válido: la firma se simula y es compartida.
  - No hay almacenamiento ni salto de red.
  - Una cookie `sid:` (de memoria o de base) en un servicio `jwt` es inválida y da `session-lost`.

**Ids de sesión:** `sid:<id del mensaje>` para memoria y base, `jwt:<id del mensaje>` para jwt. Son determinísticos.

**Validación:**

- `session` sin destino: error.
- Destino que no es `memory`, `jwt` ni una base conectada: `not-connected` o `wrong-verb`.
- Dos pasos `session` en el mismo handler: permitido, aunque no tiene sentido.

**Labels:** en un 401 de sesión, el label flotante muestra `401` como cualquier error. El tipo de error se ve en la info y en la meta.

## 5. Base de datos: tipo y sesiones

**Campo "Tipo":**

| Tipo | Ícono | `processingTime` sugerido | Volátil |
|---|---|---|---|
| Relacional (default) | 🗄️ | 300 ms | no |
| Clave-valor | 🗝️ | 20 ms | **sí** |
| Documental | 📄 | 80 ms | no |

- **Al cambiar el Tipo** en el inspector se aplica el `processingTime` sugerido. Si el `processingTime` actual no coincidía con el sugerido del tipo anterior (porque lo editó el usuario), no se pisa.
- **El nodo muestra** el ícono del tipo y "Base de datos · \<tipo\>" como subtítulo.
- **Los grafos existentes** no tienen el campo, así que se comportan como Relacional.

**Sesiones:**

- La base guarda un conjunto de sesiones en su estado y atiende `sessionOp`. Una `query` normal sigue igual que hoy.
- **Volatilidad:** si es **clave-valor** y pasa de Activo = off a on, **pierde sus sesiones**. Relacional y Documental las conservan.
- Mientras está caída responde 503, como hoy.
- El nodo muestra **🍪 N** cuando guarda sesiones.

## 6. Servicio con `session memory`

El nodo muestra **🍪 N** con las sesiones que tiene en memoria (solo en Servicio: Worker y Suscriptor nunca atienden requests, así que nunca guardan sesiones).

**Sin expiración:** las sesiones viejas no se borran nunca (no hay TTL), así que los contadores 🍪 de servicios y bases solo crecen. Y los requests que ya salieron sin cookie antes de que vuelva la del login se loguean cada uno por su lado, así que la cuenta puede pasar momentáneamente la cantidad de usuarios.

## 7. Load Balancer: sticky sessions

Toggle **"Sticky sessions"**, default off.

- Cuando una respuesta que pasa por el LB trae `setSession`, el LB recuerda **`sessionId → servidor`**, es decir, el servidor que respondió.
- Un request con `sessionId` conocido va a ese servidor si sigue entre los destinos disponibles (aplicando health checks si están activos).
- Si ese servidor no está disponible, se elige con el algoritmo y se actualiza el mapa. Con sesión en memoria, eso termina en 401 `session-lost` y re-login.
- Un request sin cookie usa el algoritmo normal.
- Sticky va por cookie; IP Hash, por IP. Se pueden combinar: sticky manda si hay cookie conocida.

## 8. Reverse Proxy: autenticación

Se **elimina** "Rechazo auth" (`authFailRate`). En su lugar va el select **"Autenticación"**:

- **Ninguna** (default): deja pasar todo.
- **Credenciales:** si el request no tiene `credentials` ni `sessionId`, responde **401 `unauthenticated`** sin rutear. Si no, rutea.
- **JWT:**
  - **Sin credenciales ni token:** 401 `unauthenticated`.
  - **Con token `jwt:`:** pasa.
  - **Con credenciales y sin token:** pasa, y el proxy **emite el token** en la respuesta (agrega `setSession: 'jwt:<id>'` al pasar la respuesta de vuelta).
  - **Cookie `sid:`:** se trata como sin token. Si hay credenciales, emite un JWT nuevo.

**Grafos viejos:** un `authFailRate > 0` se migra a `auth: 'credentials'` al cargar el grafo (boot, link, import, preset). El campo viejo se descarta.

El orden en el proxy sigue siendo: rate limit → auth → cache → rutear.

## 9. UI

- **Campos nuevos en el inspector** (todo i18n):
  - Cliente: Usuarios, Autenticación.
  - Base de datos: Tipo.
  - LB: Sticky sessions.
  - Proxy: Autenticación.
- **Ícono del nodo:** se puede derivar del config, con `iconFor(config)` opcional en `ComponentDef`. La paleta usa el ícono base.
- **Contadores 🍪:** en Cliente (logueados/N, si hay alguien logueado o Usuarios > 1), Servicio con `session memory` y Base de datos (si guarda sesiones).
- **Info ⓘ:** se actualiza para Cliente, Base de datos, LB, Proxy, Servicio, Worker y Suscriptor (paso `session`). La referencia del DSL suma `session`, y el panel cuenta la limitación de JWT (no revocable).

## 10. Presets

- **"Sesiones" (nuevo):** tres carriles. Cada uno tiene un Cliente con 5 usuarios con login, un LB round robin sin sticky y con health checks, y 3 servicios. Los health checks están prendidos para que, con sticky y un servidor apagado, sus usuarios reciban un 401 `session-lost` y se vuelvan a loguear en otro (en lugar de 503 sin fin). La tasa de demo es 1 req/s por cliente: cada usuario manda su próximo request después de que volvió la cookie de su login, también en el carril store (que tarda más por la ida y vuelta a la base), así el store termina con exactamente una sesión por usuario. Son 5 y no 6 a propósito: con un número de usuarios múltiplo de los servidores, el round robin del Cliente y el del LB se alinean y cada usuario cae siempre en el mismo servidor (sticky por casualidad), así que el carril de memoria no mostraría ningún 401:
  1. **Memoria:** `session memory`.
  2. **Store:** `session Sesiones`, contra una Base de datos clave-valor compartida llamada "Sesiones" / "Sessions".
  3. **JWT:** `session jwt`.
- **"Proxy reverso":** se suma un Cliente **sin credenciales** y el proxy queda con Autenticación = Credenciales.
- **Clientes en 0 req/s**, con `demoRates`, como el resto.

## 11. Fuera de alcance

- TTL y expiración, logout, revocación de JWT.
- "% sin credenciales" dentro de un Cliente.
- Sesiones en eventos y mensajes.
