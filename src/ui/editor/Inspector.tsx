/**
 * Properties panel for the selected zone.
 *
 * This is where the zone-level and content-level domain commands are exposed:
 * split, clear, delete, content type, colours, subfields and container payload.
 */

import { useState } from 'react'
import {
  setBodyAxis,
  setBodyWeights,
  setCardColor,
  setContainerPayload,
  setContentKind,
  setSubfieldCount,
} from '../../domain/commands'
import { CONTENT_KIND_LABELS, defaultShape } from '../../domain/content'
import { emptyDoc, isDocEmpty } from '../../domain/richdoc'
import { breadcrumbLabels, findLeaf, findNode } from '../../domain/layout'
import { computeSlideGeometry } from '../../domain/geometry'
import { useEditorStore } from '../../state/store'
import type { Axis, ContainerPayload, ShapeKind, Slide, ZoneContentKind } from '../../domain/types'
import { ColorSwatchGrid } from '../components/ColorPicker'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon, type IconName } from '../components/Icon'
import type { ZoneAction } from './ZoneOverlay'

const CONTENT_ICONS: Record<ZoneContentKind, IconName> = {
  container: 'container',
  'untitled-card': 'card',
  'titled-card': 'card-titled',
}

/** Does replacing this payload throw away something the user made? */
function payloadHasWork(payload: ContainerPayload): boolean {
  if (payload.type === 'richdoc') return !isDocEmpty(payload.doc)
  if (payload.type === 'shape') {
    const fallback = defaultShape()
    return (
      payload.shape.kind !== fallback.kind ||
      payload.shape.fill !== fallback.fill ||
      payload.shape.stroke !== fallback.stroke ||
      payload.shape.strokeWidth !== fallback.strokeWidth
    )
  }
  return true
}

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rektangel',
  ellipse: 'Ellipse',
  triangle: 'Trekant',
  line: 'Linje',
  arrow: 'Pil',
}

