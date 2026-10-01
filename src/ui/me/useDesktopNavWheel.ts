import { useEffect, useRef, useState } from 'react'

/** Wheel navigation stays inside a roomy desktop rail; a short rail still scrolls. */
export function useDesktopNavWheel(active: string, navigate: (key: string) => void) {
  const [nav, setNav] = useState<HTMLElement | null>(null)
  const current = useRef(active)
  current.current = active
  const gesture = useRef({ sum: 0, at: 0, switched: -Infinity })
  useEffect(() => {
    if (!nav) return
    const wheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
      if (!window.matchMedia('(min-width: 721px) and (hover: hover) and (pointer: fine)').matches
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
        || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)
        || nav.scrollHeight > nav.clientHeight + 1
        || target?.closest(`.nav-foot, ${editable}`)
        || document.activeElement?.closest(editable)
        || document.querySelector('[role="dialog"], [role="alertdialog"], .modal-bg')) {
        gesture.current.sum = 0
        return
      }
      const buttons = [...nav.querySelectorAll<HTMLButtonElement>('button[data-screen]')].filter(b => !b.disabled && b.getClientRects().length)
      const index = buttons.findIndex(b => b.dataset.screen === current.current)
      if (index < 0) return
      event.preventDefault()
      const now = performance.now(), g = gesture.current
      if (now - g.switched < 250) return
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? nav.clientHeight : 1)
      if (now - g.at > 180 || Math.sign(g.sum) !== Math.sign(delta)) g.sum = 0
      g.sum += delta; g.at = now
      if (Math.abs(g.sum) < 40) return
      const next = Math.max(0, Math.min(buttons.length - 1, index + Math.sign(g.sum)))
      g.sum = 0
      if (next === index) return
      g.switched = now
      const focusedRailButton = buttons.includes(document.activeElement as HTMLButtonElement)
      navigate(buttons[next].dataset.screen!)
      if (focusedRailButton) buttons[next].focus({ preventScroll: true })
    }
    nav.addEventListener('wheel', wheel, { passive: false })
    return () => nav.removeEventListener('wheel', wheel)
  }, [nav, navigate])
  return setNav
}
