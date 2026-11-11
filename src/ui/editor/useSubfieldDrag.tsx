/**
 * Delestrekene mellom delfelt som håndtak i vanlig innholdsredigering.
 *
 * Hva et drag *bestemmer*, står i `subfieldDrag.ts` som rene funksjoner. Her
 * er resten: å måle delfeltene når streken trykkes, å følge pekeren, å holde
 * draget på den myke grensen (`softLimitDrag.ts`), å vise trinnet slippet ville
 * lagret, og å lagre det. Samme oppførsel som en sonegrense i sonemodus –
 * trinn, Shift, magneten, Escape – bare for delingen inni ett kort.
 *
 * Mens pekeren er nede tegnes sonen med forholdstallene trinnet ville lagret,
 * gjennom den vanlige rendereren. Det som vises, er derfor nøyaktig det som
 * lagres og presenteres; håndtaket selv er usynlig til pekeren er over det.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { setBodyWeights } from '../../domain/commands'
import { setBodyWeightsByHand } from '../../domain/commands/manualLayout'
import { FIT_TOLERANCE, SUBFIELD_DIVIDER_THICKNESS } from '../../domain/constants'
import { bodyOf, withBody } from '../../domain/content'
import { minimumSubfieldLength } from '../../domain/contentSize'
import { subfieldPart, type FitContext } from '../../domain/fit'
import { themeMetrics } from '../../domain/metrics'
import { isDocEmpty } from '../../domain/richdoc'
import type { CardBody, Presentation, Rect, ZoneContent } from '../../domain/types'
import { domFitCheckers, measureContentFit } from '../../state/measure'
import { useEditorStore } from '../../state/store'
import { useSlideRender } from '../slide/SlideRenderContext'
import {
  SOFT_LIMIT_RESISTANCE_PX,
  STEP_HYSTERESIS_PX,
  isPastSoftLimit,
  learnSoftLimit,
  magneticAmount,
  softThresholds,
  type ChildSoftLimit,
  type SoftThreshold,
} from './softLimitDrag'
import { shownSubfieldWeights, startSubfieldDrag, subfieldLengthsAt, type SubfieldDrag } from './subfieldDrag'

interface DragState {
  drag: SubfieldDrag
  body: CardBody
  /** Dokumentet da draget startet: hvert trinn prøves mot det. */
  presentation: Presentation
  startX: number
  startY: number
  pointerX: number
  pointerY: number
  shift: boolean
  limits: Map<number, ChildSoftLimit>
  thresholds: SoftThreshold[] | null
  /** Trinnet som vises, og hvor pekeren var da det ble valgt. */
  shown: { amount: number; weights: number[] | null; byHand: boolean } | null
  verdicts: Map<string, boolean>
  detach: () => void
}

export interface SubfieldDragHandles {
  /** Innholdet slik det skal tegnes nå: med trinnet et pågående drag viser. */
  content: ZoneContent
  /** Håndtaket over hver delestrek, eller ingenting når streken ikke kan dras. */
  renderDivider?: (boundary: number) => ReactNode
}

