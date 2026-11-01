/**
 * Layout templates.
 *
 * Templates carry structure only — never content. The template editor runs the
 * exact same domain commands as the slide editor by operating on a scratch
 * presentation, so a template can never encode an illegal layout.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  clearLayoutNode,
  deleteLayoutNode,
  splitLeaf,
  updateSplit,
} from '../../domain/commands'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { computeSlideGeometry, hitTestLayout } from '../../domain/geometry'
import { breadcrumbLabels, collectLeaves, findNode, findParent, stripContent } from '../../domain/layout'
import { newTemplateId } from '../../domain/ids'
import { geometryForTheme } from '../../domain/metrics'
import {
  createPresentation,
  createSlide,
  defaultTheme,
  findContentSlide,
} from '../../domain/presentation'
import { repository } from '../../persistence/activeRepository'
import { notify } from '../../state/toast'
import { describeError } from '../../domain/result'
import type { ContentSlide, LayoutNode, LayoutTemplate, Presentation, Rect } from '../../domain/types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { SplitModal, type SplitModalResult } from './SplitModal'
import { Tooltip } from '../components/Tooltip'
import { unavailable } from '../components/unavailable'
import { BoundedPreview } from './BoundedPreview'
import { canClearZone, ROOT_REMOVE_REASON, ZONE_ACTIONS } from './contextMenu/zoneMenu'
import { ZoneBreadcrumb, ZoneChildList } from './ZoneBreadcrumb'

/**
 * The theme a template is edited in: the scratch deck's.
 *
 * A template carries no theme of its own, and the commands below validate it
 * on a scratch deck, which is made in the default theme. Everything this editor measures — the overview, the selected zone's
 * rect, the split dialog's preview — is measured in that same theme, so what
 * the dialog shows is what the command will accept.
 */
const TEMPLATE_THEME = defaultTheme()
const TEMPLATE_GEOMETRY = geometryForTheme(TEMPLATE_THEME)

/**
 * A throwaway presentation so template edits can reuse the real commands.
 *
 * Its own section comes first, because every deck opens with one — a template
 * is a layout, so the section is scaffolding the commands need and nothing the
 * template carries. The slide the template *is* comes after it, and is handed
 * back by id so no call site has to know which index that put it at.
 */
function scratchFor(
  root: LayoutNode,
  hasTitle: boolean,
): { deck: Presentation; slideId: string } {
  const base = createPresentation({ title: 'Mal', theme: TEMPLATE_THEME })
  const slide: ContentSlide = { ...createSlide({ hasTitle }), root }
  return { deck: { ...base, slides: [base.slides[0], slide] }, slideId: slide.id }
}

/** The layout a command left behind on the scratch deck's one template slide. */
function scratchRoot(presentation: Presentation, slideId: string): LayoutNode | null {
  return findContentSlide(presentation, slideId)?.root ?? null
}

/** The slide a template is drawn on, in slide units. */
const SLIDE_SIZE = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT }
/** The selected zone's edge: drawn inside its rect, so it never covers a neighbour. */
const SELECTED_STROKE = 3

/**
 * A template's layout, drawn from the engine's rects in the zone-editing
 * language (`docs/UX_DESIGN_SYSTEM.md`, «Sonemarkering»): the zones as
 * quiet, dashed context, and — in the editor — the selected zone as the one
 * solid, blue edge, the same «valgt» the slide draws. A split is not given a
 * frame of its own: its edges are its children's, and a second, dashed frame
 * over them would make a structural node look like one more zone.
 *
 * The box is the split dialog's bounded one (`BoundedPreview`), so the picture
 * shrinks with the dialog instead of being a fixed 560 px scaled by a
 * transform. A press is read where it lands on the drawing, by the same
 * hit test the stage uses.
 */
