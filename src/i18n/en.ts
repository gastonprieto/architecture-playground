import type { Dict } from './es'

/** English UI copy: same keys as `es` (checked by the `Dict` type and by tests/i18n). */
export const en: Dict = {
  app: {
    title: 'Architecture Playground',
  },
  lang: {
    label: 'Language',
    es: 'Spanish',
    en: 'English',
  },
  toolbar: {
    play: '▶ Play',
    pause: '⏸ Pause',
    playTitle: 'Space',
    step: 'Step',
    stepTitle: 'Advance 100 ms',
    reset: 'Reset',
    speedTitle: 'Speed (keys - and +)',
    presets: 'Presets',
    presetsPlaceholder: 'Presets…',
    undo: 'Undo',
    redo: 'Redo',
    export: 'Export',
    import: 'Import',
    copyLink: 'Copy link',
    linkCopied: 'Link copied',
    exportFilename: 'architecture.json',
  },
  errors: {
    'invalid-json': 'Invalid JSON',
    'unknown-format': 'Unrecognized file format',
    'dangling-edge': 'Edge {edgeId} points to a node that does not exist',
  },
  palette: {
    title: 'Components',
    dragHint: 'Drag {label} onto the canvas',
  },
  inspector: {
    label: 'Inspector',
    help: 'Drag components from the left and connect them. Select one to configure it.',
    connection: 'Connection',
    rule: 'Rule',
    noRule: 'No rule',
    pathPrefix: 'Path starts with',
    eventType: 'Event type',
    value: 'Value',
    pathPlaceholder: '/orders',
    eventPlaceholder: 'order.created',
    delete: 'Delete',
    unknownType: 'Unknown type: {type}',
  },
  widgets: {
    slider: '{label} (slider)',
    mixValue: 'Value {n}',
    mixWeight: 'Weight {n}',
    remove: 'Remove',
    add: 'Add',
  },
  node: {
    unknown: 'Unknown',
    down: 'down',
    inFlight: 'In progress',
    queued: 'Queued',
    ok: 'OK',
    errors: 'Errors',
  },
  metrics: {
    label: 'Metrics',
    throughput: 'Throughput',
    errors: 'Errors',
  },
  fields: {
    name: 'Name',
    up: 'Up',
    processingTime: 'Processing time',
    capacity: 'Capacity',
    queueMax: 'Max queue',
  },
  components: {
    client: {
      label: 'Client',
      fields: {
        kind: 'Type',
        rate: 'Rate',
        mix: 'Mix (path / event)',
        burstSize: 'Burst size',
      },
      options: {
        kind: { request: 'Request', event: 'Event' },
      },
      actions: {
        send1: 'Send 1',
        burst: 'Burst',
      },
    },
    service: {
      label: 'Service',
      fields: { mode: 'Calls' },
      options: {
        mode: { parallel: 'Parallel', sequential: 'Sequential' },
      },
    },
    database: {
      label: 'Database',
    },
    'load-balancer': {
      label: 'Load Balancer',
      fields: { algorithm: 'Algorithm', healthChecks: 'Health checks' },
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
      fields: { authFailRate: 'Auth rejection', rateLimit: 'Rate limit', cacheHitRate: 'Cache hit' },
    },
    cache: {
      label: 'Cache',
      fields: { hitRate: 'Hit rate' },
    },
    queue: {
      label: 'Queue',
      fields: { queueMax: 'Max queue', maxRetries: 'Max retries' },
    },
    worker: {
      label: 'Worker',
      fields: { failRate: 'Failure rate' },
    },
    dlq: {
      label: 'DLQ',
      actions: { reprocess: 'Reprocess' },
    },
    broker: {
      label: 'Broker',
    },
    subscriber: {
      label: 'Subscriber',
      fields: { emits: 'Emits event' },
    },
  },
  reasons: {
    down: 'down',
    'queue-full': 'queue full',
    loop: 'loop',
    removed: 'removed',
    'unknown-type': 'unknown type',
    'no-output': 'no output',
    'no-dlq': 'no DLQ',
    'no-subscribers': 'no subscribers',
    'no-targets': 'no targets available',
    'no-origin-queue': 'no source queue',
    'client-rejects-requests': "clients don't accept requests",
    'dlq-rejects-requests': "DLQ doesn't accept requests",
  },
  labels: {
    HIT: 'HIT',
    MISS: 'MISS',
    '202': '202',
    DLQ: 'DLQ',
    retry: 'retry',
    'no-subscribers': 'no subscribers',
  },
  presets: {
    'load-balancer': {
      name: 'Load balancer',
      description: 'Two clients spread their traffic across three servers with round robin.',
      nodes: {
        web: 'Browser',
        mobile: 'Mobile app',
        lb: 'Load balancer',
        server: 'Server {n}',
        db: 'Database',
      },
    },
    'sync-vs-queue': {
      name: 'Sync vs queue',
      description: 'The same traffic against a synchronous service (it saturates and returns 503s) and against a queue with workers (it answers 202).',
      nodes: {
        clientSync: 'Sync client',
        service: 'Service',
        clientQueue: 'Queue client',
        queue: 'Queue',
        worker: 'Worker {n}',
        dlq: 'DLQ',
      },
    },
    pubsub: {
      name: 'Pub/sub',
      description: 'An OrderCreated event is published to the broker and reaches four subscribers; Analytics is slow and falls behind.',
      eventType: 'OrderCreated',
      nodes: {
        orders: 'Orders',
        broker: 'Broker',
        billing: 'Billing',
        stock: 'Inventory',
        mails: 'Emails',
        analytics: 'Analytics',
      },
    },
    'reverse-proxy': {
      name: 'Reverse proxy',
      description: 'The proxy routes each path prefix to its service; anything that matches no rule goes to Web.',
      paths: {
        users: '/users',
        orders: '/orders',
        payments: '/payments',
        static: '/static',
      },
      nodes: {
        web: 'Browser',
        mobile: 'Mobile app',
        proxy: 'Reverse proxy',
        users: 'Users',
        orders: 'Orders',
        payments: 'Payments',
        site: 'Web',
      },
    },
  },
}
