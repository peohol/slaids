/**
 * Properties panel for the selected zone.
 *
 * Read from the top: what is selected and where it sits in the tree, then what
 * is in it, then what can be done to the zone itself, then its size. The
 * controls are the zone-level and content-level domain commands — the same
 * ones the zone menu and the content menu run, under the same names — and the
 * long explanations and rarely needed numbers are folded away rather than
 * printed under every selection.
 */

import {
  setBodyAxis,
  setCardColor,
  setImageCaption,
  setSubfieldCount,
} from '../../domain/commands'
import { HUMAN_EDIT, setBodyWeightsByHand } from '../../domain/commands/manualLayout'
import {
  bodyOf,
  CAPTION_POSITION_LABELS,
  captionPositionsFor,
  imagePanelOf,
  MAX_SUBFIELDS,
} from '../../domain/content'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import { findLeaf, findNode } from '../../domain/layout'
import { computeSlideGeometry } from '../../domain/geometry'
import { panelFrame } from '../../domain/imageOptimization'
import { aspectRatioLabel } from '../../domain/imagePlan'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { sectionGoverning } from '../../domain/presentation'
import { INHERITS_FROM_SECTION, inheritedPill, standardLabel } from './colorInheritance'
import { useEditorStore } from '../../state/store'
import type { Axis, ContentSlide, ZoneContentKind } from '../../domain/types'
import { ColorSwatchGrid } from '../components/ColorPicker'
import { CopyTextButton } from '../components/CopyTextButton'
import { MenuButton } from '../components/MenuButton'
import { formatBytes, formatPixels } from '../format'
import { contentKindEntries, type ContentKindOption } from './contentKinds'
import { removeCaptionEntry } from './contextMenu/contentMenu'
import {
  InspectorButton,
  InspectorEntryButton,
  InspectorFold,
  InspectorHeader,
  InspectorPanel,
  InspectorSection,
} from './InspectorParts'
import { ZoneBreadcrumb, ZoneChildList } from './ZoneBreadcrumb'
import {
  AXIS_LABELS,
  SIZE_SCOPE_TITLES,
  splitSummary,
  zoneIcon,
  zonePosition,
  zoneTitle,
} from './zoneDescription'
import { ZoneSizeControls, sizeContextsFor } from './ZoneSizeControls'
import { ShrunkZoneNotice } from './ShrunkZoneMarker'
import type { ZoneAction } from './ZoneOverlay'

/** An action as the inspector draws it. */
function ActionButton({ action }: { action: ZoneAction }) {
  return (
    <InspectorButton
      icon={action.icon}
      tone={action.tone}
      label={action.label}
      disabled={action.disabled}
      reason={action.reason}
      danger={action.danger}
      testId={`inspector-action-${action.id}`}
      onClick={action.onSelect}
    />
  )
}

