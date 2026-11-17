import type { Lang } from '../i18n'

/** Landing page texts. The playground's own texts stay in src/i18n. */
export const COPY = {
  es: {
    title: 'Nodarium · Simulá tu arquitectura',
    nav: { features: 'Funciones', components: 'Componentes', github: 'GitHub' },
    open: 'Abrir el playground',
    pill: 'Gratis · sin registro · código abierto',
    h1a: 'Simulá tu arquitectura',
    h1b: 'antes de construirla',
    lead: 'Nodarium es un playground en el navegador: armás un sistema en un canvas y mirás cómo circulan requests, mensajes y eventos. Cambiá la capacidad, el tiempo de proceso o apagá un servicio, y mirá cómo reacciona el resto.',
    seeMore: 'Ver qué trae',
    demo: {
      label: 'Demo del playground',
      preset: 'Preset',
      openHere: 'Seguir en el playground ↗',
      openHereTitle: 'Abre este mismo grafo en el playground',
      speed: 'Velocidad',
      note: 'Es el playground real con un preset cargado. Hacé click en un nodo y cambiá sus valores en el inspector.',
    },
    features: {
      eyebrow: 'Funciones',
      title: 'Lo justo para entender un sistema.',
      lead: 'Sin cuentas, sin servidores, sin instalar nada. Todo corre en tu navegador.',
      packets: {
        title: 'Cada mensaje se ve',
        text: 'Los requests son círculos del color de su cliente, los mensajes de una cola son cuadrados y los eventos, rombos. Las respuestas vuelven por el mismo cable, pintadas según su código HTTP.',
        legend: { request: 'request', message: 'mensaje', event: 'evento' },
      },
      presets: {
        title: 'Doce escenarios que enseñan algo',
        text: 'Agrupados en seis temas: escalado, sesiones, asincronía, integración de servicios, borde y cache. Cada uno muestra una sola arquitectura y explica paso a paso qué hace. Elegí uno arriba y miralo correr.',
      },
      text: {
        title: 'La arquitectura como texto',
        text: 'El grafo entero en un formato parecido a PlantUML. Editalo y aplicalo en un solo paso de deshacer. Exportá e importá archivos .arch.',
      },
      dsl: {
        title: 'Comportamiento programable',
        text: 'Servicios, workers y suscriptores aceptan un DSL corto: a quién llaman, en qué orden, qué publican y con qué código responden.',
      },
    },
    components: {
      eyebrow: 'Componentes',
      title: 'Once piezas, cada una con su inspector.',
      lead: 'Capacidad, tiempo de proceso, tasa, reintentos, algoritmo de balanceo, prefijos de ruteo, TTL de cache. En español o en inglés.',
    },
    final: 'Tu próxima arquitectura, probada en cinco minutos.',
    footer: 'Código abierto en GitHub',
  },
  en: {
    title: 'Nodarium · Simulate your architecture',
    nav: { features: 'Features', components: 'Components', github: 'GitHub' },
    open: 'Open the playground',
    pill: 'Free · no sign-up · open source',
    h1a: 'Simulate your architecture',
    h1b: 'before you build it',
    lead: 'Nodarium is a playground in your browser: build a system on a canvas and watch requests, messages and events flow through it. Change the capacity or the processing time, or turn a service off, and see how the rest reacts.',
    seeMore: 'See what it does',
    demo: {
      label: 'Playground demo',
      preset: 'Preset',
      openHere: 'Continue in the playground ↗',
      openHereTitle: 'Opens this same graph in the playground',
      speed: 'Speed',
      note: 'This is the real playground with a preset loaded. Click a node and change its values in the inspector.',
    },
    features: {
      eyebrow: 'Features',
      title: 'Just enough to understand a system.',
      lead: 'No accounts, no servers, nothing to install. Everything runs in your browser.',
      packets: {
        title: 'You can see every message',
        text: 'Requests are circles in their client’s color, queue messages are squares and events are diamonds. Responses ride back along the same wire, colored by their HTTP status.',
        legend: { request: 'request', message: 'message', event: 'event' },
      },
      presets: {
        title: 'Twelve scenarios that teach something',
        text: 'Grouped in six topics: scaling, sessions, asynchrony, service integration, edge and cache. Each one shows a single architecture and explains step by step what it does. Pick one above and watch it run.',
      },
      text: {
        title: 'Architecture as text',
        text: 'The whole graph in a PlantUML-like format. Edit it and apply it in a single undo step. Export and import .arch files.',
      },
      dsl: {
        title: 'Programmable behavior',
        text: 'Services, workers and subscribers take a short DSL: whom they call, in what order, what they publish and which code they reply with.',
      },
    },
    components: {
      eyebrow: 'Components',
      title: 'Eleven pieces, each with its inspector.',
      lead: 'Capacity, processing time, rate, retries, balancing algorithm, routing prefixes, cache TTL. In English or Spanish.',
    },
    final: 'Your next architecture, tested in five minutes.',
    footer: 'Open source on GitHub',
  },
} as const satisfies Record<Lang, unknown>

export type Copy = (typeof COPY)[Lang]
