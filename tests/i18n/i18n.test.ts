// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../../src/i18n/en'
import { es } from '../../src/i18n/es'
import { LANG_STORAGE_KEY, codeText, detectLang, t, translate, translateWith, useLang } from '../../src/i18n'

/** Every leaf key of a nested dictionary, as dotted paths, sorted. */
function keysOf(obj: object, prefix = ''): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
    .sort()
}

afterEach(() => {
  useLang.getState().setLang('es')
  localStorage.clear()
})

describe('dictionaries', () => {
  it('es and en have exactly the same keys', () => {
    expect(keysOf(en)).toEqual(keysOf(es))
  })

  it('every leaf is a non-empty string', () => {
    const leaves = (o: object): unknown[] => Object.values(o).flatMap((v) => (typeof v === 'object' && v !== null ? leaves(v) : [v]))
    for (const d of [es, en]) for (const v of leaves(d)) expect(typeof v === 'string' && v.length > 0).toBe(true)
  })
})

describe('translate', () => {
  it('resolves dotted keys per language', () => {
    expect(translate('es', 'palette.title')).toBe('Componentes')
    expect(translate('en', 'palette.title')).toBe('Components')
    expect(translate('en', 'components.load-balancer.fields.algorithm')).toBe('Algorithm')
  })

  it('interpolates {name} params and leaves unknown placeholders alone', () => {
    expect(translate('en', 'palette.dragHint', { label: 'Cache' })).toBe('Drag Cache onto the canvas')
    expect(translate('es', 'errors.dangling-edge', { edgeId: 'e9' })).toBe('La arista e9 apunta a un nodo inexistente')
    expect(translateWith({ es: { a: 'x {p} {q}' }, en: {} }, 'es', 'a', { p: 1 })).toBe('x 1 {q}')
  })

  it('falls back to es, then to the key itself', () => {
    const dicts = { es: { only: { es: 'solo es' }, both: 'ambos' }, en: { both: 'both' } }
    expect(translateWith(dicts, 'en', 'both')).toBe('both')
    expect(translateWith(dicts, 'en', 'only.es')).toBe('solo es')
    expect(translateWith(dicts, 'en', 'missing.key')).toBe('missing.key')
    // A key that points at a group (not a string) is missing too.
    expect(translateWith(dicts, 'en', 'only')).toBe('only')
  })

  it('codeText translates reason/label codes and shows unknown codes raw', () => {
    expect(codeText('en', 'reasons', 'queue-full')).toBe('queue full')
    expect(codeText('es', 'reasons', 'queue-full')).toBe('cola llena')
    expect(codeText('es', 'labels', 'retry')).toBe('reintento')
    expect(codeText('en', 'labels', 'HIT')).toBe('HIT')
    expect(codeText('en', 'reasons', 'custom-thing')).toBe('custom-thing')
  })
})

describe('detectLang', () => {
  it('the ?lang= query param wins', () => {
    expect(detectLang({ search: '?lang=en', stored: 'es', navigatorLanguage: 'es-AR' })).toBe('en')
    expect(detectLang({ search: '?mobile=1&lang=es', stored: 'en', navigatorLanguage: 'en-US' })).toBe('es')
  })

  it('then the stored choice', () => {
    expect(detectLang({ search: '', stored: 'en', navigatorLanguage: 'es-AR' })).toBe('en')
    expect(detectLang({ search: '?lang=fr', stored: 'es', navigatorLanguage: 'en-US' })).toBe('es')
  })

  it('then navigator.language: es* → es, anything else → en', () => {
    expect(detectLang({ stored: 'xx', navigatorLanguage: 'es-AR' })).toBe('es')
    expect(detectLang({ navigatorLanguage: 'es' })).toBe('es')
    expect(detectLang({ navigatorLanguage: 'en-US' })).toBe('en')
    expect(detectLang({ navigatorLanguage: 'pt-BR' })).toBe('en')
    expect(detectLang({})).toBe('en')
  })
})

describe('useLang store', () => {
  it('setLang switches t(), persists the choice and syncs <html lang>', () => {
    useLang.getState().setLang('en')
    expect(t('toolbar.linkCopied')).toBe('Link copied')
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    useLang.getState().setLang('es')
    expect(t('toolbar.linkCopied')).toBe('Link copiado')
    expect(document.documentElement.lang).toBe('es')
    expect(document.title).toBe('Architecture Playground')
  })

  it('setLang rewrites an existing ?lang= param so a reload keeps the choice', () => {
    window.history.replaceState(null, '', '/?lang=en&mobile=1')
    try {
      useLang.getState().setLang('es')
      expect(new URLSearchParams(location.search).get('lang')).toBe('es')
      expect(new URLSearchParams(location.search).get('mobile')).toBe('1')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })
})
