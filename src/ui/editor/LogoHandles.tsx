/**
 * Logoen dras og endres i størrelse rett på stagen (§ 15.3).
 *
 * Logoen slippes aldri fritt. Mens den dras, velger pekeren den nærmeste
 * plassen logoen kan stå på, og et håndtak velger en høyde innenfor det gruppen
 * har plass til. Begge deler regnes ut i `domain/logo.ts`, den samme koden som
 * tegner logoen, så forhåndsvisningen er nøyaktig det som lagres.
 *
 * Under draget lagres ingenting. `LogoDragScope` legger et forslag over
 * dekkets logo for stagen alene, så tittelen og sonene flytter seg med logoen
 * mens miniatyrbildene står. Slipp er én angrebar endring av temaet; Escape
 * eller en tapt peker avbryter, og da står alt som før.
 *
 * Draget går gjennom editorens ene `DndContext` (`EditorView`), som alle andre
 * dra i editoren, og pekerens vei regnes om fra skjermen til sidens
 * koordinater med stagens skala slik den faktisk er når draget starter.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useDndMonitor,
  useDraggable,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { LOGO_MOVE_HYSTERESIS } from '../../domain/constants'
import { updateThemeLogo } from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import {
  deckLogoLayout,
  logoChoiceOf,
  logoGroupOf,
  logoGroupPatch,
  logoGrowth,
  logoHandlesFor,
  logoLimits,
  logoMoveTargets,
  logoRectOnPage,
  nearestLogoTarget,
  resizedLogoHeight,
  withLogoPatch,
  type LogoChoice,
  type LogoGroup,
  type LogoHandle,
  type LogoMoveTarget,
  type LogoPage,
  type Point,
  type ThemeLogoPatch,
} from '../../domain/logo'
import type { Rect } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { SlideRenderProvider, useSlideRender } from '../slide/SlideRenderContext'

/** Hva dnd-kit kjenner draget som. Ett håndtak per id; flyttingen har sin egen. */
const DRAG_ID = 'theme-logo'
const MOVE_ID = `${DRAG_ID}:move`
const handleId = (handle: LogoHandle): string => `${DRAG_ID}:${handle}`

/** Håndtakenes side på skjermen, i piksler, uansett hvor liten stagen er. */
const HANDLE_SCREEN_PX = 12

/** Hvor mange håndtak høy logoen må være på skjermen før kantene får sine egne. */
const EDGE_HANDLES_FROM = 3

interface LogoPreview {
  patch: ThemeLogoPatch
  /** Flyttes logoen? Da glir den, tittelen og sonene til den nye plassen. */
  moving: boolean
}

interface LogoDragApi {
  setPreview: (preview: LogoPreview | null) => void
  moving: boolean
}

const LogoDragContext = createContext<LogoDragApi>({ setPreview: () => {}, moving: false })

/** Om logoen flyttes akkurat nå – stagen lar da tittel og soner gli med. */
export function useLogoMoving(): boolean {
  return useContext(LogoDragContext).moving
}

/**
 * Rammen rundt stagen som viser et dra i logoen før det er lagret.
 *
 * Bare stagen ser forslaget: et dra er ikke en endring før det slippes, og
 * miniatyrbildene skal ikke tegnes på nytt for hvert hakk pekeren tar.
 */
export function LogoDragScope({ children }: { children: ReactNode }) {
  const presentation = useEditorStore((state) => state.presentation)
  const render = useSlideRender()
  const [preview, setPreview] = useState<LogoPreview | null>(null)

  const value = useMemo(
    () =>
      preview && presentation
        ? { ...render, logo: deckLogoLayout(withLogoPatch(presentation, preview.patch)) }
        : render,
    [preview, presentation, render],
  )
  const api = useMemo(() => ({ setPreview, moving: preview?.moving ?? false }), [preview])

  return (
    <LogoDragContext.Provider value={api}>
      <SlideRenderProvider value={value}>{children}</SlideRenderProvider>
    </LogoDragContext.Provider>
  )
}

interface LogoDrag {
  /** `null` flytter logoen; et håndtak endrer størrelsen. */
  handle: LogoHandle | null
  group: LogoGroup
  /** Skjermpiksler per enhet på siden. */
  scale: number
  startChoice: LogoChoice
  choice: LogoChoice
  startHeight: number
  height: number
  startCentre: Point
  targets: readonly LogoMoveTarget[]
  limit: number
  growth: Point
  aspect: number
}

/**
 * Rammen og håndtakene over logoen på en side i editoren. Tegnes ikke når
 * logoen ikke står på siden.
 */
