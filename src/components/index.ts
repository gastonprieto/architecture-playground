import { Registry, type ComponentDef } from '../engine/registry'
import { broker } from './broker'
import { cache } from './cache'
import { client } from './client'
import { database } from './database'
import { dlq } from './dlq'
import { loadBalancer } from './load-balancer'
import { queue } from './queue'
import { reverseProxy } from './reverse-proxy'
import { service } from './service'
import { subscriber } from './subscriber'
import { worker } from './worker'

/** Every built-in component type. New component tasks append their def here. */
const builtins: ComponentDef[] = [client, service, database, loadBalancer, reverseProxy, cache, queue, worker, dlq, broker, subscriber]

export const defaultRegistry = new Registry()
for (const def of builtins) defaultRegistry.register(def)
