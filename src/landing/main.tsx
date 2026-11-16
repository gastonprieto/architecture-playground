import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { playUrlForLegacyHash } from './legacyLink'

// An old shared link (`/#g=…`) belongs to the playground: go there before drawing the landing.
const target = playUrlForLegacyHash(window.location.hash, window.location.search)
if (target) {
  window.location.replace(target)
} else {
  void import('./Landing').then(({ Landing }) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <Landing />
      </StrictMode>,
    )
  })
}