export function useSubfieldDrag({
  content,
  nodeId,
  slideId,
  rect,
  enabled,
}: {
  content: ZoneContent
  nodeId: string
  slideId: string
  /** Sonens rektangel på sliden: der den myke grensen måles. */
  rect: Rect | null
  enabled: boolean
}): SubfieldDragHandles {
  const run = useEditorStore((state) => state.run)
  const selectNode = useEditorStore((state) => state.selectNode)
  // Et delfelt måles i sonens eget rektangel, så bare typografi og sitatmerker teller.
  const { theme, numbering, authorYearLabels } = useSlideRender()
  const context: FitContext = { theme, numbering, authorYearLabels }
  const [preview, setPreview] = useState<{ boundary: number; weights: number[] | null } | null>(null)
  const stateRef = useRef<DragState | null>(null)

  // Lest gjennom en ref av lytterne, som lever lenger enn renderen som laget dem.
  const latest = useRef({ content, rect, context })
  useEffect(() => {
    latest.current = { content, rect, context }
  })

  const end = useCallback((): DragState | null => {
    const state = stateRef.current
    stateRef.current = null
    state?.detach()
    setPreview(null)
    return state
  }, [])

  // Et drag som fortsatt pågår når sonen forsvinner, slippes uten å lagre.
  useEffect(() => () => void end(), [end])

  const body = bodyOf(content)
  const tokens = themeMetrics(context.theme)

  const begin = (boundary: number, event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || stateRef.current || !body) return
    const presentation = useEditorStore.getState().presentation
    const container = event.currentTarget.closest('.subfields')
    if (!presentation || !(container instanceof HTMLElement)) return
    const axis = body.axis
    const fields = [...container.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('subfield'),
    )
    // Alt regnes i skjermpiksler: pekeren, magneten og trinnenes hysterese er
    // det allerede, og delfeltene har samme forhold seg imellom på skjermen som
    // i layouten, også når sonen tegnes forminsket.
    const lengths = fields.map((field) => {
      const box = field.getBoundingClientRect()
      return axis === 'x' ? box.width : box.height
    })
    const box = container.getBoundingClientRect()
    const layout = axis === 'x' ? container.offsetWidth : container.offsetHeight
    const screenPerLayout = layout > 0 ? (axis === 'x' ? box.width : box.height) / layout : 1
    const drag = startSubfieldDrag({
      boundary,
      axis,
      weights: body.weights,
      lengths,
      floor: minimumSubfieldLength(tokens) * screenPerLayout,
    })
    if (!drag) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    selectNode(nodeId)

    const state: DragState = {
      drag,
      body,
      presentation,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      shift: event.shiftKey,
      limits: new Map(),
      thresholds: null,
      shown: null,
      verdicts: new Map(),
      detach: () => {},
    }

    /** Om delfelt `index` sitt innhold får plass i normal størrelse med lengden `length`. */
    const fitsAt = (index: number, length: number): boolean => {
      const { content: current, rect: zone, context: currentContext } = latest.current
      if (!zone) return true
      // Hvert delfelt legges ut for seg, så bare dets egen andel teller: de
      // andre deler resten i forholdet de hadde.
      const start = drag.lengths[index]
      const room = drag.lengths.reduce((sum, value) => sum + value, 0)
      const others = room - start
      const factor = others > 0 ? (room - length) / others : 0
      const weights = drag.lengths.map((value, position) => (position === index ? length : value * factor))
      const probe = withBody(current, { ...state.body, weights })
      const result = measureContentFit(probe, zone, currentContext)
      const overflow = result.parts?.[subfieldPart(state.body.subfields[index].id)] ?? result.overflow
      return overflow <= FIT_TOLERANCE
    }

    /** Lær den myke grensen til hvert delfelt draget faktisk endrer, der den betyr noe. */
    const learnLimits = (lengthsNow: readonly number[]): boolean => {
      const room = drag.lengths.reduce((sum, value) => sum + value, 0)
      let learnt = false
      state.body.subfields.forEach((field, index) => {
        if (isDocEmpty(field.doc)) return
        const start = drag.lengths[index]
        if (Math.abs(lengthsNow[index] - start) < 1e-9) return
        const known = state.limits.get(index)
        const limit = learnSoftLimit(known, index, start, lengthsNow[index], drag.floors[index], room, (length) =>
          fitsAt(index, length),
        )
        if (limit === known) return
        state.limits.set(index, limit)
        learnt = true
      })
      return learnt
    }

    /** Om slippet ville lagret `weights`: den samme kommandoen, spurt på forhånd. */
    const accepts = (weights: number[], byHand: boolean): boolean => {
      const key = `${byHand ? 'hand' : 'fit'}|${weights.join(',')}`
      let verdict = state.verdicts.get(key)
      if (verdict === undefined) {
        verdict = commitWeights(state.presentation, { slideId, nodeId, weights }, byHand).ok
        state.verdicts.set(key, verdict)
      }
      return verdict
    }

    const show = (): void => {
      const along = axis === 'x' ? state.pointerX - state.startX : state.pointerY - state.startY
      const lengthsAt = (amount: number): number[] | null => subfieldLengthsAt(drag, amount, state.shift)
      const rawLengths = lengthsAt(along)
      if (!rawLengths) return
      if (latest.current.rect && learnLimits(rawLengths)) state.thresholds = null
      const limits = [...state.limits.values()]
      const room = drag.lengths.reduce((sum, value) => sum + value, 0)
      state.thresholds ??= softThresholds(lengthsAt, limits, room * 4)
      const amount = magneticAmount(along, state.thresholds, SOFT_LIMIT_RESISTANCE_PX)
      const lengths = lengthsAt(amount)
      if (!lengths) return
      const byHand = isPastSoftLimit(lengths, drag.lengths, limits)
      const kept = state.shown
      if (kept && kept.byHand === byHand && Math.abs(amount - kept.amount) < STEP_HYSTERESIS_PX) return
      const weights = shownSubfieldWeights(drag, lengths, state.shift, (candidate) => accepts(candidate, byHand))
      state.shown = { amount, weights, byHand }
      setPreview({ boundary, weights })
    }

    /** Shift trykket eller sluppet midt i draget: samme trykk, den andre gesten. */
    const followShift = (shift: boolean): void => {
      if (shift === state.shift) return
      state.shift = shift
      state.thresholds = null
      state.shown = null
      show()
    }

    const move = (moved: PointerEvent): void => {
      state.pointerX = moved.clientX
      state.pointerY = moved.clientY
      if (moved.shiftKey !== state.shift) followShift(moved.shiftKey)
      else show()
    }

    const up = (): void => {
      const finished = end()
      const shown = finished?.shown
      if (!shown?.weights) return
      const { weights, byHand } = shown
      run('subfield-weights', (current) => commitWeights(current, { slideId, nodeId, weights }, byHand))
    }

    const key = (pressed: KeyboardEvent): void => {
      if (pressed.key === 'Shift') {
        // Modifikatoren, ikke tasten: med begge Shift-tastene nede holdes Shift fortsatt.
        followShift(pressed.getModifierState('Shift'))
        return
      }
      if (pressed.key !== 'Escape' || pressed.type !== 'keydown') return
      pressed.preventDefault()
      pressed.stopPropagation()
      end()
    }

    const cancel = (): void => void end()

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    state.detach = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
    }
    stateRef.current = state
    setPreview({ boundary, weights: null })
  }

  if (!body || body.subfields.length < 2) return { content }

  const shown = preview?.weights ? withBody(content, { ...body, weights: preview.weights }) : content
  if (!enabled) return { content: shown }

  // Håndtaket dekker streken og mellomrommet på begge sider av den – akkurat
  // plassen mellom to felt, så det aldri ligger over tekst.
  const reach = tokens.subfieldGap * 2 + SUBFIELD_DIVIDER_THICKNESS
  const axis = body.axis
  return {
    content: shown,
    renderDivider: (boundary) => (
      <span
        className={`zone-handle zone-handle--${axis} subfield-handle`}
        data-testid={`subfield-divider-${boundary}`}
        data-active={preview?.boundary === boundary ? '' : undefined}
        data-owns-gesture=""
        aria-hidden="true"
        style={
          axis === 'x'
            ? { top: 0, bottom: 0, left: '50%', width: reach, transform: 'translateX(-50%)' }
            : { left: 0, right: 0, top: '50%', height: reach, transform: 'translateY(-50%)' }
        }
        onPointerDown={(event) => begin(boundary, event)}
      />
    ),
  }
}

/**
 * Lagre forholdstallene et drag landet på. Med en person som har tatt et
 * delfelt under det teksten trenger i normal størrelse, går det gjennom
 * `manualLayout.ts` og teksten tegnes mindre; ellers gjennom den vanlige
 * kommandoen med fit-regelen – slik et sonedrag velger inngang.
 */
function commitWeights(
  presentation: Presentation,
  target: { slideId: string; nodeId: string; weights: number[] },
  byHand: boolean,
) {
  return byHand
    ? setBodyWeightsByHand(presentation, target)
    : setBodyWeights(presentation, { ...target, ...domFitCheckers })
}
