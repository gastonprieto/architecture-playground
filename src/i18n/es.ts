/**
 * Spanish UI copy. This is the reference dictionary: `en` must have exactly the same keys
 * (`Dict = typeof es`), and any key missing at runtime falls back to this one.
 */
export const es = {
  app: {
    title: 'Architecture Playground',
  },
  lang: {
    label: 'Idioma',
    es: 'Español',
    en: 'Inglés',
  },
  toolbar: {
    play: '▶ Play',
    pause: '⏸ Pausa',
    playTitle: 'Espacio',
    step: 'Paso',
    stepTitle: 'Avanzar 100 ms',
    reset: 'Reset',
    speedTitle: 'Velocidad (teclas - y +)',
    presets: 'Presets',
    presetsPlaceholder: 'Presets…',
    undo: 'Deshacer',
    redo: 'Rehacer',
    export: 'Exportar',
    import: 'Importar',
    copyLink: 'Copiar link',
    clearAll: 'Limpiar todo',
    cleared: 'Canvas vacío · Deshacer lo recupera',
    linkCopied: 'Link copiado',
    exportFilename: 'arquitectura.json',
  },
  errors: {
    'invalid-json': 'JSON inválido',
    'unknown-format': 'Formato no reconocido',
    'dangling-edge': 'La arista {edgeId} apunta a un nodo inexistente',
  },
  palette: {
    title: 'Componentes',
    dragHint: 'Arrastrá {label} al canvas',
  },
  inspector: {
    label: 'Inspector',
    help: 'Arrastrá componentes desde la izquierda y conectalos. Seleccioná uno para configurarlo.',
    connection: 'Conexión',
    rule: 'Regla',
    noRule: 'Sin regla',
    pathPrefix: 'Path empieza con',
    eventType: 'Tipo de evento',
    value: 'Valor',
    pathPlaceholder: '/ordenes',
    eventPlaceholder: 'order.created',
    delete: 'Borrar',
    weights: 'Pesos',
    weightsHint: 'Los números son relativos: lo que cuenta es el % de tráfico que recibe cada conexión.',
    weightsEmpty: 'Conectá el Load Balancer a sus destinos para repartir pesos.',
    weight: 'Peso',
    unknownType: 'Tipo desconocido: {type}',
  },
  widgets: {
    slider: '{label} (deslizador)',
    mixValue: 'Valor {n}',
    mixWeight: 'Peso {n}',
    remove: 'Quitar',
    add: 'Agregar',
  },
  node: {
    unknown: 'Desconocido',
    down: 'caído',
    inFlight: 'En proceso',
    queued: 'En cola',
    ok: 'OK',
    errors: 'Errores',
  },
  metrics: {
    label: 'Métricas',
    throughput: 'Throughput',
    errors: 'Errores',
  },
  /** React Flow's built-in aria labels and screen-reader descriptions. */
  reactflow: {
    nodeDescription: 'Presioná Enter o Espacio para seleccionar un nodo. Presioná Suprimir para borrarlo y Escape para cancelar.',
    nodeDescriptionKeyboard:
      'Presioná Enter o Espacio para seleccionar un nodo. Después podés moverlo con las flechas. Presioná Suprimir para borrarlo y Escape para cancelar.',
    nodeMoved: 'Nodo seleccionado movido hacia {direction}. Nueva posición, x: {x}, y: {y}',
    edgeDescription: 'Presioná Enter o Espacio para seleccionar una conexión. Después podés presionar Suprimir para borrarla o Escape para cancelar.',
    controls: 'Panel de control',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fitView: 'Ajustar a la vista',
    interactive: 'Activar/desactivar interacción',
    minimap: 'Minimapa',
    handle: 'Conector',
  },
  /** Fields shared by many components: the injected `name` and processingFields. */
  fields: {
    name: 'Nombre',
    up: 'Activo',
    processingTime: 'Tiempo de proceso',
    capacity: 'Capacidad',
    queueMax: 'Cola máx.',
    behavior: 'Comportamiento',
  },
  /** Names of the Cliente palette colors (swatch labels). */
  colorNames: {
    '3b82f6': 'Azul',
    d97706: 'Ámbar',
    ec4899: 'Rosa',
    c4b5fd: 'Lavanda',
    fdba74: 'Durazno',
    d946ef: 'Fucsia',
  },
  /** Info panel: one-line help for the shared fields, and the panel's own texts. */
  fieldInfo: {
    name: 'Cómo se llama en el canvas.',
    up: 'Apagado, el componente está caído y rechaza con `503`.',
    processingTime: 'Cuánto tarda en procesar cada mensaje.',
    capacity: 'Cuántos mensajes procesa a la vez.',
    queueMax: 'Cuántos pueden esperar cuando está ocupado; más allá, `503`.',
    behavior: 'Qué hace con cada request, evento o mensaje, escrito en el DSL; vacío, el comportamiento por defecto.',
  },
  info: {
    open: 'Cómo funciona {label}',
    close: 'Cerrar',
    behavior: 'Cómo se comporta',
    fields: 'Configuración',
    tip: 'Para la clase',
    none: 'Sin información',
  },
  components: {
    client: {
      label: 'Cliente',
      fields: {
        ip: 'IP',
        color: 'Color',
        kind: 'Tipo',
        rate: 'Tasa',
        mix: 'Mix (path / evento)',
        burstSize: 'Tamaño de ráfaga',
      },
      options: {
        kind: { request: 'Request', event: 'Evento' },
      },
      actions: {
        send1: 'Enviar 1',
        burst: 'Ráfaga',
      },
      info: {
        summary: 'Genera el tráfico: manda requests o eventos a su primera salida. Es solo origen, así que no tiene puerto de entrada.',
        behavior: [
          'Con Tasa en 0 (el default) no manda nada solo: usá "Enviar 1" o "Ráfaga".',
          'Cada mensaje toma un path o tipo de evento del mix, según los pesos.',
          'Lleva su IP, que el Load Balancer usa con IP Hash.',
          'Sus paquetes y respuestas van con su color; las respuestas tienen borde verde (ok) o rojo (error).',
          'Recibe las respuestas y con ellas se calculan la latencia y los errores.',
          'Sin salida conectada, el mensaje se descarta.',
        ],
        fields: {
          ip: 'Dirección que hashea el IP Hash del Load Balancer; vacía, usa el id del cliente.',
          color: 'Color de sus paquetes y de todo lo que derivan (llamadas, mensajes, eventos), para seguirlos en el canvas.',
          kind: 'Request espera respuesta; Evento no espera nada.',
          rate: 'Mensajes por segundo que manda solo.',
          mix: 'Paths o tipos de evento a mandar, cada uno con su peso.',
          burstSize: 'Cuántos mensajes manda "Ráfaga", repartidos en un segundo.',
        },
        tip: 'Arrancá con "Enviar 1" para seguir un request punta a punta, y después subí la tasa.',
      },
    },
    service: {
      label: 'Servicio',
      fields: { mode: 'Llamadas' },
      options: {
        mode: { parallel: 'Paralelo', sequential: 'Secuencial' },
      },
      info: {
        summary: 'Procesa requests y responde. Si tiene salidas, llama a sus dependencias antes de responder.',
        behavior: [
          'Atiende hasta Capacidad requests a la vez; el resto espera en su cola.',
          'Cola llena o servicio caído: `503`.',
          'Sin salidas responde `200` al terminar; con salidas, cuando vuelven todas.',
          'Si alguna dependencia falla, responde `502`.',
          'Si una salida es una Cola o un Broker, solo espera su `202`.',
        ],
        fields: {
          mode: 'Paralelo llama a todas las salidas a la vez; Secuencial, de a una y corta en el primer error.',
        },
        tip: 'Bajá la capacidad o subí el tiempo de proceso: vas a ver cómo se llena la cola y aparecen los `503`.',
      },
    },
    database: {
      label: 'Base de datos',
      info: {
        summary: 'Recibe queries y responde cuando termina de procesarlas. Es el final del camino: no llama a nadie.',
        behavior: [
          'Atiende hasta Capacidad queries a la vez; el resto espera en cola.',
          'Responde `200` al terminar cada una.',
          'Cola llena o base caída: `503`.',
        ],
        tip: 'Poné varios servicios contra una sola base y mirá cómo se vuelve el cuello de botella.',
      },
    },
    'load-balancer': {
      label: 'Load Balancer',
      fields: { algorithm: 'Algoritmo', healthChecks: 'Health checks' },
      options: {
        algorithm: {
          'round-robin': 'Round Robin',
          'least-connections': 'Least Connections',
          random: 'Random',
          'ip-hash': 'IP Hash',
          weighted: 'Weighted',
        },
      },
      info: {
        summary: 'Reparte cada request a una sola de sus salidas, según el algoritmo.',
        behavior: [
          'Round Robin: en orden, una a cada una.',
          'Least Connections: a la que tiene menos requests en curso.',
          'Random: al azar.',
          'IP Hash: misma IP del cliente, mismo destino; muestra "IP → servidor".',
          'Weighted: en proporción a los pesos de cada conexión (editables en el inspector); si todas las disponibles tienen peso 0, reparte parejo.',
          'Sin destinos disponibles: `503`.',
        ],
        fields: {
          algorithm: 'Cómo elige el destino de cada request.',
          healthChecks: 'Saca de rotación los destinos caídos; apagado, les sigue mandando y fallan con `503`.',
        },
        tip: 'Tirá un servidor con los health checks apagados y después prendelos: los errores desaparecen.',
      },
    },
    'reverse-proxy': {
      label: 'Reverse Proxy',
      fields: { authFailRate: 'Rechazo auth', rateLimit: 'Rate limit', cacheHitRate: 'Cache hit' },
      info: {
        summary: 'La puerta de entrada: enruta cada request según el prefijo de su path.',
        behavior: [
          'Gana la regla con el prefijo más largo; una conexión sin regla equivale a `/`.',
          'Ningún prefijo coincide: `404`.',
          'Rate limit superado: `429`.',
          'Rechazo de auth: `401`.',
          'Cache hit: responde él mismo con `200` (HIT).',
        ],
        fields: {
          authFailRate: 'Fracción de requests que rechaza por auth (0 a 1).',
          rateLimit: 'Máximo de requests por segundo; 0 es sin límite.',
          cacheHitRate: 'Fracción de requests que responde desde su cache (0 a 1).',
        },
        tip: 'Las reglas van en las conexiones: seleccioná una flecha y poné el prefijo. Después mandá paths distintos desde el mix.',
      },
    },
    cache: {
      label: 'Cache',
      fields: { hitRate: 'Hit rate' },
      info: {
        summary: 'Va adelante de un servicio o una base y responde lo que ya tiene guardado.',
        behavior: [
          'Hit: responde ella con `200` (HIT).',
          'Miss: reenvía a su primera salida y deja pasar la respuesta (MISS).',
          'Miss sin salida: `503`.',
          'No encola ni rechaza: no tiene capacidad ni se cae.',
        ],
        fields: {
          hitRate: 'Probabilidad de tener el dato (0 a 1).',
          processingTime: 'Lo que tarda la búsqueda en memoria.',
        },
        tip: 'Compará la latencia p50 con hit rate alto y con hit rate bajo.',
      },
    },
    queue: {
      label: 'Cola',
      fields: { queueMax: 'Cola máx.', maxRetries: 'Reintentos máx.' },
      info: {
        summary: 'Desacopla: acepta el trabajo al toque y se lo pasa a los workers.',
        behavior: [
          'A un request le responde `202` enseguida y encola un mensaje.',
          'Empuja los mensajes a los workers libres conectados, por turnos.',
          'Si el worker falla, reintenta hasta Reintentos máx.',
          'Agotados los reintentos, lo manda a la DLQ conectada (sin DLQ, lo descarta).',
          'Cola llena: `503`.',
        ],
        fields: {
          queueMax: 'Cuántos mensajes pueden esperar; con la cola llena, `503`.',
          maxRetries: 'Reintentos por mensaje antes de mandarlo a la DLQ.',
        },
        tip: 'Mandá una ráfaga: el cliente recibe `202` al instante mientras la cola se vacía al ritmo de los workers.',
      },
    },
    worker: {
      label: 'Worker',
      fields: { failRate: 'Tasa de fallo' },
      info: {
        summary: 'Consume mensajes de una cola y los procesa.',
        behavior: [
          'La cola le manda mensajes solo cuando está activo y tiene capacidad libre.',
          'Le avisa a la cola si salió bien (`200`) o mal (`500`), para que reintente.',
          'Puede tener salidas (por ejemplo una base): las llama en paralelo, como un servicio.',
          'Caído, deja de recibir y los mensajes esperan en la cola.',
        ],
        fields: {
          failRate: 'Probabilidad de que un mensaje falle (mensajes venenosos).',
        },
        tip: 'Subí la tasa de fallo para ver los reintentos y los mensajes llegando a la DLQ.',
      },
    },
    dlq: {
      label: 'DLQ',
      actions: { reprocess: 'Reprocesar' },
      info: {
        summary: 'Dead letter queue: guarda los mensajes que agotaron sus reintentos.',
        behavior: [
          'Muestra los mensajes muertos como celdas.',
          '"Reprocesar" los devuelve a la cola de la que vinieron.',
          'No acepta requests: les responde `503`.',
        ],
        tip: 'Arreglá el worker (bajale la tasa de fallo) y tocá "Reprocesar".',
      },
    },
    broker: {
      label: 'Broker',
      info: {
        summary: 'Pub/sub: cada evento llega a todos los suscriptores interesados.',
        behavior: [
          'Copia el evento a cada salida cuya regla coincide con su tipo (sin regla, recibe todo).',
          'Tiene un buffer por suscriptor: cada uno consume a su ritmo.',
          'Un suscriptor caído acumula eventos y los recibe cuando vuelve.',
          'A un request le responde `202` y lo publica como evento.',
          'Si ningún suscriptor coincide, el evento se descarta.',
        ],
        tip: 'Hacé lento a un suscriptor y mirá cómo crece su buffer sin frenar a los demás.',
      },
    },
    subscriber: {
      label: 'Suscriptor',
      fields: { emits: 'Emite evento' },
      info: {
        summary: 'Consume los eventos que le manda el broker, a su ritmo.',
        behavior: [
          'Procesa hasta Capacidad eventos a la vez y confirma cada uno al broker.',
          'Caído, el broker le guarda los eventos hasta que vuelva.',
          'Si Emite evento tiene un tipo, al terminar manda ese evento a todas sus salidas.',
        ],
        fields: {
          emits: 'Tipo de evento que publica después de procesar; vacío, no emite nada.',
        },
        tip: 'Encadená suscriptores con Emite evento para mostrar una coreografía de eventos.',
      },
    },
  },
  /** Drop reasons (`message:dropped.reason`), shown when a drop carries no status code. */
  reasons: {
    down: 'caído',
    'queue-full': 'cola llena',
    loop: 'loop',
    removed: 'borrado',
    'unknown-type': 'tipo desconocido',
    'no-output': 'sin salida',
    'no-dlq': 'sin DLQ',
    'no-subscribers': 'sin suscriptores',
    'no-targets': 'sin destinos disponibles',
    'no-origin-queue': 'sin cola de origen',
    'client-rejects-requests': 'el cliente no acepta requests',
    'dlq-rejects-requests': 'DLQ no acepta requests',
  },
  /** Node labels (`node:label.text`). */
  labels: {
    HIT: 'HIT',
    MISS: 'MISS',
    '202': '202',
    DLQ: 'DLQ',
    retry: 'reintento',
    'no-subscribers': 'sin suscriptores',
  },
  presets: {
    'load-balancer': {
      name: 'Load Balancer',
      description: 'Dos clientes reparten su tráfico entre tres servidores con round robin.',
      nodes: {
        web: 'Navegador',
        mobile: 'App móvil',
        lb: 'Load Balancer',
        server: 'Servidor {n}',
        db: 'Base de datos',
      },
    },
    'sync-vs-queue': {
      name: 'Sync vs cola',
      description: 'El mismo tráfico contra un servicio síncrono (se satura con 503) y contra una cola con workers (responde 202).',
      nodes: {
        clientSync: 'Cliente sync',
        service: 'Servicio',
        clientQueue: 'Cliente cola',
        queue: 'Cola',
        worker: 'Worker {n}',
        dlq: 'DLQ',
      },
    },
    pubsub: {
      name: 'Pub/sub',
      description: 'Un evento OrdenCreada se publica en el broker y llega a cuatro suscriptores; Analytics es lento y se atrasa.',
      eventType: 'OrdenCreada',
      nodes: {
        orders: 'Órdenes',
        broker: 'Broker',
        billing: 'Facturación',
        stock: 'Stock',
        mails: 'Mails',
        analytics: 'Analytics',
      },
    },
    'reverse-proxy': {
      name: 'Reverse Proxy',
      description: 'El proxy enruta por prefijo de path a cada servicio; lo que no coincide con ninguna regla va a Web.',
      paths: {
        users: '/usuarios',
        orders: '/ordenes',
        payments: '/pagos',
        static: '/static',
      },
      nodes: {
        web: 'Navegador',
        mobile: 'App móvil',
        proxy: 'Reverse Proxy',
        users: 'Usuarios',
        orders: 'Órdenes',
        payments: 'Pagos',
        site: 'Web',
      },
    },
  },
}

export type Dict = typeof es