export function Inspector({
  slide,
  actions,
  contentKinds,
  onSetContentKind,
  onOptimizeImage,
  readableEditing,
}: {
  slide: ContentSlide
  /**
   * The selected zone's actions, shared with the icon row over the zone. The
   * one that opens a menu is the content-kind picker, which this panel draws
   * as its own control from `contentKinds`.
   */
  actions: ZoneAction[]
  /** The content kinds as they stand for the selected zone; see `contentKindOptions`. */
  contentKinds: ContentKindOption[]
  /** Fill the selected zone with a kind, or convert what it holds. */
  onSetContentKind: (kind: ZoneContentKind) => void
  /** Shrink the file behind this zone's picture; see `ImageOptimizeModal`. */
  onOptimizeImage: (nodeId: string) => void
  /**
   * Drawing one zone large enough to write in, and back; see
   * `ShrunkZoneNotice`. Left out where the stage has no such view.
   */
  readableEditing?: {
    enlarged: boolean
    onEnlarge: (nodeId: string) => void
    onShowSlide: () => void
  }
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
  // Measured the way the image brief measures it — the picture's own frame,
  // a titled card's header removed — so the ratio copied here is the one the
  // prompt for this zone would print.
  const aspectRatio = rect
    ? aspectRatioLabel(content ? panelFrame(content, rect, themeMetrics(theme).cardBodyOffset) : rect)
    : null
  /* Which splits the size controls act on: the selected one's own children
     («inni»), and the one the selected zone is a child of («blant
     søskensonene»). A nested split has both; a root leaf has neither. */
  const sizeContexts = sizeContextsFor(slide, selectedNodeId)

  if (!node || !selectedNodeId) {
    return (
      <InspectorPanel>
        <InspectorHeader
          icon="zones"
          title="Ingen sone er valgt"
          detail="Klikk en sone på sliden for å se hva den inneholder og hva du kan gjøre med den."
        />
      </InspectorPanel>
    )
  }

  const contentActions = actions.filter((action) => action.group === 'content' && !action.menu)
  const zoneActions = actions.filter((action) => action.group === 'zone' && !action.danger)
  const dangerActions = actions.filter((action) => action.group === 'zone' && action.danger)
  const currentKind = content ? (contentKinds.find((option) => option.kind === content.kind) ?? null) : null
  const summary = splitSummary(node)

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
     there is one, and the section directly otherwise — see `colorInheritance`. */
  const captionInherits = inheritedPill(content, pillColor)

  return (
    <InspectorPanel>
      <InspectorHeader
        {...zoneIcon(node)}
        title={zoneTitle(node)}
        detail={[zonePosition(slide.root, selectedNodeId), summary].filter(Boolean).join('. ')}
      >
        {/* The path is the way up and down the tree — the only reliable one
            where a nested zone is too small to aim at. */}
        <ZoneBreadcrumb
          root={slide.root}
          nodeId={selectedNodeId}
          onSelect={selectNode}
          testId="inspector-breadcrumb"
        />
        {rect && (
          <div className="inspector__row">
            <span className="hint" data-testid="inspector-size">
              {Math.round(rect.width)} × {Math.round(rect.height)} px
            </span>
            {aspectRatio && (
              <CopyTextButton
                text={aspectRatio}
                tooltip="Kopier sideforholdet"
                testId="inspector-aspect-ratio"
              />
            )}
          </div>
        )}
      </InspectorHeader>

      {leaf && (
        <InspectorSection title="Innhold" testId="inspector-content">
          {content ? (
            <MenuButton
              id="inspector-content-kind"
              testId="inspector-content-kind"
              className="inspector__kind"
              label={`Innholdstype: ${currentKind?.label ?? ''}`}
              title="Innholdstype for valgt sone"
              tooltip="Endre innholdstype"
              icon={currentKind?.icon ?? 'card'}
              tone={currentKind?.tone}
              entries={() => contentKindEntries(contentKinds, content.kind, onSetContentKind)}
            >
              <span className="inspector__kind-text">
                <span className="inspector__kind-caption">Innholdstype</span>{' '}
                <span>{currentKind?.label}</span>
              </span>
            </MenuButton>
          ) : (
            <>
              <p className="hint">Sonen er tom. Velg hva den skal inneholde.</p>
              <div className="inspector__actions inspector__actions--stack">
                {contentKinds.map((option) => (
                  <InspectorButton
                    key={option.kind}
                    icon={option.icon}
                    tone={option.tone}
                    label={option.label}
                    disabled={option.disabled}
                    reason={option.reason}
                    testId={`inspector-add-${option.kind}`}
                    onClick={() => onSetContentKind(option.kind)}
                  />
                ))}
              </div>
            </>
          )}

          {coloured && (
            <div className="inspector__group">
              <h3 className="inspector__subheading">
                {coloured.kind === 'untitled-card' ? 'Kortfarge' : 'Tittelfarge'}
              </h3>
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
                        label: standardLabel(INHERITS_FROM_SECTION),
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
            </div>
          )}

          {body && (
            <div className="inspector__group">
              <h3 className="inspector__subheading">Delfelt</h3>
              <div className="inspector__row">
                <label htmlFor="subfield-count">Antall</label>
                <input
                  id="subfield-count"
                  className="input"
                  type="number"
                  min={1}
                  max={MAX_SUBFIELDS}
                  value={body.subfields.length}
                  data-testid="subfield-count"
                  onChange={(event) =>
                    run('subfield-count', (current) =>
                      setSubfieldCount(current, {
                        slideId: slide.id,
                        nodeId: selectedNodeId,
                        count: Number(event.target.value),
                        ...HUMAN_EDIT,
                      }),
                    )
                  }
                />
              </div>
              {/* One field runs in no direction, so the choice appears with the second. */}
              {body.subfields.length > 1 && (
                <div className="inspector__actions">
                  {(['y', 'x'] as Axis[]).map((axis) => (
                    <InspectorButton
                      key={axis}
                      icon={axis === 'x' ? 'split-x' : 'split-y'}
                      label={AXIS_LABELS[axis]}
                      pressed={body.axis === axis}
                      testId={`subfield-axis-${axis}`}
                      onClick={() =>
                        run('subfield-axis', (current) =>
                          setBodyAxis(current, {
                            slideId: slide.id,
                            nodeId: selectedNodeId,
                            axis,
                            ...HUMAN_EDIT,
                          }),
                        )
                      }
                    />
                  ))}
                </div>
              )}
              {body.subfields.length > 1 && (
                <InspectorFold id="subfield-weights" summary="Forholdstall for delfeltene">
                  <div className="inspector__weights">
                    {body.weights.map((weight, index) => (
                      <input
                        key={body.subfields[index].id}
                        className="input"
                        value={round(weight)}
                        inputMode="decimal"
                        aria-label={`Forholdstall for delfelt ${index + 1}`}
                        data-testid={`subfield-weight-${index}`}
                        onChange={(event) => {
                          const parsed = Number(event.target.value.replace(',', '.'))
                          if (!Number.isFinite(parsed) || parsed <= 0) return
                          const weights = [...body.weights]
                          weights[index] = parsed
                          // Et tall en person skriver inn er et valg for hånd, som
                          // et drag av delestreken: tekst som ikke lenger får
                          // plass i normal størrelse tegnes mindre.
                          run('subfield-weights', (current) =>
                            setBodyWeightsByHand(current, {
                              slideId: slide.id,
                              nodeId: selectedNodeId,
                              weights,
                            }),
                          )
                        }}
                      />
                    ))}
                  </div>
                </InspectorFold>
              )}
            </div>
          )}

          {/*
            A picture's caption. Where it may hang is the content kind's rule — a
            titled image card has a header along the top already — so the buttons
            come from `captionPositionsFor` rather than from a list written here.
          */}
          {panel && content && (
            <div className="inspector__group" data-testid="caption-panel">
              <h3 className="inspector__subheading">Bildetekst</h3>
              <p className="hint">
                {panel.caption
                  ? 'Klikk i bildeteksten på sliden for å skrive i den.'
                  : 'Velg en plassering for å legge en tekst over bildet.'}
              </p>
              <div className="inspector__actions">
                {captionPositionsFor(content.kind).map((position) => (
                  <InspectorButton
                    key={position}
                    label={CAPTION_POSITION_LABELS[position]}
                    pressed={panel.caption?.position === position}
                    testId={`caption-position-${position}`}
                    onClick={() =>
                      run('caption-position', (current) =>
                        setImageCaption(current, {
                          slideId: slide.id,
                          nodeId: selectedNodeId,
                          position,
                          ...HUMAN_EDIT,
                        }),
                      )
                    }
                  />
                ))}
              </div>

              {panel.caption && (
                <>
                  <h3 className="inspector__subheading">Bakgrunnsfarge for bildeteksten</h3>
                  <ColorSwatchGrid
                    value={panel.caption.color ?? captionInherits.color}
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
                      color: captionInherits.color,
                      label: standardLabel(captionInherits.from),
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
                  <div className="inspector__actions">
                    <InspectorEntryButton
                      entry={removeCaptionEntry({ slide, nodeId: selectedNodeId, commit: run }, panel)}
                      testId="caption-remove"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/*
            The file behind the picture, and the way to make it smaller. Only once a
            file is there: an empty panel has nothing to optimise.
          */}
          {panel?.assetId && (
            <div className="inspector__group" data-testid="image-file-panel">
              <h3 className="inspector__subheading">Bildefil</h3>
              {file && (
                <p className="hint inspector__file" data-testid="image-file-info">
                  {file.name} · {formatPixels(file.width, file.height)} · {formatBytes(file.byteSize)}
                </p>
              )}
              <div className="inspector__actions">
                <InspectorButton
                  icon="optimize"
                  label="Optimaliser bildet …"
                  testId="optimize-image"
                  onClick={() => onOptimizeImage(selectedNodeId)}
                />
              </div>
            </div>
          )}

          {contentActions.length > 0 && (
            <div className="inspector__actions inspector__actions--stack">
              {contentActions.map((action) => (
                <ActionButton key={action.id} action={action} />
              ))}
            </div>
          )}
        </InspectorSection>
      )}

      <InspectorSection title="Sone" testId="inspector-zone">
        {leaf && readableEditing && (
          <ShrunkZoneNotice
            nodeId={leaf.id}
            enlarged={readableEditing.enlarged}
            onEnlarge={readableEditing.onEnlarge}
            onShowSlide={readableEditing.onShowSlide}
          />
        )}
        {/* The way down the tree without aiming at the slide: a split's own
            zones, by name, one press each. The path above is the way up. */}
        {node.kind === 'split' && (
          <div className="inspector__group">
            <h3 className="inspector__subheading">Sonene i delingen</h3>
            <ZoneChildList node={node} onSelect={selectNode} testIdPrefix="inspector-child" />
          </div>
        )}
        <div className="inspector__actions">
          {zoneActions.map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </div>
        {/* What removes something comes last, on its own row. */}
        <div className="inspector__actions">
          {dangerActions.map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </div>
      </InspectorSection>

      {sizeContexts.map((context, index) => (
        <InspectorSection
          key={context.scope}
          title={SIZE_SCOPE_TITLES[context.scope]}
          testId={context.scope === 'inside' ? 'inspector-distribution' : 'inspector-size-section'}
        >
          <ZoneSizeControls
            slide={slide}
            context={context}
            withHelp={index === sizeContexts.length - 1}
          />
        </InspectorSection>
      ))}
    </InspectorPanel>
  )
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}
