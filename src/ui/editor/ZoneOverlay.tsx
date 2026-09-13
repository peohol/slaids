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
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ZoneBreadcrumb } from './ZoneBreadcrumb'

export interface ZoneActionMenuItem {
  id: string
  label: string
  icon: Parameters<typeof Icon>[0]['name']
  disabled?: boolean
  /** Shown instead of the label when the item is disabled, to say why. */
  reason?: string | null
  onSelect: () => void
}

export interface ZoneAction {
  id: string
  label: string
  icon: Parameters<typeof Icon>[0]['name']
  disabled?: boolean
  onSelect: () => void
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
  /** Ratio handles are only shown when a split is selected or hovered. */
  onHandleDown: (splitId: NodeId, boundaryIndex: number, event: React.PointerEvent) => void
  handleGap: number
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
}: ZoneOverlayProps) {
  const selectionOnly = purpose === 'selection'
  const nodes = collectNodes(slide.root)
  const selectedRect = selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined

  return (
    <div className="zone-overlay" data-testid="zone-overlay">
      {nodes.map((node) => {
        const rect = geometry.rects.get(node.id)
        if (!rect) return null
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
        if (selectionOnly || node.kind !== 'split') return null
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
                  onPointerDown={(event) => onHandleDown(node.id, index, event)}
                  onClick={(event) => event.stopPropagation()}
                />
              )
            })}
          </Fragment>
        )
      })}

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
                          <Icon name={action.icon} size={16} />
                        </button>
                      </Popover.Trigger>
                    </Tooltip>
                    <Popover.Portal>
                      <Popover.Content className="popover zone-action-menu" sideOffset={6}>
                        {action.menu.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="btn btn--sm"
                            data-testid={`zone-menu-${item.id}`}
                            disabled={item.disabled}
                            title={item.reason ?? undefined}
                            onClick={item.onSelect}
                          >
                            <Icon name={item.icon} size={15} /> {item.label}
                          </button>
                        ))}
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                ) : (
                  <Tooltip key={action.id} label={action.label}>
                    <button
                      type="button"
                      className="btn btn--sm btn--icon"
                      disabled={action.disabled}
                      onClick={action.onSelect}
                      data-testid={action.testId ?? `zone-action-${action.id}`}
                      aria-label={action.label}
                    >
                      <Icon name={action.icon} size={16} />
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
