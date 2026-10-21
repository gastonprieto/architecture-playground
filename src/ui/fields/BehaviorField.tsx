import { useId } from 'react'
import type { NodeId } from '../../engine/types'
import { useLang, useT } from '../../i18n'
import { behaviorSummary } from '../behaviorText'
import { useBehaviorEditor } from '../store/behaviorEditor'
import { useBehaviorStatus } from '../useBehaviorStatus'

/** Inspector field for the behavior DSL: a one-line summary and the button that opens the editor. */
export function BehaviorField({ nodeId, label, value }: { nodeId: NodeId; label: string; value: string }) {
  const lang = useLang((s) => s.lang)
  const t = useT()
  const open = useBehaviorEditor((s) => s.open)
  const status = useBehaviorStatus(nodeId, value)
  const labelId = useId()
  return (
    <div className="field" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="field-label">
        {label}
      </span>
      <div className="behavior-row">
        <span className={`behavior-summary ${status.kind}`}>{behaviorSummary(lang, status)}</span>
        <button type="button" onClick={(e) => open(nodeId, e.currentTarget)}>
          {t('behavior.edit')}
        </button>
      </div>
    </div>
  )
}
