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
  },
  components: {
    client: {
      label: 'Cliente',
      fields: {
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
    },
    service: {
      label: 'Servicio',
      fields: { mode: 'Llamadas' },
      options: {
        mode: { parallel: 'Paralelo', sequential: 'Secuencial' },
      },
    },
    database: {
      label: 'Base de datos',
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
    },
    'reverse-proxy': {
      label: 'Reverse Proxy',
      fields: { authFailRate: 'Rechazo auth', rateLimit: 'Rate limit', cacheHitRate: 'Cache hit' },
    },
    cache: {
      label: 'Cache',
      fields: { hitRate: 'Hit rate' },
    },
    queue: {
      label: 'Cola',
      fields: { queueMax: 'Cola máx.', maxRetries: 'Reintentos máx.' },
    },
    worker: {
      label: 'Worker',
      fields: { failRate: 'Tasa de fallo' },
    },
    dlq: {
      label: 'DLQ',
      actions: { reprocess: 'Reprocesar' },
    },
    broker: {
      label: 'Broker',
    },
    subscriber: {
      label: 'Suscriptor',
      fields: { emits: 'Emite evento' },
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