export function LogoHandles({ page, scale }: { page: LogoPage; scale: number }) {
  const { theme, logo } = useSlideRender()
  const { setPreview } = useContext(LogoDragContext)
  const run = useEditorStore((state) => state.run)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<LogoDrag | null>(null)
  const [dragging, setDragging] = useState(false)
  const rect = logoRectOnPage(logo, page, theme)

  const end = (): LogoDrag | null => {
    const current = drag.current
    drag.current = null
    setDragging(false)
    return current
  }

  const start = (event: DragStartEvent): void => {
    const data = event.active.data.current as { kind?: string; handle?: LogoHandle | null } | undefined
    if (data?.kind !== DRAG_ID) return
    const presentation = useEditorStore.getState().presentation
    const element = overlayRef.current
    const settings = presentation?.theme.logo
    const layout = presentation ? deckLogoLayout(presentation) : null
    const group = logoGroupOf(page)
    const drawn = layout?.[group]
    const shown = presentation ? logoRectOnPage(layout, page, presentation.theme) : null
    if (!presentation || !settings || !layout || !drawn || !shown || !element) return
    const handle = data.handle ?? null
    const choice = logoChoiceOf(settings, group)
    drag.current = {
      handle,
      group,
      // Lest av elementet, ikke av renderen: midt i en knipebevegelse er det
      // det som vises, og pekeren regnes om mot det.
      scale: element.getBoundingClientRect().width / shown.width || 1,
      startChoice: choice,
      choice,
      startHeight: drawn.height,
      height: drawn.height,
      startCentre: { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 },
      targets: handle === null ? logoMoveTargets(presentation, page) : [],
      limit: logoLimits(presentation)?.[group] ?? drawn.height,
      growth: logoGrowth(layout, page),
      aspect: layout.aspect,
    }
    setDragging(true)
    setPreview({ patch: {}, moving: handle === null })
  }

  const move = (event: DragMoveEvent): void => {
    const current = drag.current
    if (!current) return
    const delta = { x: event.delta.x / current.scale, y: event.delta.y / current.scale }
    if (current.handle === null) {
      const choice = nearestLogoTarget(
        current.targets,
        { x: current.startCentre.x + delta.x, y: current.startCentre.y + delta.y },
        current.choice,
        LOGO_MOVE_HYSTERESIS,
      )
      if (choice === current.choice) return
      current.choice = choice
      setPreview({ patch: logoGroupPatch(current.group, { choice }), moving: true })
      return
    }
    const height = resizedLogoHeight({
      height: current.startHeight,
      aspect: current.aspect,
      handle: current.handle,
      delta,
      growth: current.growth,
      limit: current.limit,
    })
    if (height === current.height) return
    current.height = height
    setPreview({ patch: logoGroupPatch(current.group, { height }), moving: false })
  }

  useDndMonitor({
    onDragStart: start,
    onDragMove: move,
    onDragEnd: () => {
      const finished = end()
      if (finished) {
        const change =
          finished.handle === null
            ? finished.choice !== finished.startChoice && { choice: finished.choice }
            : finished.height !== finished.startHeight && { height: finished.height }
        if (change) {
          const patch = logoGroupPatch(finished.group, change)
          run('theme-logo-drag', (presentation) => updateThemeLogo(presentation, patch, HUMAN_EDIT))
        }
      }
      setPreview(null)
    },
    onDragCancel: () => {
      if (end()) setPreview(null)
    },
  })

  if (!rect || !logo) return null
  // Er logoen liten på skjermen, ville håndtakene midt på kantene dekke den;
  // da står bare hjørnene.
  const roomless = Math.min(rect.width, rect.height) * (scale || 1) < HANDLE_SCREEN_PX * EDGE_HANDLES_FROM
  return (
    <LogoFrame
      rect={rect}
      overlayRef={overlayRef}
      dragging={dragging}
      handleSize={HANDLE_SCREEN_PX / (scale || 1)}
      handles={logoHandlesFor(logo, page).filter((handle) => !roomless || handle.length === 2)}
    />
  )
}

/**
 * Trykket er logoens: verken stagen (som ellers velger en sone, eller flytter
 * eller forstørrer visningen) eller klikket etter et dra skal få det.
 */
function keepPress(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

function LogoFrame({
  rect,
  overlayRef,
  dragging,
  handleSize,
  handles,
}: {
  rect: Rect
  overlayRef: React.MutableRefObject<HTMLDivElement | null>
  dragging: boolean
  handleSize: number
  /** Håndtakene på kanter som flytter seg når logoen vokser – se `logoHandlesFor`. */
  handles: readonly LogoHandle[]
}) {
  const { setNodeRef, listeners } = useDraggable({
    id: MOVE_ID,
    data: { kind: DRAG_ID, handle: null },
  })
  /*
   * Valgt med et trykk. En mus viser håndtakene når den holdes over logoen; en
   * finger har ingenting å holde over med, så der vises de etter et trykk og
   * forsvinner når det trykkes et annet sted.
   */
  const [chosen, setChosen] = useState(false)
  useEffect(() => {
    if (!chosen) return
    const elsewhere = (event: PointerEvent): void => {
      if (event.target instanceof Node && overlayRef.current?.contains(event.target)) return
      setChosen(false)
    }
    window.addEventListener('pointerdown', elsewhere, true)
    return () => window.removeEventListener('pointerdown', elsewhere, true)
  }, [chosen, overlayRef])
  return (
    <div
      ref={(element) => {
        overlayRef.current = element
        setNodeRef(element)
      }}
      className="logo-handles"
      data-testid="logo-handles"
      data-dragging={dragging ? '' : undefined}
      data-chosen={chosen ? '' : undefined}
      data-owns-gesture=""
      data-drag-activation="immediate"
      // Alt dette kan også gjøres i temaeditoren, med tastatur og skjermleser.
      aria-hidden="true"
      title="Dra for å flytte logoen. Dra i et hjørne eller en kant for å endre størrelsen."
      style={
        {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          '--logo-handle-size': `${handleSize}px`,
        } as React.CSSProperties
      }
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event)
        keepPress(event)
      }}
      onClick={(event) => {
        keepPress(event)
        setChosen(true)
      }}
      onDoubleClick={keepPress}
    >
      {handles.map((handle) => (
        <ResizeHandle key={handle} handle={handle} />
      ))}
    </div>
  )
}

function ResizeHandle({ handle }: { handle: LogoHandle }) {
  const { setNodeRef, listeners } = useDraggable({
    id: handleId(handle),
    data: { kind: DRAG_ID, handle },
  })
  return (
    <span
      ref={setNodeRef}
      className={`logo-handle logo-handle--${handle}`}
      data-testid={`logo-handle-${handle}`}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event)
        keepPress(event)
      }}
    />
  )
}
