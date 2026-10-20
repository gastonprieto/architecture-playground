import { useEffect, useState } from 'react'

export const MOBILE_MAX_WIDTH = 768

function detect(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < MOBILE_MAX_WIDTH || new URLSearchParams(window.location.search).get('mobile') === '1'
}

/** True on narrow screens or with `?mobile=1`; follows window resizes. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(detect)
  useEffect(() => {
    const onResize = () => setMobile(detect())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return mobile
}
