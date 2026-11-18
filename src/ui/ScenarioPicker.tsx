import { useId, useRef, useState } from 'react'
import { useLang, useT } from '../i18n'
import { getPresets, TOPIC_COLORS, TOPICS, type TopicId } from '../presets'
import { Modal } from './Modal'
import { useScenario } from './store/scenario'
import type { SimApi } from './runtime/useSimulation'
import { useLoadScenario } from './useLoadScenario'
import { Icon } from './Icon'

/** Topics on the left (chips on a phone), the chosen topic's scenarios as cards on the right. */
export function ScenarioPicker({ api }: { api: SimApi }) {
  const onPick = useLoadScenario(api)
  const lang = useLang((s) => s.lang)
  const t = useT()
  const close = useScenario((s) => s.closePicker)
  const currentId = useScenario((s) => s.currentId)
  const [opener] = useState(() => useScenario.getState().opener)
  const presets = getPresets(lang)
  const current = presets.find((p) => p.id === currentId)
  const [topicId, setTopicId] = useState<TopicId>(current?.topic ?? TOPICS[0].id)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const topicPresets = presets.filter((p) => p.topic === topicId)

  return (
    <Modal className="scenario-picker" labelledBy={titleId} onClose={close} opener={opener} initialFocus={closeRef}>
      <header className="scenario-picker-head">
        <h2 id={titleId}>{t('scenarios.title')}</h2>
        <button type="button" className="info-close" ref={closeRef} onClick={close} aria-label={t('scenarios.close')}>
          <Icon name="close" />
        </button>
      </header>
      <div className="scenario-topics" role="tablist" aria-label={t('scenarios.topics')}>
        {TOPICS.map((topic) => (
          <button
            key={topic.id}
            type="button"
            role="tab"
            aria-selected={topic.id === topicId}
            className="scenario-topic"
            style={{ ['--topic-color' as string]: TOPIC_COLORS[topic.id] }}
            onClick={() => setTopicId(topic.id)}
          >
            <span className="scenario-topic-name">{t(`topics.${topic.id}.name`)}</span>
            <span className="scenario-topic-count">{topic.presets.length}</span>
            <span className="scenario-topic-question">{t(`topics.${topic.id}.question`)}</span>
          </button>
        ))}
      </div>
      <div className="scenario-topic-body" role="tabpanel" style={{ ['--topic-color' as string]: TOPIC_COLORS[topicId] }}>
        <div className="scenario-topic-intro">
          <h3>{t(`topics.${topicId}.name`)}</h3>
          <p>{t(`topics.${topicId}.intro`)}</p>
        </div>
        <div className="scenario-cards">
          {topicPresets.map((p) => (
            <button key={p.id} type="button" className="scenario-card" onClick={() => onPick(p.id)}>
              <span className="scenario-card-name">{p.name}</span>
              <span className="scenario-card-description">{p.description}</span>
              <span className="scenario-card-meta">
                <span className="scenario-pill">{t('scenarios.nodes', { n: p.graph.nodes.length })}</span>
                <span className="scenario-pill">{t('scenarios.steps', { n: p.steps.length })}</span>
                {p.id === currentId && <span className="scenario-pill current">{t('scenarios.current')}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
