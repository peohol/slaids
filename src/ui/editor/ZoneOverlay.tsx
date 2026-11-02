/**
 * Zone-editing chrome drawn on top of a slide.
 *
 * Everything here is positioned from the geometry engine, including the ratio
 * drag handles, so the overlay can never disagree with what is rendered.
 *
 * It is drawn *around* the zones, never across them: which zone is selected or
 * hovered is a property of its edge. The slide underneath has to look the same
 * in zone mode as it does while its text is edited and as it does on screen —
 * an author arranging zones is looking at the slide, not at chrome.
 */

import { Fragment } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { collectNodes, findNode } from '../../domain/layout'
import type { ContentSlide, LayoutNode, NodeId, Rect } from '../../domain/types'
import type { SlideGeometry } from '../../domain/geometry'
import { absoluteStyle } from '../slide/SlideView'
import { Icon, type IconTone } from '../components/Icon'
import { pressedButton } from '../components/pressed'
import { Tooltip } from '../components/Tooltip'
import { unavailable } from '../components/unavailable'
import { ZoneBreadcrumb } from './ZoneBreadcrumb'
import { edgeGrips, type EdgeGrip } from './spanDrag'
import type { ZoneDragStart } from './zoneGesture'

export interface ZoneActionMenuItem {
  id: string
  label: string
  icon: Parameters<typeof Icon>[0]['name']
  tone?: IconTone
  /** The choice in force, marked as every other surface marks it. */
  checked?: boolean
  disabled?: boolean
  /** Shown instead of the label when the item is disabled, to say why. */
  reason?: string | null
  onSelect: () => void
}

export interface ZoneAction {
  id: string
  label: string
  icon: Parameters<typeof Icon>[0]['name']
  tone?: IconTone
  /**
   * What the action is about: the content in the zone, or the zone itself.
   * The inspector files each action under that heading; the icon row over the
   * zone simply lists them.
   */
  group: 'content' | 'zone'
  /** Removes something; offered last and marked as such. */
  danger?: boolean
  disabled?: boolean
  /** Why it is disabled, said beside it — not only in a tooltip a finger cannot raise. */
  reason?: string | null
  /** Called with the control that was pressed, for an action that opens beside it. */
  onSelect: (control: HTMLElement) => void
  /** When present, the button opens this menu instead of acting directly. */
  menu?: ZoneActionMenuItem[]
  testId?: string
}

export interface ZoneOverlayProps {
  slide: ContentSlide
  geometry: SlideGeometry
  selectedNodeId: NodeId | null
  hoveredNodeId: NodeId | null
  scale: number
  actions: ZoneAction[]
  onBreadcrumb: (nodeId: NodeId) => void
  /**
   * A press on a handle: a divider between two zones, or an outer edge of the
   * selected zone. `select` is the zone the press is about. Shift is read here,
   * at the press, and holds for the whole drag.
   */
  onHandleDown: (start: ZoneDragStart, select: NodeId, event: React.PointerEvent) => void
  handleGap: number
  /**
   * The zones a drag in flight is acting on as one — drawn as one block — or
   * `null` when nothing is being dragged. While a drag runs the handles are
   * not drawn: the layout under them is the drag's, not the slide's.
   */
  dragging?: { ids: readonly NodeId[] } | null
  /**
   * Whether the breadcrumb and the action buttons are drawn on the slide.
   *
   * They are undone by the stage's scale so they stay a comfortable size —
   * which is exactly what makes them wrong on a compact workspace, where a
   * screen-sized toolbar would cover most of a thumbnail-sized slide. There
   * they live in the zone panel instead, and the slide keeps its outlines.
   */
  chrome?: boolean
  /**
   * What the overlay is for.
   *
   * `zones` is zone mode: every zone outlined, hover, ratio handles, and the
   * action toolbar where there is room for it.
   *
   * `selection` is a compact workspace's *content* mode, where a press on the
   * slide selects a zone rather than putting a caret in it. The only thing
   * there is to show then is which zone that press landed on — outlining the
   * rest would say the workspace is in zone mode when it is not, and a ratio
   * handle would offer a drag the mode does not answer.
   */
  purpose?: 'zones' | 'selection'
}

