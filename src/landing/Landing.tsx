import { Analytics } from '@vercel/analytics/react'
import { useEffect, useMemo } from 'react'
import { defaultRegistry } from '../components/index'
import { LANGS, useLang } from '../i18n'
import { componentInfo, componentLabel } from '../i18n/componentText'
import { stripHash } from '../ui/analytics'
import { toneColor } from '../ui/colors'
import { CLIENT_COLORS } from '../components/client'
import { COPY } from './copy'
import { Demo } from './Demo'
import { PLAY_PATH } from './legacyLink'
import { Logo } from '../ui/Logo'
import './landing.css'
import { Icon } from '../ui/Icon'

const REPO_URL = 'https://github.com/gastonprieto/nodarium'

/** The legend shapes, drawn like PacketLayer draws them. */
function PacketShape({ kind }: { kind: 'request' | 'message' | 'event' | '2xx' | '4xx' | '5xx' }) {
  const shape = {
    request: <circle r="6" fill={CLIENT_COLORS[0]} />,
    message: <rect x="-5" y="-5" width="10" height="10" rx="1.5" fill={CLIENT_COLORS[1]} />,
    event: <polygon points="0,-7 7,0 0,7 -7,0" fill={CLIENT_COLORS[2]} />,
    '2xx': <circle r="4" fill="#4ade80" fillOpacity={0.6} />,
    '4xx': <circle r="4" fill="#facc15" fillOpacity={0.8} />,
    '5xx': <circle r="4" fill="#f87171" fillOpacity={0.8} />,
  }[kind]
  return (
    <svg viewBox="-8 -8 16 16" aria-hidden="true">
      {shape}
    </svg>
  )
}

function LangSwitch() {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  return (
    <div className="lang-toggle" role="group" aria-label="Idioma / Language">
      {LANGS.map((l) => (
        <button key={l} type="button" className={l === lang ? 'active' : undefined} aria-pressed={l === lang} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export function Landing() {
  const lang = useLang((s) => s.lang)
  const c = COPY[lang]
  const f = c.features

  // The i18n store sets the playground's title on every language change; the landing keeps its own.
  useEffect(() => {
    document.title = c.title
  }, [c.title])

  const components = useMemo(
    () =>
      defaultRegistry.list().map((def) => ({
        type: def.type,
        icon: def.icon,
        color: def.type === 'client' ? CLIENT_COLORS[0] : toneColor(def.color),
        label: componentLabel(lang, def.type, def),
        summary: componentInfo(lang, def)?.summary ?? '',
      })),
    [lang],
  )

  return (
    <div className="landing">
      <header className="l-header">
        <div className="l-wrap l-header-row">
          <a className="l-logo" href="#top">
            <Logo />
            Nodarium
          </a>
          <nav className="l-nav" aria-label="Secciones">
            <a href="#features">{c.nav.features}</a>
            <a href="#components">{c.nav.components}</a>
            <a href={REPO_URL}>{c.nav.github}</a>
          </nav>
          <div className="toolbar l-header-tools">
            <LangSwitch />
          </div>
          <a className="l-btn primary" href={PLAY_PATH}>
            {c.open}
          </a>
        </div>
      </header>

      <main id="top">
        <section className="l-hero">
          <div className="l-wrap l-hero-text">
            <span className="l-pill">
              <i />
              {c.pill}
            </span>
            <h1>
              {c.h1a} <span>{c.h1b}</span>.
            </h1>
            <p className="l-lead">{c.lead}</p>
            <div className="l-cta">
              <a className="l-btn primary big" href={PLAY_PATH}>
                {c.open}
              </a>
              <a className="l-btn big" href="#features">
                {c.seeMore}
              </a>
            </div>
          </div>
          <div className="l-wrap l-demo-wrap">
            <Demo />
            <p className="l-demo-note">{c.demo.note}</p>
          </div>
        </section>

        <section className="l-section" id="features">
          <div className="l-wrap">
            <div className="l-sec-head">
              <span className="l-eyebrow">{f.eyebrow}</span>
              <h2>{f.title}</h2>
              <p>{f.lead}</p>
            </div>
            <div className="l-features">
              <article className="l-card">
                <h3>{f.packets.title}</h3>
                <p>{f.packets.text}</p>
                <div className="l-legend">
                  <span>
                    <PacketShape kind="request" />
                    {f.packets.legend.request}
                  </span>
                  <span>
                    <PacketShape kind="message" />
                    {f.packets.legend.message}
                  </span>
                  <span>
                    <PacketShape kind="event" />
                    {f.packets.legend.event}
                  </span>
                  <span>
                    <PacketShape kind="2xx" />
                    2xx
                  </span>
                  <span>
                    <PacketShape kind="4xx" />
                    4xx
                  </span>
                  <span>
                    <PacketShape kind="5xx" />
                    5xx
                  </span>
                </div>
              </article>
              <article className="l-card">
                <h3>{f.presets.title}</h3>
                <p>{f.presets.text}</p>
              </article>
              <article className="l-card">
                <h3>{f.text.title}</h3>
                <p>{f.text.text}</p>
                <pre>
                  <span className="k">client</span> Web{'\n'}
                  {'  '}rate: <span className="s">5</span>
                  {'\n\n'}
                  <span className="k">service</span> Api{'\n'}
                  {'  '}capacity: <span className="s">2</span>
                  {'\n'}
                  {'  '}processingTime: <span className="s">500ms</span>
                  {'\n\n'}
                  Web --&gt; Api
                </pre>
              </article>
              <article className="l-card">
                <h3>{f.dsl.title}</h3>
                <p>{f.dsl.text}</p>
                <pre>
                  <span className="k">on request</span> /ordenes:{'\n'}
                  {'  '}
                  <span className="k">call</span> Pagos /cobros <span className="k">or reply</span> <span className="x">402</span>
                  {'\n'}
                  {'  '}
                  <span className="k">publish</span> OrdenCreada{'\n'}
                  {'  '}
                  <span className="k">reply</span> 201
                </pre>
              </article>
            </div>
          </div>
        </section>

        <section className="l-section l-section-tight" id="components">
          <div className="l-wrap">
            <div className="l-sec-head">
              <span className="l-eyebrow">{c.components.eyebrow}</span>
              <h2>{c.components.title}</h2>
              <p>{c.components.lead}</p>
            </div>
            <ul className="l-comps">
              {components.map((comp) => (
                <li key={comp.type} className="l-comp" style={{ ['--node-color' as string]: comp.color }}>
                  <span className="l-comp-icon" aria-hidden="true">
                    <Icon name={comp.icon} size={22} />
                  </span>
                  <span>
                    <b>{comp.label}</b>
                    <small>{comp.summary}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="l-final">
          <div className="l-wrap l-final-row">
            <h2>{c.final}</h2>
            <a className="l-btn primary big" href={PLAY_PATH}>
              {c.open}
            </a>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-wrap l-footer-row">
          <span>nodarium.shichi.app</span>
          <a href={REPO_URL}>{c.footer}</a>
        </div>
      </footer>
      <Analytics beforeSend={stripHash} />
    </div>
  )
}
