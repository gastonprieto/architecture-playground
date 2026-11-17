import { fireEvent, screen } from '@testing-library/react'

/** Opens the toolbar's `⋯` menu (in either language) unless it is already open. */
export function openToolbarMenu() {
  const trigger = screen.getByRole('button', { name: /^(Más opciones|More options)$/ })
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
}
