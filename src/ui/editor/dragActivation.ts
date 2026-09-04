/**
 * How a pointer press turns into a drag.
 *
 * dnd-kit resolves one activation constraint per sensor, but a single editor
 * holds two kinds of drag surface with opposite needs. A dedicated handle
 * should drag on the first millimetre of movement — there is nothing else it
 * could mean. A surface that *also* answers a click — a slide in the filmstrip
 * navigates to that slide — must not: the smallest tremor between press and
 * release would then swallow the click and start reordering the deck instead.
 *
 * So the constraint is read from the DOM the press landed on rather than fixed
 * on the sensor: any element may carry `data-drag-activation`, and the nearest
 * one wins. The sensor knows nothing about slides, sandbox items or anything
 * else it might one day carry — it reads an attribute, and the component that
 * owns the surface decides what that surface means.
 */

import { PointerSensor, type PointerActivationConstraint, type PointerSensorProps } from '@dnd-kit/core'

export const DRAG_ACTIVATION_ATTRIBUTE = 'data-drag-activation'

export const DRAG_ACTIVATION = {
  /** A handle and nothing else: the smallest movement is a drag. */
  immediate: { distance: 4 },
  /**
   * A surface that also answers a click. The press has to be held before it
   * becomes a drag, and moving away during the hold cancels it — so a click
   * stays a click and a drag stays deliberate.
   */
  hold: { delay: 200, tolerance: 6 },
} as const satisfies Record<string, PointerActivationConstraint>

export type DragActivation = keyof typeof DRAG_ACTIVATION

function isActivation(value: string | null): value is DragActivation {
  return value !== null && value in DRAG_ACTIVATION
}

/** The activation the pressed element asks for, if any element in its line does. */
function activationFor(event: Event): PointerActivationConstraint | undefined {
  const target = event.target
  if (!(target instanceof Element)) return undefined
  const host = target.closest(`[${DRAG_ACTIVATION_ATTRIBUTE}]`)
  const asked = host?.getAttribute(DRAG_ACTIVATION_ATTRIBUTE) ?? null
  return isActivation(asked) ? DRAG_ACTIVATION[asked] : undefined
}

/**
 * The pointer sensor, with the activation constraint taken from the surface
 * that was pressed. Anything that asks for nothing keeps the constraint the
 * sensor was configured with.
 */
export class SurfacePointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    const asked = activationFor(props.event)
    super(asked ? { ...props, options: { ...props.options, activationConstraint: asked } } : props)
  }
}
