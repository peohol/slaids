/**
 * Where the selected zone sits in the tree, and the way to its neighbours.
 *
 * On a desktop this is a convenience over the arrow keys. On a touch screen it
 * is the only reliable way into a deeply nested layout: a zone two splits down
 * can be a few millimetres across on the stage, and no amount of aiming makes
 * that a target — but its parent is always one press away here.
 *
 * The path comes from the layout tree itself, so it can never disagree with
 * what the overlay is drawing.
 */

import { Fragment } from 'react'
import { breadcrumbLabels, pathToNode } from '../../domain/layout'
import type { LayoutNode, NodeId } from '../../domain/types'

export function ZoneBreadcrumb({
  root,
  nodeId,
  onSelect,
  testId = 'zone-breadcrumb',
}: {
  root: LayoutNode
  nodeId: NodeId
  onSelect: (nodeId: NodeId) => void
  testId?: string
}) {
  const ids = pathToNode(root, nodeId) ?? []
  const labels = breadcrumbLabels(root, nodeId)

  return (
    <nav className="zone-breadcrumb" aria-label="Plassering i sonetreet" data-testid={testId}>
      {labels.map((label, index) => (
        <Fragment key={ids[index] ?? index}>
          {index > 0 && <span className="zone-breadcrumb__sep" aria-hidden="true">›</span>}
          <button
            type="button"
            className="zone-breadcrumb__item"
            aria-current={index === labels.length - 1 ? 'location' : undefined}
            onClick={() => ids[index] && onSelect(ids[index])}
          >
            {label}
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
