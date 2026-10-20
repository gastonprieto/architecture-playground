import { Registry, type ComponentDef } from '../engine/registry'
import { client } from './client'
import { database } from './database'
import { service } from './service'

/** Every built-in component type. New component tasks append their def here. */
const builtins: ComponentDef[] = [client, service, database]

export const defaultRegistry = new Registry()
for (const def of builtins) defaultRegistry.register(def)
