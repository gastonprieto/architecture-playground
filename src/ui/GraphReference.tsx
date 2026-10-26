import { useLang, useT } from '../i18n'
import { graphReferenceRows } from './graphDslText'

/** Graph DSL reference: syntax table, notes and an example. Shown next to the "Texto" editor. */
export function GraphReference() {
  const lang = useLang((s) => s.lang)
  const t = useT()
  return (
    <div className="dsl-ref-body">
      <table className="dsl-ref-table">
        <caption>{t('graphText.ref.keywords')}</caption>
        <tbody>
          {graphReferenceRows(lang).map((r) => (
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
      <p className="dsl-ref-notes">{t('graphText.ref.notes')}</p>
      <h4>{t('graphText.ref.example')}</h4>
      <pre className="dsl-ref-example">{t('graphText.ref.exampleText')}</pre>
    </div>
  )
}
