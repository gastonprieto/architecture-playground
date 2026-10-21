import type { DslError, Handler, Mod, Program, SessionStore, Step } from './ast'

/**
 * Line-oriented recursive descent over indentation:
 *   1. `scan` turns the text into significant lines (comments, blanks and trailing spaces removed).
 *   2. `Parser` reads handlers at indent 0 and blocks at +2 spaces per level.
 * Errors are collected (never thrown) and parsing goes on, so one typo reports one error.
 */
export function parseBehavior(text: string): { program: Program; errors: DslError[] } {
  const errors: DslError[] = []
  const parser = new Parser(scan(text, errors), errors)
  return { program: { handlers: parser.program() }, errors }
}

interface Line {
  line: number
  indent: number
  text: string
}

interface Token {
  text: string
  quoted: boolean
}

const STEP_KEYWORDS = new Set(['call', 'query', 'enqueue', 'publish', 'parallel', 'parallel:', 'wait', 'fail', 'reply', 'session', 'cache', 'cache:'])

function scan(text: string, errors: DslError[]): Line[] {
  const lines: Line[] = []
  // Pasted text: a leading BOM is dropped and curly double quotes count as straight ones.
  const clean = text.replace(/^\uFEFF/, '').replace(/[\u201C\u201D]/g, '"')
  clean.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = i + 1
    let content = stripComment(raw).trimEnd()
    if (content.trim() === '') return
    if (content.includes('\t')) {
      errors.push({ line, code: 'tab' })
      content = content.replace(/\t/g, '  ')
    }
    const indent = content.length - content.trimStart().length
    if (indent % 2 !== 0) {
      errors.push({ line, code: 'indent' })
      return
    }
    lines.push({ line, indent, text: content.trim() })
  })
  return lines
}

/** Drops everything from the first `#` outside double quotes. */
function stripComment(raw: string): string {
  let quoted = false
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') quoted = !quoted
    else if (raw[i] === '#' && !quoted) return raw.slice(0, i)
  }
  return raw
}