/** How thick an edge grip is on screen, whatever the slide's scale. */
const EDGE_GRIP_PX = 12

const EDGE_GRIP_HINT = 'Dra innover for å komprimere fra denne siden. Hold Shift for å komprimere fra begge sider.'

/** The strip just inside `rect` along one of its edges. */
function gripRect(rect: Rect, grip: EdgeGrip, thickness: number): Rect {
  const across = Math.min(thickness, (grip.axis === 'x' ? rect.width : rect.height) / 3)
  if (grip.axis === 'x') {
    return {
      x: grip.side === 'start' ? rect.x : rect.x + rect.width - across,
      y: rect.y,
      width: across,
      height: rect.height,
    }
  }
  return {
    x: rect.x,
    y: grip.side === 'start' ? rect.y : rect.y + rect.height - across,
    width: rect.width,
    height: across,
  }
}

/** The smallest rect around all of `rects`, ignoring missing ones. */
function unionOf(rects: Array<Rect | undefined>): Rect | null {
  const present = rects.filter((rect): rect is Rect => rect !== undefined)
  if (present.length === 0) return null
  const left = Math.min(...present.map((rect) => rect.x))
  const top = Math.min(...present.map((rect) => rect.y))
  const right = Math.max(...present.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...present.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function isDescendant(root: LayoutNode, ancestorId: NodeId, nodeId: NodeId): boolean {
  const ancestor = findNode(root, ancestorId)
  if (!ancestor) return false
  return collectNodes(ancestor).some((node) => node.id === nodeId)
}

export function ZoneOverlay({
  slide,
  geometry,
  selectedNodeId,
  hoveredNodeId,
  scale,
  actions,
  onBreadcrumb,
  onHandleDown,
  handleGap,
  chrome = true,
  purpose = 'zones',
  dragging = null,
}: ZoneOverlayProps) {
  const selectionOnly = purpose === 'selection'
  const nodes = collectNodes(slide.root)
  const selectedRect = selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined
  const handles = !selectionOnly && !dragging
  const grips =
    handles && selectedNodeId && selectedRect ? edgeGrips(slide.root, selectedNodeId) : []
  const activeRect = dragging ? unionOf(dragging.ids.map((id) => geometry.rects.get(id))) : null

  return (
    <div className="zone-overlay" data-testid="zone-overlay">
      {nodes.map((node) => {
        const rect = geometry.rects.get(node.id)
        // Air a drag is fading in or out has no room yet, and no outline.
        if (!rect || rect.width < 1 || rect.height < 1) return null
        if (selectionOnly && node.id !== selectedNodeId) return null
        const selected = node.id === selectedNodeId
        const hovered = !selected && node.id === hoveredNodeId
        const inSelection =
          selectedNodeId !== null && !selected && isDescendant(slide.root, selectedNodeId, node.id)
        return (
          <div
            key={node.id}
            className={[
              'zone-outline',
              selected ? 'zone-outline--selected' : '',
              hovered ? 'zone-outline--hover' : '',
              inSelection ? 'zone-outline--in-selection' : '',
              node.kind === 'split' ? 'zone-outline--split' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={absoluteStyle(rect)}
            data-node-outline={node.id}
          />
        )
      })}

      {/* Ratio drag handles sit exactly in the gap between siblings. */}
      {nodes.map((node) => {
        if (!handles || node.kind !== 'split') return null
        const parentRect = geometry.rects.get(node.id)
        if (!parentRect) return null
        return (
          <Fragment key={`handles-${node.id}`}>
            {node.children.slice(0, -1).map((child, index) => {
              const a = geometry.rects.get(child.id)
              const b = geometry.rects.get(node.children[index + 1].id)
              if (!a || !b) return null
              const rect: Rect =
                node.axis === 'x'
                  ? { x: a.x + a.width, y: parentRect.y, width: handleGap, height: parentRect.height }
                  : { x: parentRect.x, y: a.y + a.height, width: parentRect.width, height: handleGap }
              return (
                <div
                  key={`${node.id}-${index}`}
                  className={`zone-handle zone-handle--${node.axis}`}
                  style={absoluteStyle(rect)}
                  data-testid="ratio-handle"
                  data-split-id={node.id}
                  data-boundary={index}
                  onPointerDown={(event) =>
                    onHandleDown(
                      { kind: 'boundary', splitId: node.id, boundary: index, shift: event.shiftKey },
                      node.id,
                      event,
                    )
                  }
                  onClick={(event) => event.stopPropagation()}
                />
              )
            })}
          </Fragment>
        )
      })}

      {/* The selected zone's outer edges, which compress it inwards. */}
      {selectedRect &&
        selectedNodeId &&
        grips.map((grip) => (
          <div
            key={`grip-${grip.axis}-${grip.side}`}
            className={`zone-edge-grip zone-edge-grip--${grip.axis} zone-edge-grip--${grip.side}`}
            style={absoluteStyle(gripRect(selectedRect, grip, EDGE_GRIP_PX / scale))}
            data-testid="edge-grip"
            data-axis={grip.axis}
            data-side={grip.side}
            title={EDGE_GRIP_HINT}
            onPointerDown={(event) =>
              onHandleDown(
                {
                  kind: 'edge',
                  nodeId: selectedNodeId,
                  axis: grip.axis,
                  side: grip.side,
                  shift: event.shiftKey,
                },
                selectedNodeId,
                event,
              )
            }
            onClick={(event) => event.stopPropagation()}
          />
        ))}

      {activeRect && (
        <div className="zone-outline zone-outline--active" style={absoluteStyle(activeRect)} data-testid="drag-block" />
      )}

      {chrome && selectedRect && selectedNodeId && (
        <div
          className="zone-actions-anchor"
          style={{
            position: 'absolute',
            left: selectedRect.x,
            top: selectedRect.y,
            width: selectedRect.width,
            height: selectedRect.height,
          }}
        >
          <div
            className="zone-actions"
            style={{ transform: `scale(${1 / scale})`, transformOrigin: 'top left' }}
            // Only the controls reach these handlers — the toolbar around them
            // takes no pointer events at all, so a press on its padding goes
            // through to the zone. A press that does land on a control must not
            // also re-select the zone underneath it, or start dragging that zone
            // around instead of pressing the button.
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ZoneBreadcrumb root={slide.root} nodeId={selectedNodeId} onSelect={onBreadcrumb} />
            <div className="zone-actions__buttons">
              {actions.map((action) =>
                action.menu ? (
                  <Popover.Root key={action.id}>
                    <Tooltip label={action.label}>
                      <Popover.Trigger asChild>
                        <button
                          type="button"
                          className="btn btn--sm btn--icon"
                          disabled={action.disabled}
                          data-testid={action.testId ?? `zone-action-${action.id}`}
                          aria-label={action.label}
                        >
                          <Icon name={action.icon} size={16} tone={action.tone} />
                        </button>
                      </Popover.Trigger>
                    </Tooltip>
                    <Popover.Portal>
                      <Popover.Content className="popover zone-action-menu" sideOffset={6}>
                        {action.menu.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            {...pressedButton('btn btn--sm', item.checked === true)}
                            data-testid={`zone-menu-${item.id}`}
                            disabled={item.disabled}
                            title={item.reason ?? undefined}
                            onClick={item.onSelect}
                          >
                            <Icon name={item.icon} size={15} tone={item.tone} /> {item.label}
                          </button>
                        ))}
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                ) : (
                  <Tooltip
                    key={action.id}
                    label={action.disabled && action.reason ? `${action.label}: ${action.reason}` : action.label}
                  >
                    <button
                      type="button"
                      className="btn btn--sm btn--icon"
                      onClick={(event) => action.onSelect(event.currentTarget)}
                      {...unavailable(action.disabled === true)}
                      data-testid={action.testId ?? `zone-action-${action.id}`}
                      aria-label={action.label}
                    >
                      <Icon name={action.icon} size={16} tone={action.tone} />
                    </button>
                  </Tooltip>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
