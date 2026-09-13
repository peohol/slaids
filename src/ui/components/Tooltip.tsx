/** Tooltip primitive; a single provider is mounted at the app root. */

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={350}>{children}</TooltipPrimitive.Provider>
}

/**
 * `wrap` puts a plain span between the trigger and the child.
 *
 * A disabled button fires no pointer events, so a tooltip bound straight to one
 * never opens — and a disabled *choice* is exactly the case where the label is
 * the whole point: it is the only place the reason it cannot be used is written
 * down. The span is the element that listens, and the button inside it stays
 * properly disabled.
 */
export function Tooltip({
  label,
  wrap = false,
  children,
}: {
  label: string
  wrap?: boolean
  children: ReactNode
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        {wrap ? <span className="tooltip-anchor">{children}</span> : children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="tooltip" sideOffset={6}>
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
