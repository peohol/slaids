/**
 * Properties panel for the selected zone.
 *
 * This is where the zone-level and content-level domain commands are exposed:
 * split, clear, delete, content type, colours, subfields and captions.
 */

import {
  setBodyAxis,
  setBodyWeights,
  setCardColor,
  setContentKind,
  setImageCaption,
  setSubfieldCount,
} from '../../domain/commands'
import {
  bodyOf,
  CAPTION_POSITION_LABELS,
  captionPositionsFor,
  imagePanelOf,
} from '../../domain/content'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import { findLeaf, findNode } from '../../domain/layout'
import { computeSlideGeometry } from '../../domain/geometry'
import { geometryForTheme } from '../../domain/metrics'
import { domFitCheckers } from '../../state/measure'
import { sectionGoverning } from '../../domain/presentation'
import { useEditorStore } from '../../state/store'
import type { Axis, ContentSlide, ZoneContentKind } from '../../domain/types'
import { ColorSwatchGrid } from '../components/ColorPicker'
import { Icon } from '../components/Icon'
import { formatBytes, formatPixels } from '../format'
import { contentKindOptions } from './contentKinds'
import { Tooltip } from '../components/Tooltip'
import { ZoneBreadcrumb } from './ZoneBreadcrumb'
import { ZoneSizeControls, splitContextFor } from './ZoneSizeControls'
import type { ZoneAction } from './ZoneOverlay'

