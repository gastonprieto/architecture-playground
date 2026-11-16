/** Nodarium's mark: two nodes joined by a wire, with a request on its way. */
export function Logo({ className = 'logo-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 24" aria-hidden="true">
      <path d="M9 7 C18 7 18 17 27 17" fill="none" stroke="#8b97b5" strokeWidth="1.6" />
      <rect x="1" y="2" width="10" height="10" rx="3" fill="#111a33" stroke="#7dd3fc" strokeWidth="1.6" />
      <rect x="25" y="12" width="10" height="10" rx="3" fill="#111a33" stroke="#4ade80" strokeWidth="1.6" />
      <circle cx="18" cy="12" r="2.6" fill="#3b82f6" />
    </svg>
  )
}
