import { useMemo, useState } from 'react'
import { useLang, useT } from '../i18n'
import { getPresets, TOPIC_COLORS, TOPICS } from '../presets'
import { rich } from './richText'
import { useEditor } from './store/editor'
import { useScenario } from './store/scenario'
import type { SimApi } from './runtime/useSimulation'
import { useIsland } from './useIsland'
import { useIsMobile } from './useIsMobile'
import { useLoadScenario } from './useLoadScenario'
import { Icon } from './Icon'

type Tab = 'how' | 'try'

/**
 * "How it works" for the loaded scenario: what you will find, what the architecture does step by
 * step, experiments to try, and the scenarios to compare with. Floats over the canvas; hidden for a
 * graph of the user's own, an emptied canvas, or when the user closed it.
 */
export function ScenarioGuide({ api }: { api: SimApi }) {
  const onPick = useLoadScenario(api)
  const lang = useLang((s) => s.lang)
  const t = useT()
  const currentId = useScenario((s) => s.currentId)
  const open = useScenario((s) => s.guideOpen)
  const empty = useEditor((s) => s.graph.nodes.length === 0)
  const presets = useMemo(() => getPresets(lang), [lang])
  const mobile = useIsMobile()
  const { attach, style, className: islandClass, grip } = useIsland('guide', !mobile)
  const [tab, setTab] = useState<{ id: string | null; tab: Tab }>({ id: currentId, tab: 'how' })
  const preset = presets.find((p) => p.id === currentId)
  if (!preset || !open || empty) return null
  // A new scenario opens on its steps.
  const active: Tab = tab.id === preset.id ? tab.tab : 'how'
  const topic = TOPICS.find((x) => x.id === preset.topic)!
  const position = topic.presets.indexOf(preset.id as never) + 1
  const compare = preset.compare.map((id) => presets.find((p) => p.id === id)).filter((p) => p !== undefined)

  return (
    <aside
      ref={attach}
      className={`scenario-guide${islandClass}`}
      aria-label={t('scenarios.guide')}
      style={{ ...style, ['--topic-color' as string]: TOPIC_COLORS[preset.topic] }}
    >
      {grip}
      <header className="scenario-guide-head">
        <span className="scenario-eyebrow">
          {t(`topics.${preset.topic}.name`)}
          {topic.presets.length > 1 && ` · ${t('scenarios.position', { i: position, n: topic.presets.length })}`}
        </span>
        <button type="button" className="scenario-guide-close" onClick={() => useScenario.getState().setGuideOpen(false)} aria-label={t('scenarios.hideGuide')} title={t('scenarios.hideGuide')}>
          <Icon name="close" />
        </button>
        <h2>{preset.name}</h2>
        <p className="scenario-guide-description">{preset.description}</p>
      </header>
      <div className="scenario-tabs" role="tablist" aria-label={t('scenarios.guide')}>
        {(['how', 'try'] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => setTab({ id: preset.id, tab: key })}>
            {t(key === 'how' ? 'scenarios.howTab' : 'scenarios.tryTab')}
          </button>
        ))}
      </div>
      <div className="scenario-guide-body" role="tabpanel">
        {active === 'how' ? (
          <ol className="scenario-steps">
            {preset.steps.map((s, i) => (
              <li key={i}>{rich(s)}</li>
            ))}
          </ol>
        ) : (
          <ul className="scenario-try">
            {preset.tryThis.map((s, i) => (
              <li key={i}>{rich(s)}</li>
            ))}
          </ul>
        )}
        {compare.length > 0 && (
          <div className="scenario-compare">
            <h3>{t('scenarios.compare')}</h3>
            <div className="scenario-compare-list">
              {compare.map((p) => (
                <button key={p.id} type="button" className="scenario-chip" onClick={() => onPick(p.id)}>
                  {p.name} →
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="scenario-guide-foot">{t('scenarios.startsPaused')}</p>
      </div>
    </aside>
  )
}
