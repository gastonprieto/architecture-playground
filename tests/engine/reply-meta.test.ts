import { describe, expect, it } from 'vitest'
import { defineComponent } from '../../src/engine/registry'
import { Simulation } from '../../src/engine/simulation'
import type { Message } from '../../src/engine/types'
import { edge, graph, makeRegistry, node } from './fixtures'

/** Replies 200 with a meta patch (setSession) to every request. */
const patcher = defineComponent({
  type: 'patcher',
  label: 'Patcher',
  icon: 'p',
  color: 'ok',
  config: {},
  initialState: () => ({}),
  onMessage(msg, ctx) {
    ctx.reply(msg, { status: 'ok', code: 200, meta: { setSession: `sid:${msg.id}`, path: '/patched' } })
  },
})

describe('ctx.reply meta patch', () => {
  it('merges the patch into the response meta, which survives a forwarding hop back to the originator', () => {
    const reg = makeRegistry()
    reg.register(patcher)
    const s = new Simulation(graph([node('O', 'origin'), node('F', 'fwd'), node('P', 'patcher')], [edge('O', 'F'), edge('F', 'P')]), {
      seed: 1,
      registry: reg,
    })
    const atOrigin: Message[] = []
    const atFwd: Message[] = []
    s.on('message:arrived', (p) => {
      if (p.msg.kind !== 'response') return
      if (p.at === 'O') atOrigin.push(p.msg)
      if (p.at === 'F') atFwd.push(p.msg)
    })
    s.runAction('O', 'send')
    s.advance(5000)
    expect(atFwd).toHaveLength(1)
    expect(atFwd[0].meta.setSession).toMatch(/^sid:m\d+$/)
    expect(atOrigin).toHaveLength(1)
    // The patch overrides request meta and keeps the rest.
    expect(atOrigin[0].meta).toMatchObject({ setSession: atFwd[0].meta.setSession, path: '/patched' })
    expect(atOrigin[0].code).toBe(200)
  })

  it('a reply without meta keeps the request meta as before', () => {
    const s = new Simulation(graph([node('O', 'origin'), node('E', 'echo')], [edge('O', 'E')]), { seed: 1, registry: makeRegistry() })
    const got: Message[] = []
    s.on('message:arrived', (p) => {
      if (p.at === 'O' && p.msg.kind === 'response') got.push(p.msg)
    })
    s.runAction('O', 'send')
    s.advance(5000)
    expect(got[0].meta).toEqual({ path: '/' })
  })
})
