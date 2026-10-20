import { useCallback } from 'react'
import { create } from 'zustand'
import { en } from './en'
import { es } from './es'

export type Lang = 'es' | 'en'
export const LANGS: readonly Lang[] = ['es', 'en']
export const LANG_STORAGE_KEY = 'architecture-playground:lang'
export const APP_TITLE = 'Architecture Playground'

export type Params = Record<string, string | number>
type Tree = { [key: string]: string | Tree }

const DICTS: Record<Lang, Tree> = { es, en }

const isLang = (v: unknown): v is Lang => v === 'es' || v === 'en'

/** The string at a dotted key, or undefined when it is missing or names a group. */
function resolve(tree: Tree | undefined, key: string): string | undefined {
  let node: string | Tree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

const interpolate = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (params[name] === undefined ? m : String(params[name]))) : text

/** `key` in `lang`, else in es, else the key itself; `{name}` placeholders take `params`. */
export function translateWith(dicts: Record<Lang, Tree>, lang: Lang, key: string, params?: Params): string {
  return interpolate(resolve(dicts[lang], key) ?? resolve(dicts.es, key) ?? key, params)
}

/** `key` in `lang` (falling back to es), or undefined: for callers with their own fallback text. */
export function lookup(lang: Lang, key: string, params?: Params): string | undefined {
  const text = resolve(DICTS[lang], key) ?? resolve(DICTS.es, key)
  return text === undefined ? undefined : interpolate(text, params)
}

export const translate = (lang: Lang, key: string, params?: Params): string => translateWith(DICTS, lang, key, params)

/** Engine codes (drop reasons, node labels): translated when known, otherwise shown raw. */
export const codeText = (lang: Lang, group: 'reasons' | 'labels', code: string): string => lookup(lang, `${group}.${code}`) ?? code

export interface LangEnv {
  search?: string
  stored?: string | null
  navigatorLanguage?: string
}

/** Initial language: `?lang=es|en`, then the saved choice, then navigator.language (es* → es, else en). */
export function detectLang({ search = '', stored, navigatorLanguage }: LangEnv): Lang {
  const fromQuery = new URLSearchParams(search).get('lang')
  if (isLang(fromQuery)) return fromQuery
  if (isLang(stored)) return stored
  return navigatorLanguage?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function browserEnv(): LangEnv {
  const env: LangEnv = {}
  try {
    env.search = globalThis.location?.search ?? ''
  } catch {
    /* no location */
  }
  try {
    env.stored = globalThis.localStorage?.getItem(LANG_STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  try {
    env.navigatorLanguage = globalThis.navigator?.language
  } catch {
    /* no navigator */
  }
  return env
}

/** Keeps `<html lang>` and the tab title in sync with the language. */
function applyToDocument(lang: Lang): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.title = APP_TITLE
}

/** A `?lang=` param in the address bar would override the choice on reload, so it follows it. */
function syncQueryParam(lang: Lang): void {
  try {
    const url = new URL(globalThis.location.href)
    if (!url.searchParams.has('lang')) return
    url.searchParams.set('lang', lang)
    globalThis.history.replaceState(globalThis.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    /* no location/history (non-browser environment) */
  }
}

export interface LangState {
  lang: Lang
  setLang(lang: Lang): void
}

export const useLang = create<LangState>((set) => {
  const initial = detectLang(browserEnv())
  applyToDocument(initial)
  return {
    lang: initial,
    setLang(lang) {
      set({ lang })
      applyToDocument(lang)
      syncQueryParam(lang)
      try {
        localStorage.setItem(LANG_STORAGE_KEY, lang)
      } catch {
        /* storage unavailable: the choice lasts until reload */
      }
    },
  }
})

/** Translate with the current language (non-reactive; components use `useT`). */
export const t = (key: string, params?: Params): string => translate(useLang.getState().lang, key, params)

export type TFn = (key: string, params?: Params) => string

/** `t` bound to the current language; the component re-renders when the language changes. */
export function useT(): TFn {
  const lang = useLang((s) => s.lang)
  return useCallback((key: string, params?: Params) => translate(lang, key, params), [lang])
}
