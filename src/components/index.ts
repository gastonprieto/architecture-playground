import { Registry, type ComponentDef } from '../engine/registry'
import { cache } from './cache'
import { client } from './client'
import { database } from './database'
import { loadBalancer } from './load-balancer'
import { reverseProxy } from './reverse-proxy'
import { service } from './service'

/** Every built-in component type. New component tasks append their def here. */
const builtins: ComponentDef[] = [client, service, database, loadBalancer, reverseProxy, cache]

export const defaultRegistry = new Registry()
for (const def of builtins) defaultRegistry.register(def)