function LayoutPreview({
  root,
  hasTitle,
  selectedId,
  onSelect,
}: {
  root: LayoutNode
  hasTitle: boolean
  selectedId: string | null
  onSelect?: (id: string) => void
}) {
  const slide: ContentSlide = { ...createSlide({ hasTitle }), root }
  const geometry = computeSlideGeometry(slide, TEMPLATE_GEOMETRY)
  const leaves = collectLeaves(root)
  const selectedRect = selectedId ? geometry.rects.get(selectedId) : undefined
  const description = [
    `Malens layout: ${leaves.length === 1 ? 'én sone' : `${leaves.length} soner`}`,
    hasTitle ? 'med overskriftssone' : null,
    selectedId ? `Valgt sone: ${breadcrumbLabels(root, selectedId).join(' › ')}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <BoundedPreview size={SLIDE_SIZE} className="template-preview" testId="template-preview">
      {(scale) => {
        const at = (rect: Rect, inset = 0) => ({
          x: rect.x * scale + inset,
          y: rect.y * scale + inset,
          width: Math.max(rect.width * scale - 2 * inset, 0.5),
          height: Math.max(rect.height * scale - 2 * inset, 0.5),
        })
        return (
          <svg
            className={onSelect ? 'template-preview__drawing is-selectable' : 'template-preview__drawing'}
            role="img"
            aria-label={`${description}.`}
            width={SLIDE_WIDTH * scale}
            height={SLIDE_HEIGHT * scale}
            onClick={(event) => {
              if (!onSelect) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const x = (event.clientX - bounds.left) / scale
              const y = (event.clientY - bounds.top) / scale
              const hit = hitTestLayout(root, geometry.rects, x, y)
              if (hit) onSelect(hit)
            }}
          >
            <rect
              className="template-preview__slide"
              x={0.5}
              y={0.5}
              width={SLIDE_WIDTH * scale - 1}
              height={SLIDE_HEIGHT * scale - 1}
              rx={2}
            />
            {geometry.titleRect && (
              <rect className="template-preview__title" {...at(geometry.titleRect)} rx={2} />
            )}
            {leaves.map((leaf) => {
              const rect = geometry.rects.get(leaf.id)
              if (!rect) return null
              return (
                <rect
                  key={leaf.id}
                  className="template-preview__cell"
                  data-template-zone={leaf.id}
                  {...at(rect, 0.5)}
                  rx={2}
                />
              )
            })}
            {selectedRect && selectedId && (
              <rect
                className="template-preview__selected"
                data-template-selected={selectedId}
                {...at(selectedRect, SELECTED_STROKE / 2)}
                strokeWidth={SELECTED_STROKE}
                rx={3}
              />
            )}
          </svg>
        )
      }}
    </BoundedPreview>
  )
}

export function TemplateModal({
  open,
  onOpenChange,
  currentSlide,
  onApplyTemplate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSlide: ContentSlide | null
  onApplyTemplate: (template: LayoutTemplate) => void
}) {
  const [templates, setTemplates] = useState<LayoutTemplate[]>([])
  const [editing, setEditing] = useState<LayoutTemplate | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [splitOpen, setSplitOpen] = useState(false)
  const [deleting, setDeleting] = useState<LayoutTemplate | null>(null)

  const [reloadToken, setReloadToken] = useState(0)
  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    repository
      .listTemplates()
      .then((list) => {
        if (!cancelled) setTemplates(list)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          notify.error(error instanceof Error ? error.message : 'Kunne ikke hente malene.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, reloadToken])

  const saveCurrent = async (): Promise<void> => {
    if (!currentSlide) return
    const name = window.prompt('Navn på malen')
    if (!name?.trim()) return
    const template: LayoutTemplate = {
      id: newTemplateId(),
      name: name.trim(),
      hasTitle: currentSlide.title !== null,
      root: stripContent(currentSlide.root),
      createdAt: new Date().toISOString(),
    }
    try {
      await repository.saveTemplate(template)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke lagre malen.')
      return
    }
    refresh()
    notify.success('Malen ble lagret.')
  }

  const applyEdit = (
    mutate: (scratch: Presentation, slideId: string, nodeId: string) => LayoutNode | null,
  ): void => {
    if (!editing || !selectedNode) return
    const { deck, slideId } = scratchFor(editing.root, editing.hasTitle)
    const next = mutate(deck, slideId, selectedNode)
    if (!next) return
    setEditing({ ...editing, root: next })
  }

  const selectedTemplateNode = editing && selectedNode ? findNode(editing.root, selectedNode) : null
  const isRoot = Boolean(editing && selectedNode === editing.root.id)
  /* «Del sone …» for a leaf and «Rediger deling …» for a split, as everywhere
     else: both open the split dialog, which asks before it acts. */
  const splitAction =
    selectedTemplateNode?.kind === 'split'
      ? ZONE_ACTIONS.editSplit
      : { ...ZONE_ACTIONS.split, label: `${ZONE_ACTIONS.split.label} …` }

  const handleSplitApply = (result: SplitModalResult): string | null => {
    if (!editing || !selectedNode) return null
    const { deck, slideId } = scratchFor(editing.root, editing.hasTitle)
    const isSplit = selectedTemplateNode?.kind === 'split'
    const outcome = isSplit
      ? updateSplit(deck, {
          slideId,
          nodeId: selectedNode,
          axis: result.axis,
          weights: result.weights,
          childCount: result.weights.length,
          removedDisposition: 'delete',
        })
      : splitLeaf(deck, {
          slideId,
          nodeId: selectedNode,
          axis: result.axis,
          weights: result.weights,
        })
    // Said in the dialog, which stays open on its fields, rather than in a toast.
    if (!outcome.ok) return describeError(outcome.error)
    const next = scratchRoot(outcome.value.presentation, slideId)
    if (next) setEditing({ ...editing, root: next })
    setSplitOpen(false)
    return null
  }

  const editingGeometry = editing
    ? computeSlideGeometry(
        { ...createSlide({ hasTitle: editing.hasTitle }), root: editing.root },
        TEMPLATE_GEOMETRY,
      )
    : null
  const selectedRect =
    editingGeometry && selectedNode ? editingGeometry.rects.get(selectedNode) : undefined

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Maler"
        description="Maler inneholder bare soneinndeling, aldri innhold."
        testId="template-modal"
        width={680}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void saveCurrent()}
              disabled={!currentSlide}
              data-testid="save-template"
            >
              <Icon name="plus" /> Lagre gjeldende layout
            </button>
            <button type="button" className="btn" onClick={() => onOpenChange(false)}>
              Lukk
            </button>
          </>
        }
      >
        {templates.length === 0 ? (
          <p className="hint">Ingen maler ennå. Lagre layoutet til gjeldende slide for å komme i gang.</p>
        ) : (
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.id} className="template-list__item" data-testid="template-item">
                <div className="template-list__preview">
                  <LayoutPreview root={template.root} hasTitle={template.hasTitle} selectedId={null} />
                </div>
                <div className="template-list__meta">
                  <strong>{template.name}</strong>
                  <span className="hint">
                    {template.hasTitle ? 'Med overskrift' : 'Uten overskrift'}
                  </span>
                  <div className="template-list__tools">
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      data-testid="use-template"
                      onClick={() => {
                        onApplyTemplate(template)
                        onOpenChange(false)
                      }}
                    >
                      Ny slide fra mal
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => {
                        setEditing(template)
                        setSelectedNode(template.root.id)
                      }}
                    >
                      <Icon name="edit" size={14} /> Rediger
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--icon"
                      aria-label="Slett mal"
                      onClick={() => setDeleting(template)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
        title={`Rediger mal: ${editing?.name ?? ''}`}
        description="Klikk en sone for å velge den."
        testId="template-editor"
        width={640}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="template-save"
              onClick={() => {
                if (!editing) return
                void repository
                  .saveTemplate(editing)
                  .then(() => {
                    setEditing(null)
                    refresh()
                    notify.success('Malen ble oppdatert.')
                  })
                  .catch((error: unknown) => {
                    notify.error(
                      error instanceof Error ? error.message : 'Kunne ikke lagre malen.',
                    )
                  })
              }}
            >
              Lagre mal
            </button>
          </>
        }
      >
        {editing && (
          <>
            <LayoutPreview
              root={editing.root}
              hasTitle={editing.hasTitle}
              selectedId={selectedNode}
              onSelect={setSelectedNode}
            />
            {/* The way up and down the tree without aiming at the picture —
                the same path and the same zone names as the inspector, so a
                zone is reachable from the keyboard however small it is. */}
            {selectedTemplateNode && selectedNode ? (
              <div className="template-editor__nav">
                <ZoneBreadcrumb
                  root={editing.root}
                  nodeId={selectedNode}
                  onSelect={setSelectedNode}
                  testId="template-breadcrumb"
                />
                <ZoneChildList
                  node={selectedTemplateNode}
                  onSelect={setSelectedNode}
                  testIdPrefix="template-child"
                  layout="row"
                />
              </div>
            ) : (
              <p className="hint">Velg en sone i tegningen.</p>
            )}
            <div className="template-editor__tools">
              {/* Named as the zone menu, the inspector and the icon row name
                  them (`ZONE_ACTIONS`); removing asks nothing here, since a
                  template has no content to lose, so it has no ellipsis. */}
              <button
                type="button"
                className="btn btn--sm"
                disabled={!selectedTemplateNode}
                data-testid="template-split"
                onClick={() => setSplitOpen(true)}
              >
                <Icon name={splitAction.icon} size={14} /> {splitAction.label}
              </button>
              <Tooltip label={isRoot ? ROOT_REMOVE_REASON : 'Søsknene fyller plassen etter sonen.'}>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!selectedTemplateNode}
                  data-testid="template-delete"
                  onClick={() =>
                    applyEdit((scratch, slideId, nodeId) => {
                      const parentId = findParent(editing.root, nodeId)?.id ?? null
                      const outcome = deleteLayoutNode(scratch, {
                        slideId,
                        nodeId,
                        contentDisposition: 'delete',
                      })
                      if (!outcome.ok) {
                        notify.error(outcome.error.message)
                        return null
                      }
                      const next = scratchRoot(outcome.value.presentation, slideId)
                      // Where the zone was, as the stage does: its parent, or
                      // the zone that took its place when the parent collapsed.
                      setSelectedNode(next && parentId && findNode(next, parentId) ? parentId : (next?.id ?? null))
                      return next
                    })
                  }
                  {...unavailable(isRoot)}
                >
                  <Icon name={ZONE_ACTIONS.remove.icon} size={14} /> Slett sone
                </button>
              </Tooltip>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!selectedTemplateNode || !canClearZone(selectedTemplateNode)}
                data-testid="template-clear"
                onClick={() =>
                  applyEdit((scratch, slideId, nodeId) => {
                    const outcome = clearLayoutNode(scratch, {
                      slideId,
                      nodeId,
                      contentDisposition: 'delete',
                    })
                    if (!outcome.ok) {
                      notify.error(outcome.error.message)
                      return null
                    }
                    return scratchRoot(outcome.value.presentation, slideId)
                  })
                }
              >
                <Icon name={ZONE_ACTIONS.clear.icon} size={14} /> Tøm sone
              </button>
              <label className="template-editor__title-toggle">
                <input
                  type="checkbox"
                  checked={editing.hasTitle}
                  onChange={(event) => setEditing({ ...editing, hasTitle: event.target.checked })}
                />
                Overskriftssone
              </label>
            </div>
          </>
        )}
      </Modal>

      {splitOpen && editing && selectedRect && (
        <SplitModal
          key={`template-split-${selectedNode}`}
          open={splitOpen}
          onOpenChange={setSplitOpen}
          targetRect={selectedRect}
          theme={TEMPLATE_THEME}
          targetLabels={selectedNode ? breadcrumbLabels(editing.root, selectedNode) : []}
          mode={selectedTemplateNode?.kind === 'split' ? 'edit' : 'create'}
          existingChildren={
            selectedTemplateNode?.kind === 'split' ? selectedTemplateNode.children : undefined
          }
          existingAxis={selectedTemplateNode?.kind === 'split' ? selectedTemplateNode.axis : undefined}
          existingWeights={
            selectedTemplateNode?.kind === 'split' ? selectedTemplateNode.weights : undefined
          }
          onApply={handleSplitApply}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Slette malen?"
        message={`Malen «${deleting?.name ?? ''}» slettes permanent.`}
        onConfirm={() => {
          if (!deleting) return
          void repository
            .deleteTemplate(deleting.id)
            .then(() => {
              setDeleting(null)
              refresh()
            })
            .catch((error: unknown) => {
              notify.error(error instanceof Error ? error.message : 'Kunne ikke slette malen.')
            })
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