export function Inspector({
  slide,
  actions,
  onAddContent,
}: {
  slide: Slide
  actions: ZoneAction[]
  onAddContent: (nodeId: string, kind: ZoneContentKind) => void
}) {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const run = useEditorStore((state) => state.run)
  /** A payload switch that would destroy content, waiting for confirmation. */
  const [pendingPayload, setPendingPayload] = useState<{
    nodeId: string
    payload: ContainerPayload
  } | null>(null)

  const node = selectedNodeId ? findNode(slide.root, selectedNodeId) : null
  const leaf = selectedNodeId ? findLeaf(slide.root, selectedNodeId) : null
  const content = leaf?.content ?? null
  const geometry = computeSlideGeometry(slide)
  const rect = selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined
  const breadcrumb = selectedNodeId ? breadcrumbLabels(slide.root, selectedNodeId) : []

  if (!node || !selectedNodeId) {
    return (
      <aside className="inspector" data-testid="inspector">
        <p className="hint">Ingen sone er valgt.</p>
      </aside>
    )
  }

  const applyPayload = (nodeId: string, payload: ContainerPayload): void => {
    run('container-payload', (current) =>
      setContainerPayload(current, { slideId: slide.id, nodeId, payload }),
    )
  }

  /**
   * Picking the type that is already active must not wipe the container: an
   * extra click on the highlighted button is the easiest mistake to make. A
   * real switch away from authored content asks first.
   */
  const requestPayload = (payload: ContainerPayload): void => {
    if (!content || content.kind !== 'container') return
    if (content.payload.type === payload.type) return
    if (payloadHasWork(content.payload)) {
      setPendingPayload({ nodeId: selectedNodeId, payload })
      return
    }
    applyPayload(selectedNodeId, payload)
  }

  return (
    <aside className="inspector" data-testid="inspector">
      <section className="inspector__section">
        <h2 className="inspector__heading">Sone</h2>
        <div className="inspector__row">
          <span className="hint">{breadcrumb.join(' › ')}</span>
        </div>
        <div className="inspector__row">
          <span className="hint">
            {node.kind === 'split'
              ? `Delt i ${node.children.length} (${node.axis === 'x' ? 'side ved side' : 'over/under'})`
              : 'Bladsone'}
          </span>
        </div>
        {rect && (
          <div className="inspector__row">
            <span className="hint" data-testid="inspector-size">
              {Math.round(rect.width)} × {Math.round(rect.height)} px
            </span>
          </div>
        )}
        <div className="inspector__actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="btn btn--sm"
              disabled={action.disabled}
              onClick={action.onSelect}
              data-testid={`inspector-action-${action.id}`}
            >
              <Icon name={action.icon} size={14} /> {action.label}
            </button>
          ))}
        </div>
      </section>

      {node.kind === 'split' && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Forholdstall</h2>
          <p className="hint">{node.weights.map((weight) => round(weight)).join(' : ')}</p>
          <p className="hint">Dra i mellomrommet mellom subsonene for å justere.</p>
        </section>
      )}

      {leaf && !content && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Innhold</h2>
          <div className="inspector__actions">
            {(Object.keys(CONTENT_ICONS) as ZoneContentKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className="btn btn--sm"
                data-testid={`inspector-add-${kind}`}
                onClick={() => onAddContent(selectedNodeId, kind)}
              >
                <Icon name={CONTENT_ICONS[kind]} size={14} /> {CONTENT_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </section>
      )}

      {content && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Innholdstype</h2>
          <div className="inspector__actions">
            {(Object.keys(CONTENT_ICONS) as ZoneContentKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={content.kind === kind ? 'btn btn--sm btn--active' : 'btn btn--sm'}
                data-testid={`inspector-kind-${kind}`}
                onClick={() =>
                  run('content-kind', (current) =>
                    setContentKind(current, { slideId: slide.id, nodeId: selectedNodeId, kind }),
                  )
                }
              >
                <Icon name={CONTENT_ICONS[kind]} size={14} /> {CONTENT_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </section>
      )}

      {content && content.kind !== 'container' && (
        <section className="inspector__section">
          <h2 className="inspector__heading">
            {content.kind === 'titled-card' ? 'Tittelfarge' : 'Kortfarge'}
          </h2>
          <ColorSwatchGrid
            value={content.kind === 'titled-card' ? content.headerColor : content.backgroundColor}
            onSelect={(color) =>
              run('card-color', (current) =>
                setCardColor(current, { slideId: slide.id, nodeId: selectedNodeId, color }),
              )
            }
          />
        </section>
      )}

      {content && content.kind !== 'container' && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Subfelt</h2>
          <div className="inspector__row">
            <label htmlFor="subfield-count">Antall</label>
            <input
              id="subfield-count"
              className="input"
              type="number"
              min={1}
              max={6}
              value={content.body.subfields.length}
              data-testid="subfield-count"
              onChange={(event) =>
                run('subfield-count', (current) =>
                  setSubfieldCount(current, {
                    slideId: slide.id,
                    nodeId: selectedNodeId,
                    count: Number(event.target.value),
                  }),
                )
              }
            />
          </div>
          <div className="inspector__actions">
            {(['y', 'x'] as Axis[]).map((axis) => (
              <button
                key={axis}
                type="button"
                className={content.body.axis === axis ? 'btn btn--sm btn--active' : 'btn btn--sm'}
                data-testid={`subfield-axis-${axis}`}
                onClick={() =>
                  run('subfield-axis', (current) =>
                    setBodyAxis(current, { slideId: slide.id, nodeId: selectedNodeId, axis }),
                  )
                }
              >
                <Icon name={axis === 'x' ? 'split-x' : 'split-y'} size={14} />
                {axis === 'x' ? ' Side ved side' : ' Over/under'}
              </button>
            ))}
          </div>
          {content.body.subfields.length > 1 && (
            <div className="inspector__weights">
              {content.body.weights.map((weight, index) => (
                <input
                  key={content.body.subfields[index].id}
                  className="input"
                  value={round(weight)}
                  inputMode="decimal"
                  aria-label={`Forholdstall for subfelt ${index + 1}`}
                  data-testid={`subfield-weight-${index}`}
                  onChange={(event) => {
                    const parsed = Number(event.target.value.replace(',', '.'))
                    if (!Number.isFinite(parsed) || parsed <= 0) return
                    const weights = [...content.body.weights]
                    weights[index] = parsed
                    run('subfield-weights', (current) =>
                      setBodyWeights(current, {
                        slideId: slide.id,
                        nodeId: selectedNodeId,
                        weights,
                      }),
                    )
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {content?.kind === 'container' && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Beholderinnhold</h2>
          <div className="inspector__actions">
            <button
              type="button"
              className={content.payload.type === 'richdoc' ? 'btn btn--sm btn--active' : 'btn btn--sm'}
              data-testid="container-payload-richdoc"
              onClick={() => requestPayload({ type: 'richdoc', doc: emptyDoc() })}
            >
              <Icon name="text" size={14} /> Tekst
            </button>
            <button
              type="button"
              className={content.payload.type === 'shape' ? 'btn btn--sm btn--active' : 'btn btn--sm'}
              data-testid="container-payload-shape"
              onClick={() => requestPayload({ type: 'shape', shape: defaultShape() })}
            >
              <Icon name="shapes" size={14} /> Figur
            </button>
          </div>

          {content.payload.type === 'shape' && (
            <>
              <div className="inspector__actions">
                {(Object.keys(SHAPE_LABELS) as ShapeKind[]).map((kind) => {
                  const shape = content.payload.type === 'shape' ? content.payload.shape : defaultShape()
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={shape.kind === kind ? 'btn btn--sm btn--active' : 'btn btn--sm'}
                      data-testid={`shape-${kind}`}
                      onClick={() =>
                        run('shape-kind', (current) =>
                          setContainerPayload(current, {
                            slideId: slide.id,
                            nodeId: selectedNodeId,
                            payload: { type: 'shape', shape: { ...shape, kind } },
                          }),
                        )
                      }
                    >
                      {SHAPE_LABELS[kind]}
                    </button>
                  )
                })}
              </div>
              <h3 className="inspector__subheading">Fyllfarge</h3>
              <ColorSwatchGrid
                value={content.payload.shape.fill}
                onSelect={(fill) => {
                  const shape = content.payload.type === 'shape' ? content.payload.shape : defaultShape()
                  run('shape-fill', (current) =>
                    setContainerPayload(current, {
                      slideId: slide.id,
                      nodeId: selectedNodeId,
                      payload: { type: 'shape', shape: { ...shape, fill } },
                    }),
                  )
                }}
              />
              <h3 className="inspector__subheading">Strekfarge</h3>
              <ColorSwatchGrid
                value={content.payload.shape.stroke}
                onSelect={(stroke) => {
                  const shape = content.payload.type === 'shape' ? content.payload.shape : defaultShape()
                  run('shape-stroke', (current) =>
                    setContainerPayload(current, {
                      slideId: slide.id,
                      nodeId: selectedNodeId,
                      payload: { type: 'shape', shape: { ...shape, stroke } },
                    }),
                  )
                }}
              />
            </>
          )}

          {content.payload.type === 'asset' && (
            <div className="inspector__actions">
              {(['contain', 'cover'] as const).map((fit) => {
                const payload = content.payload
                if (payload.type !== 'asset') return null
                return (
                  <button
                    key={fit}
                    type="button"
                    className={payload.fit === fit ? 'btn btn--sm btn--active' : 'btn btn--sm'}
                    data-testid={`asset-fit-${fit}`}
                    onClick={() =>
                      run('asset-fit', (current) =>
                        setContainerPayload(current, {
                          slideId: slide.id,
                          nodeId: selectedNodeId,
                          payload: { ...payload, fit },
                        }),
                      )
                    }
                  >
                    {fit === 'contain' ? 'Vis hele' : 'Fyll sonen'}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={pendingPayload !== null}
        title="Bytt innholdstype"
        message="Beholderen inneholder noe allerede. Bytter du type, erstattes det. Du kan angre med Ctrl+Z."
        confirmLabel="Erstatt"
        onConfirm={() => {
          if (pendingPayload) applyPayload(pendingPayload.nodeId, pendingPayload.payload)
          setPendingPayload(null)
        }}
        onCancel={() => setPendingPayload(null)}
      />
    </aside>
  )
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}
