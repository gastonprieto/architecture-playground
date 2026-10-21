import { useLang, useT } from '../i18n'
import { referenceRows } from './behaviorText'

/** DSL reference: keyword table, notes and the spec example. Shown in the editor and in the ⓘ panel. */
export function BehaviorReference() {
  const lang = useLang((s) => s.lang)
  const t = useT()
  return (
    <div className="dsl-ref-body">
      <table className="dsl-ref-table">
        <caption>{t('behavior.ref.keywords')}</caption>
        <tbody>
          {referenceRows(lang).map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <code>{r.syntax}</code>
              </th>
              <td>
                {r.text}
                {r.example && <pre className="dsl-ref-row-example">{r.example}</pre>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dsl-ref-notes">{t('behavior.ref.notes')}</p>
      <h4>{t('behavior.ref.example')}</h4>
      <pre className="dsl-ref-example">{t('behavior.ref.exampleText')}</pre>
    </div>
  )
}