export function Inspector({
  slide,
  actions,
  onAddContent,
  onOptimizeImage,
}: {
  slide: ContentSlide
  actions: ZoneAction[]
  onAddContent: (nodeId: string, kind: ZoneContentKind) => void
  /** Shrink the file behind this zone's picture; see `ImageOptimizeModal`. */
  onOptimizeImage: (nodeId: string) => void
}) {
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const theme = useEditorStore((state) => state.presentation?.theme)
  const assets = useEditorStore((state) => state.presentation?.assets)
  // The colours a swatch offers as "the default" are the governing section's:
  // a heading with no colour of its own is painted with that one.
  const pillColor = useEditorStore((state) =>
    state.presentation ? sectionGoverning(state.presentation, slide.id).accentColor : DEFAULT_PILL_COLOR,
  )
  const run = useEditorStore((state) => state.run)
  const selectNode = useEditorStore((state) => state.selectNode)

  const node = selectedNodeId ? findNode(slide.root, selectedNodeId) : null
  const leaf = selectedNodeId ? findLeaf(slide.root, selectedNodeId) : null
  const content = leaf?.content ?? null
  const body = content ? bodyOf(content) : null
  const panel = content ? imagePanelOf(content) : null
  const file = panel?.assetId ? (assets?.find((asset) => asset.id === panel.assetId) ?? null) : null
  const geometry = computeSlideGeometry(slide, geometryForTheme(theme))
  const rect = selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined
  /* Which split the size controls act on: the selected one, or the one the
     selected zone is a child of. A root leaf belongs to neither and gets none. */
  const splitContext = splitContextFor(slide, selectedNodeId)
  // The zone's own rectangle decides which kinds can be drawn in it — the very
  // rule the commands refuse by, so no button offers what a click would fail.
  const kindOptions = contentKindOptions(rect ?? null, theme)

  if (!node || !selectedNodeId) {
    return (
      <aside className="inspector" data-testid="inspector">
        <p className="hint">Ingen sone er valgt.</p>
      </aside>
    )
  }

  /* A titled card and a titled image card carry the same header, down to the
     inheritance; a card without a title has no deck-wide colour to fall back on,
     and a container or a picture that is the whole card has no panel at all. */
  const coloured =
    content !== null &&
    (content.kind === 'untitled-card' ||
      content.kind === 'titled-card' ||
      content.kind === 'titled-image-card')
      ? content
      : null

  /* A caption with no colour of its own reads its picture's title panel when
     there is one — the same header a titled image card's title already
     inherits from the section — and the section directly otherwise, since a
     plain picture has no panel to read. */
  const captionInheritedColor =
    content?.kind === 'titled-image-card' ? (content.headerColor ?? pillColor) : pillColor
  const captionInheritedLabel =
    content?.kind === 'titled-image-card' ? 'Standard (fra tittelpanelet)' : 'Standard (fra seksjonen)'

  return (
    <aside className="inspector" data-testid="inspector">
      <section className="inspector__section">
        <h2 className="inspector__heading">Sone</h2>
        {/* The path is the way up and down the tree — the only reliable one
            where a nested zone is too small to aim at. */}
        <ZoneBreadcrumb
          root={slide.root}
          nodeId={selectedNodeId}
          onSelect={selectNode}
          testId="inspector-breadcrumb"
        />
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

      {splitContext && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Forholdstall</h2>
          {/* Printed as they are stored, because they are whole numbers: a
              zone ratio that needed rounding to be read would be a ratio the
              author could not type back in. */}
          <p className="hint" data-testid="zone-ratios">
            {splitContext.split.weights.join(' : ')}
          </p>
          <ZoneSizeControls
            slide={slide}
            split={splitContext.split}
            childIndex={splitContext.childIndex}
          />
          <p className="hint">
            Knappene endrer forholdstallene direkte. Med mus kan du også dra i mellomrommet
            mellom subsonene for å flytte grensen, eller dra inni en subsone på tvers av
            retningen for å endre størrelsen symmetrisk og langs retningen for å forskyve den.
            Layouten låses til nærmeste heltallsforhold uansett vei.
          </p>
        </section>
      )}

      {leaf && !content && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Innhold</h2>
          <div className="inspector__actions">
            {kindOptions.map((option) => (
              <Tooltip
                key={option.kind}
                label={option.reason ?? option.label}
                wrap={option.disabled}
              >
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid={`inspector-add-${option.kind}`}
                  disabled={option.disabled}
                  onClick={() => onAddContent(selectedNodeId, option.kind)}
                >
                  <Icon name={option.icon} size={14} /> {option.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </section>
      )}

      {content && (
        <section className="inspector__section">
          <h2 className="inspector__heading">Innholdstype</h2>
          <div className="inspector__actions">
            {kindOptions.map((option) => (
              <Tooltip
                key={option.kind}
                label={option.reason ?? option.label}
                wrap={option.disabled}
              >
                <button
                  type="button"
                  className={
                    content.kind === option.kind ? 'btn btn--sm btn--active' : 'btn btn--sm'
                  }
                  data-testid={`inspector-kind-${option.kind}`}
                  disabled={option.disabled}
                  onClick={() =>
                    run('content-kind', (current) =>
                      setContentKind(current, {
                        slideId: slide.id,
                        nodeId: selectedNodeId,
                        kind: option.kind,
                        ...domFitCheckers,
                      }),
                    )
                  }
                >
                  <Icon name={option.icon} size={14} /> {option.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </section>
      )}

      {coloured && (
        <section className="inspector__section">
          <h2 className="inspector__heading">
            {coloured.kind === 'untitled-card' ? 'Kortfarge' : 'Tittelfarge'}
          </h2>
          <ColorSwatchGrid
            value={
              coloured.kind === 'untitled-card'
                ? coloured.backgroundColor
                : (coloured.headerColor ?? pillColor)
            }
            onSelect={(color) =>
              run('card-color', (current) =>
                setCardColor(current, { slideId: slide.id, nodeId: selectedNodeId, color }),
              )
            }
            inherited={
              coloured.kind === 'untitled-card'
                ? undefined
                : {
                    color: pillColor,
                    label: 'Standard (fra seksjonen)',
                    active: coloured.headerColor === null,
                    onSelect: () =>
                      run('card-color', (current) =>
                        setCardColor(current, {
                          slideId: slide.id,
                          nodeId: selectedNodeId,
                          color: null,
                        }),
                      ),
                  }
            }
          />
        </section>
      )}

      {/*
        A picture's caption. Where it may hang is the content kind's rule — a
        titled image card has a header along the top already — so the buttons
        come from `captionPositionsFor` rather than from a list written here.
      */}
      {content && panel && (
        <section className="inspector__section" data-testid="caption-panel">
          <h2 className="inspector__heading">Bildetekst</h2>
          <p className="hint">
            {panel.caption
              ? 'Klikk i bildeteksten for å skrive. En tom bildetekst forsvinner av seg selv.'
              : 'Legg en tekst over bildet. Den er alltid midtstilt.'}
          </p>
          <div className="inspector__actions">
            {captionPositionsFor(content.kind).map((position) => (
              <button
                key={position}
                type="button"
                className={
                  panel.caption?.position === position ? 'btn btn--sm btn--active' : 'btn btn--sm'
                }
                data-testid={`caption-position-${position}`}
                onClick={() =>
                  run('caption-position', (current) =>
                    setImageCaption(current, {
                      slideId: slide.id,
                      nodeId: selectedNodeId,
                      position,
                      ...domFitCheckers,
                    }),
                  )
                }
              >
                {CAPTION_POSITION_LABELS[position]}
              </button>
            ))}
            {panel.caption && (
              <button
                type="button"
                className="btn btn--sm"
                data-testid="caption-remove"
                onClick={() =>
                  run('caption-remove', (current) =>
                    setImageCaption(current, {
                      slideId: slide.id,
                      nodeId: selectedNodeId,
                      remove: true,
                    }),
                  )
                }
              >
                <Icon name="trash" size={14} /> Fjern
              </button>
            )}
          </div>

          {panel.caption && (
            <>
              <h3 className="inspector__subheading">Bakgrunnsfarge</h3>
              <ColorSwatchGrid
                value={panel.caption.color ?? captionInheritedColor}
                onSelect={(color) =>
                  run('caption-color', (current) =>
                    setImageCaption(current, {
                      slideId: slide.id,
                      nodeId: selectedNodeId,
                      color,
                    }),
                  )
                }
                inherited={{
                  color: captionInheritedColor,
                  label: captionInheritedLabel,
                  active: panel.caption.color === null,
                  onSelect: () =>
                    run('caption-color', (current) =>
                      setImageCaption(current, {
                        slideId: slide.id,
                        nodeId: selectedNodeId,
                        color: null,
                      }),
                    ),
                }}
              />
            </>
          )}
        </section>
      )}

      {/*
        The file behind the picture, and the way to make it smaller. Only once a
        file is there: an empty panel has nothing to optimise.
      */}
      {panel?.assetId && (
        <section className="inspector__section" data-testid="image-file-panel">
          <h2 className="inspector__heading">Bildefil</h2>
          {file && (
            <p className="hint" data-testid="image-file-info">
              {file.name} · {formatPixels(file.width, file.height)} · {formatBytes(file.byteSize)}
            </p>
          )}
          <div className="inspector__actions">
            <button
              type="button"
              className="btn btn--sm"
              data-testid="optimize-image"
              onClick={() => onOptimizeImage(selectedNodeId)}
            >
              <Icon name="optimize" size={14} /> Optimaliser bildet …
            </button>
          </div>
        </section>
      )}

      {body && (
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
              value={body.subfields.length}
              data-testid="subfield-count"
              onChange={(event) =>
                run('subfield-count', (current) =>
                  setSubfieldCount(current, {
                    slideId: slide.id,
                    nodeId: selectedNodeId,
                    count: Number(event.target.value),
                    ...domFitCheckers,
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
                className={body.axis === axis ? 'btn btn--sm btn--active' : 'btn btn--sm'}
                data-testid={`subfield-axis-${axis}`}
                onClick={() =>
                  run('subfield-axis', (current) =>
                    setBodyAxis(current, {
                      slideId: slide.id,
                      nodeId: selectedNodeId,
                      axis,
                      ...domFitCheckers,
                    }),
                  )
                }
              >
                <Icon name={axis === 'x' ? 'split-x' : 'split-y'} size={14} />
                {axis === 'x' ? ' Side ved side' : ' Over/under'}
              </button>
            ))}
          </div>
          {body.subfields.length > 1 && (
            <div className="inspector__weights">
              {body.weights.map((weight, index) => (
                <input
                  key={body.subfields[index].id}
                  className="input"
                  value={round(weight)}
                  inputMode="decimal"
                  aria-label={`Forholdstall for subfelt ${index + 1}`}
                  data-testid={`subfield-weight-${index}`}
                  onChange={(event) => {
                    const parsed = Number(event.target.value.replace(',', '.'))
                    if (!Number.isFinite(parsed) || parsed <= 0) return
                    const weights = [...body.weights]
                    weights[index] = parsed
                    run('subfield-weights', (current) =>
                      setBodyWeights(current, {
                        slideId: slide.id,
                        nodeId: selectedNodeId,
                        weights,
                        ...domFitCheckers,
                      }),
                    )
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </aside>
  )
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}
