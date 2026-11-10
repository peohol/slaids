/**
 * How a pointer press turns into a drag.
 *
 * dnd-kit resolves one activation constraint per sensor, but a single editor
 * holds two kinds of drag surface with opposite needs. A dedicated handle
 * should drag on the first millimetre of movement — there is nothing else it
 * could mean. A surface that *also* answers a click — a slide in the filmstrip
 * navigates to that slide — must not: a press that wobbles a pixel must stay a
 * click, and on a touch screen a swipe across it must still scroll the strip.
 *
 * So the constraint is read from the DOM the press landed on rather than fixed
 * on the sensor: any element may carry `data-drag-activation`, and the nearest
 * one wins. The sensor knows nothing about slides, sandbox items or anything
 * else it might one day carry — it reads an attribute, and the component that
 * owns the surface decides what that surface means.
 *
 * And the constraint depends on what pressed. A mouse has no swipe to protect,
 * so a surface drags as soon as the pointer has clearly moved; a finger has to
 * rest first, or every scroll of the strip would pick up a slide.
 */

import {
  PointerSensor,
  useSensor,
  type PointerActivationConstraint,
  type PointerSensorOptions,
  type PointerSensorProps,
  type SensorDescriptor,
} from '@dnd-kit/core'
import { DRAG_THRESHOLDS } from '../components/reorderDrag'

export const DRAG_ACTIVATION_ATTRIBUTE = 'data-drag-activation'

/** One activation per kind of pointer: a mouse or pen, and a finger. */
interface Activation {
  pointer: PointerActivationConstraint
  touch: PointerActivationConstraint
}

const IMMEDIATE: PointerActivationConstraint = { distance: 4 }

export const DRAG_ACTIVATION = {
  /** A handle and nothing else: the smallest movement is a drag. */
  immediate: { pointer: IMMEDIATE, touch: IMMEDIATE },
  /**
   * A surface that also answers a click. A mouse drags it once it has moved
   * further than a click wobbles; a finger has to hold it first, and moving
   * away during the hold is a swipe, which scrolls instead.
   */
  surface: {
    pointer: { distance: DRAG_THRESHOLDS.mouseMove },
    touch: {
      delay: DRAG_THRESHOLDS.holdMs,
      tolerance: DRAG_THRESHOLDS.holdMove,
    },
  },
} as const satisfies Record<string, Activation>

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
  if (!isActivation(asked)) return undefined
  const touch = 'pointerType' in event && event.pointerType === 'touch'
  return DRAG_ACTIVATION[asked][touch ? 'touch' : 'pointer']
}

/**
 * The pointer sensor, with the activation constraint taken from the surface
 * that was pressed. Anything that asks for nothing keeps the constraint the
 * sensor was configured with.
 */
export class SurfacePointerSensor extends PointerSensor {
  constructor(props: PointerSensorProps) {
    const asked = activationFor(props.event)
    super(
      asked
        ? {
            ...props,
            options: { ...props.options, activationConstraint: asked },
          }
        : props,
    )
  }
}

/**
 * The pointer sensor every sortable surface uses, configured once.
 *
 * Its default is a handle's (`immediate`); a surface that also answers a click
 * asks for more on its own element. A list that wants keys as well adds the
 * keyboard sensor beside it.
 */
export function useSurfacePointerSensor(): SensorDescriptor<PointerSensorOptions> {
  const options: PointerSensorOptions = { activationConstraint: DRAG_ACTIVATION.immediate.pointer }
  return useSensor(SurfacePointerSensor, options)
}