/** Splits on whitespace; `"…"` is one token (quotes removed). An unclosed quote runs to the end of the line. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++
    } else if (text[i] === '"') {
      const end = text.indexOf('"', i + 1)
      const stop = end === -1 ? text.length : end
      tokens.push({ text: text.slice(i + 1, stop), quoted: true })
      i = stop + 1
    } else {
      let j = i
      while (j < text.length && !/\s/.test(text[j]) && text[j] !== '"') j++
      tokens.push({ text: text.slice(i, j), quoted: false })
      i = j
    }
  }
  return tokens
}

const INT = /^\d+$/

class Parser {
  private pos = 0
  private lines: Line[]
  private errors: DslError[]

  constructor(lines: Line[], errors: DslError[]) {
    this.lines = lines
    this.errors = errors
  }

  program(): Handler[] {
    const handlers: Handler[] = []
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos]
      const word = l.text.split(/\s+/)[0]
      if (l.indent === 0 && word === 'on') {
        const h = this.handler(l)
        if (h) handlers.push(h)
        continue
      }
      if (STEP_KEYWORDS.has(word)) this.error(l.line, 'step-outside-handler')
      else if (l.indent > 0) this.error(l.line, 'indent')
      else this.error(l.line, 'unknown-keyword', { word })
      this.pos++
      this.skipDeeperThan(l.indent)
    }
    return handlers
  }

  private handler(l: Line): Handler | null {
    this.pos++
    const hasColon = l.text.endsWith(':')
    // Tokenized like a step, so an event type may be quoted (`on event "Order Created":`).
    const tokens = tokenize(hasColon ? l.text.slice(0, -1) : l.text)
    const kind = tokens[1]?.quoted ? '' : (tokens[1]?.text ?? '')
    const argToken = tokens[2]
    const arg = argToken?.text
    const extra = tokens.slice(3).map((t) => t.text)
    let handler: Handler | null = null
    if (kind === 'request') {
      const isPrefix = argToken !== undefined && !argToken.quoted && argToken.text.startsWith('/')
      if (argToken !== undefined && !isPrefix) this.error(l.line, 'unknown-keyword', { word: argToken.text })
      else if (extra.length > 0) this.error(l.line, 'unknown-keyword', { word: extra[0] })
      handler = { on: 'request', line: l.line, ...(isPrefix && { prefix: argToken.text }), steps: [] }
    } else if (kind === 'event') {
      const eventType = arg?.trim()
      if (extra.length > 0) this.error(l.line, 'unknown-keyword', { word: extra[0] })
      else if (argToken !== undefined && eventType === '') this.error(l.line, 'missing-target')
      handler = { on: 'event', line: l.line, ...(eventType && { eventType }), steps: [] }
    } else if (kind === 'message') {
      if (arg !== undefined) this.error(l.line, 'unknown-keyword', { word: arg })
      handler = { on: 'message', line: l.line, steps: [] }
    } else {
      this.error(l.line, 'unknown-keyword', { word: kind })
    }
    if (!hasColon && handler) this.error(l.line, 'missing-colon')
    // The block is read even for a broken header, so its lines don't report errors of their own.
    const steps = this.block(l, hasColon && handler !== null)
    if (handler) handler.steps = steps
    return handler
  }

  /** Reads the lines indented exactly 2 more than `owner`. */
  private block(owner: Line, reportEmpty: boolean): Step[] {
    const indent = owner.indent + 2
    const steps: Step[] = []
    let sawLines = false
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos]
      if (l.indent < indent) break
      sawLines = true
      this.pos++
      if (l.indent > indent) {
        this.error(l.line, 'indent')
        this.skipDeeperThan(indent)
        continue
      }
      const step = this.step(l)
      if (step) steps.push(step)
    }
    if (!sawLines && reportEmpty) this.error(owner.line, 'empty-block')
    return steps
  }

  private step(l: Line): Step | null {
    const tokens = tokenize(l.text)
    const word = tokens[0].quoted ? '' : tokens[0].text
    switch (word) {
      case 'call':
      case 'query':
      case 'enqueue':
        return this.targetStep(l, word, tokens)
      case 'publish':
        return this.publish(l, tokens)
      case 'parallel':
      case 'parallel:':
        return this.parallel(l, tokens)
      case 'wait':
        return this.wait(l, tokens)
      case 'fail':
        return this.fail(l, tokens)
      case 'reply':
        return this.reply(l, tokens)
      case 'session':
        return this.session(l, tokens)
      case 'cache':
      case 'cache:':
        return this.cache(l)
      default:
        if (word === 'on') this.error(l.line, 'indent')
        else this.error(l.line, 'unknown-keyword', { word: tokens[0].text })
        this.skipDeeperThan(l.indent)
        return null
    }
  }

  private targetStep(l: Line, kind: 'call' | 'query' | 'enqueue', tokens: Token[]): Step | null {
    const { target, next } = readTarget(tokens, 1)
    if (target === '') {
      this.error(l.line, 'missing-target')
      return null
    }
    if (kind !== 'call') {
      const mod = this.mod(l, tokens, next)
      return { kind, line: l.line, target, ...(mod && { mod }) }
    }
    const path = tokens[next]
    if (!path || path.quoted || !path.text.startsWith('/')) {
      this.error(l.line, 'call-missing-path', { target })
      return null
    }
    const mod = this.mod(l, tokens, next + 1)
    return { kind, line: l.line, target, path: path.text, ...(mod && { mod }) }
  }

  private publish(l: Line, tokens: Token[]): Step | null {
    const type = tokens[1]
    if (!type || (!type.quoted && isModWord(type.text)) || type.text.trim() === '') {
      this.error(l.line, 'missing-target')
      return null
    }
    const mod = this.mod(l, tokens, 2)
    return { kind: 'publish', line: l.line, eventType: type.text.trim(), ...(mod && { mod }) }
  }

  private parallel(l: Line, tokens: Token[]): Step {
    let rest = tokens.slice(1)
    let hasColon = tokens[0].text === 'parallel:'
    if (!hasColon && rest[0]?.text === ':') {
      hasColon = true
      rest = rest.slice(1)
    }
    if (!hasColon) this.error(l.line, 'missing-colon')
    else if (rest.length > 0) this.error(l.line, 'unknown-keyword', { word: rest[0].text })
    return { kind: 'parallel', line: l.line, steps: this.block(l, hasColon) }
  }

  private wait(l: Line, tokens: Token[]): Step | null {
    const m = /^(\d+)(ms)?$/.exec(tokens[1]?.text ?? '')
    if (!m) {
      this.error(l.line, 'bad-number', { value: tokens[1]?.text ?? '' })
      return null
    }
    if (!this.noExtra(l, tokens, 2)) return null
    return { kind: 'wait', line: l.line, ms: Number(m[1]) }
  }

  private fail(l: Line, tokens: Token[]): Step | null {
    const m = /^(\d+(?:\.\d+)?)%$/.exec(tokens[1]?.text ?? '')
    if (!m) {
      this.error(l.line, 'bad-number', { value: tokens[1]?.text ?? '' })
      return null
    }
    const percent = Number(m[1])
    if (percent > 100) {
      this.error(l.line, 'fail-range', { value: percent })
      return null
    }
    let code = 500
    if (tokens[2]) {
      const c = this.code(l, tokens[2])
      if (c === null) return null
      code = c
    }
    if (!this.noExtra(l, tokens, 3)) return null
    return { kind: 'fail', line: l.line, percent, code }
  }

  private reply(l: Line, tokens: Token[]): Step | null {
    const code = this.code(l, tokens[1])
    if (code === null || !this.noExtra(l, tokens, 2)) return null
    return { kind: 'reply', line: l.line, code }
  }

  /**
   * `session memory|jwt|<database> [or …]`. The keywords count only unquoted and alone, so a database
   * named "memory" is written quoted. A session has to be checked before going on: no `nowait`.
   */
  private session(l: Line, tokens: Token[]): Step | null {
    const { target, next } = readTarget(tokens, 1)
    if (target === '') {
      this.error(l.line, 'missing-target')
      return null
    }
    if (tokens.slice(next).some((t) => !t.quoted && t.text === 'nowait')) {
      this.error(l.line, 'session-nowait')
      return null
    }
    const keyword = !tokens[1].quoted && next === 2 && (target === 'memory' || target === 'jwt') ? target : null
    const store: SessionStore = keyword ? { kind: keyword } : { kind: 'database', target }
    const mod = this.mod(l, tokens, next)
    return { kind: 'session', line: l.line, store, ...(mod && { mod }) }
  }

  /**
   * `cache <target> [or …]:` plus a mandatory block. The colon closes the line (it may touch the
   * target or a modifier code). The block decides on a miss, so the step always waits: no `nowait`.
   */
  private cache(l: Line): Step | null {
    const hasColon = l.text.endsWith(':')
    const tokens = tokenize(hasColon ? l.text.slice(0, -1) : l.text)
    const { target, next } = readTarget(tokens, 1)
    let valid = true
    if (target === '') {
      this.error(l.line, 'missing-target')
      valid = false
    } else if (tokens.slice(next).some((t) => !t.quoted && t.text === 'nowait')) {
      this.error(l.line, 'cache-nowait')
      valid = false
    }
    const mod = valid ? this.mod(l, tokens, next) : undefined
    if (valid && !hasColon) this.error(l.line, 'missing-colon')
    // The block is read even for a broken header, so its lines don't report errors of their own.
    const steps = this.block(l, valid && hasColon)
    return valid ? { kind: 'cache', line: l.line, target, ...(mod && { mod }), steps } : null
  }

  /** Reads an optional modifier from tokens[i…]; reports leftovers and `nowait` mixed with `or`. */
  private mod(l: Line, tokens: Token[], i: number): Mod | undefined {
    let mod: Mod | undefined
    while (i < tokens.length) {
      const t = tokens[i]
      let next: Mod
      if (t.quoted || (t.text !== 'nowait' && t.text !== 'or')) {
        this.error(l.line, 'unknown-keyword', { word: t.text })
        return mod
      }
      if (t.text === 'nowait') {
        next = { kind: 'nowait' }
        i++
      } else if (tokens[i + 1]?.text === 'continue') {
        next = { kind: 'orContinue' }
        i += 2
      } else if (tokens[i + 1]?.text === 'reply') {
        const code = this.code(l, tokens[i + 2])
        if (code === null) return mod
        next = { kind: 'orReply', code }
        i += 3
      } else {
        this.error(l.line, 'unknown-keyword', { word: tokens[i + 1]?.text ?? t.text })
        return mod
      }
      if (mod) {
        const mixed = (mod.kind === 'nowait') !== (next.kind === 'nowait')
        this.error(l.line, mixed ? 'nowait-with-or' : 'unknown-keyword', mixed ? undefined : { word: t.text })
        return mod
      }
      mod = next
    }
    return mod
  }

  /** An HTTP-like status code (100–599), or null after reporting the error. */
  private code(l: Line, token: Token | undefined): number | null {
    const text = token?.text ?? ''
    if (!INT.test(text)) {
      this.error(l.line, 'bad-number', { value: text })
      return null
    }
    const value = Number(text)
    if (value < 100 || value > 599) {
      this.error(l.line, 'code-range', { value })
      return null
    }
    return value
  }

  private noExtra(l: Line, tokens: Token[], from: number): boolean {
    if (tokens.length <= from) return true
    this.error(l.line, 'unknown-keyword', { word: tokens[from].text })
    return false
  }

  private skipDeeperThan(indent: number): void {
    while (this.pos < this.lines.length && this.lines[this.pos].indent > indent) this.pos++
  }

  private error(line: number, code: DslError['code'], params?: DslError['params']): void {
    this.errors.push({ line, code, ...(params && { params }) })
  }
}

function isModWord(text: string): boolean {
  return text === 'nowait' || text === 'or'
}

/**
 * A destination: one quoted token, or the unquoted words up to a path (`/…`), `nowait` or `or`.
 * Words are re-joined with single spaces.
 */
function readTarget(tokens: Token[], i: number): { target: string; next: number } {
  if (tokens[i]?.quoted) return { target: tokens[i].text.trim(), next: i + 1 }
  const words: string[] = []
  while (i < tokens.length && !tokens[i].quoted && !tokens[i].text.startsWith('/') && !isModWord(tokens[i].text)) {
    words.push(tokens[i].text)
    i++
  }
  return { target: words.join(' '), next: i }
}
