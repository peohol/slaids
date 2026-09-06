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
import { breadcrumbLabels } from '../../domain/layout'
import type { ContentSlide, LayoutNode, NodeId, Rect } from '../../domain/types'
import type { SlideGeometry } from '../../domain/geometry'
import { absoluteStyle } from '../slide/SlideView'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

export interface ZoneActionMenuItem {
  id: string
  label: string
  icon: Parameters<typeof Icon>[0]['name']
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
}: ZoneOverlayProps) {
  const nodes = collectNodes(slide.root)
  const selectedRect = selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined

  const breadcrumb = selectedNodeId ? breadcrumbLabels(slide.root, selectedNodeId) : []
  const breadcrumbIds: NodeId[] = []
  if (selectedNodeId) {
    let current: NodeId | null = selectedNodeId
    while (current) {
      breadcrumbIds.unshift(current)
      const parent = nodes.find(
        (node) => node.kind === 'split' && node.children.some((child) => child.id === current),
      )
      current = parent ? parent.id : null
    }
  }

  return (
    <div className="zone-overlay" data-testid="zone-overlay">
      {nodes.map((node) => {
        const rect = geometry.rects.get(node.id)
        if (!rect) return null
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
        if (node.kind !== 'split') return null
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

      {selectedRect && (
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
            // The stage hit-tests every click; overlay controls must not also
            // re-select whatever zone happens to sit underneath them — nor, on
            // the press, start dragging it around.
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="zone-breadcrumb" data-testid="zone-breadcrumb">
              {breadcrumb.map((label, index) => (
                <Fragment key={breadcrumbIds[index] ?? index}>
                  {index > 0 && <span className="zone-breadcrumb__sep">›</span>}
                  <button
                    type="button"
                    className="zone-breadcrumb__item"
                    onClick={() => breadcrumbIds[index] && onBreadcrumb(breadcrumbIds[index])}
                  >
                    {label}
                  </button>
                </Fragment>
              ))}
            </div>
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
