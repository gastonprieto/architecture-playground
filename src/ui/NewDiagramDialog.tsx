import { useId, useRef } from 'react'
import { useT } from '../i18n'
import { Modal } from './Modal'
import { useNewDiagram } from './store/newDiagram'

/** Asks before "Nuevo" deletes every component. Cancel has the initial focus, so Enter does not delete. */
export function NewDiagramDialog() {
  const open = useNewDiagram((s) => s.open)
  if (!open) return null
  return <NewDiagramPanel />
}

function NewDiagramPanel() {
  const t = useT()
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const { opener, onConfirm, close } = useNewDiagram.getState()
  const confirm = () => {
    onConfirm?.()
    close()
  }
  return (
    <Modal className="info-panel confirm-dialog" labelledBy={titleId} onClose={close} opener={opener} initialFocus={cancelRef}>
      <header className="info-head">
        <span className="info-icon" aria-hidden="true">
          ⚠
        </span>
        <h2 id={titleId}>{t('newDiagram.title')}</h2>
      </header>
      <p className="confirm-body">{t('newDiagram.body')}</p>
      <div className="dsl-actions">
        <span className="dsl-actions-gap" />
        <button type="button" ref={cancelRef} onClick={close}>
          {t('newDiagram.cancel')}
        </button>
        <button type="button" className="danger" onClick={confirm}>
          {t('newDiagram.confirm')}
        </button>
      </div>
    </Modal>
  )
}
