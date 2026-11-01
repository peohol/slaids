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
import { breadcrumbLabels, collectNodes, findNode, stripContent } from '../../domain/layout'
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
import type { ContentSlide, LayoutNode, LayoutTemplate, Presentation } from '../../domain/types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { SplitModal, type SplitModalResult } from './SplitModal'
import { absoluteStyle } from '../slide/SlideView'

const PREVIEW_WIDTH = 560

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
  const scale = PREVIEW_WIDTH / SLIDE_WIDTH

  return (
    <div
      className="template-preview"
      style={{ width: PREVIEW_WIDTH, height: SLIDE_HEIGHT * scale }}
      data-testid="template-preview"
      onClick={(event) => {
        if (!onSelect) return
        const bounds = event.currentTarget.getBoundingClientRect()
        const x = (event.clientX - bounds.left) / scale
        const y = (event.clientY - bounds.top) / scale
        const hit = hitTestLayout(root, geometry.rects, x, y)
        if (hit) onSelect(hit)
      }}
    >
      {geometry.titleRect && (
        <div
          className="template-preview__title"
          style={{
            left: geometry.titleRect.x * scale,
            top: geometry.titleRect.y * scale,
            width: geometry.titleRect.width * scale,
            height: geometry.titleRect.height * scale,
          }}
        />
      )}
      {collectNodes(root).map((node) => {
        const rect = geometry.rects.get(node.id)
        if (!rect) return null
        return (
          <div
            key={node.id}
            className={[
              'template-preview__cell',
              node.kind === 'split' ? 'template-preview__cell--split' : '',
              node.id === selectedId ? 'template-preview__cell--selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              ...absoluteStyle({
                x: rect.x * scale,
                y: rect.y * scale,
                width: rect.width * scale,
                height: rect.height * scale,
              }),
            }}
          />
        )
      })}
    </div>
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
            <div className="template-editor__tools">
              <button
                type="button"
                className="btn btn--sm"
                disabled={!selectedTemplateNode}
                data-testid="template-split"
                onClick={() => setSplitOpen(true)}
              >
                <Icon name={selectedTemplateNode?.kind === 'split' ? 'edit' : 'split-x'} size={14} />
                {selectedTemplateNode?.kind === 'split' ? ' Rediger splitting' : ' Splitt sone'}
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!selectedTemplateNode || selectedNode === editing.root.id}
                onClick={() =>
                  applyEdit((scratch, slideId, nodeId) => {
                    const outcome = deleteLayoutNode(scratch, {
                      slideId,
                      nodeId,
                      contentDisposition: 'delete',
                    })
                    if (!outcome.ok) {
                      notify.error(outcome.error.message)
                      return null
                    }
                    setSelectedNode(null)
                    return scratchRoot(outcome.value.presentation, slideId)
                  })
                }
              >
                <Icon name="trash" size={14} /> Slett sone
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!selectedTemplateNode}
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
                <Icon name="eraser" size={14} /> Tøm sone
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
