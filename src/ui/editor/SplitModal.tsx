/**
 * Split / edit-split dialog.
 *
 * The preview is not a drawing: it is the geometry engine run against the real
 * target rect, so what the dialog shows is exactly what committing will produce.
 * Apply stays disabled until the proposed geometry is legal.
 */

import { useMemo, useState } from 'react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN } from '../../domain/constants'
import { themeMetrics } from '../../domain/metrics'
import { useEditorStore } from '../../state/store'
import { computeLayoutRects, previewSplit } from '../../domain/geometry'
import { collectNodes, countContent, createLeaf } from '../../domain/layout'
import type { Axis, LayoutNode, Rect } from '../../domain/types'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'

const PREVIEW_WIDTH = 560

export interface SplitModalResult {
  axis: Axis
  weights: number[]
  contentTargetIndex: number
  removedDisposition: 'sandbox' | 'delete'
}

/**
 * Mount this with a `key` tied to the selected node so opening it for a new
 * target starts from that target's defaults, without a reset effect.
 */
export interface SplitModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The rect the split will occupy, straight from the geometry engine. */
  targetRect: Rect
  mode: 'create' | 'edit'
  /** Existing children when editing a split; empty when splitting a leaf. */
  existingChildren?: LayoutNode[]
  existingAxis?: Axis
  existingWeights?: number[]
  /** True when the leaf being split already holds content. */
  hasContent?: boolean
  onApply: (result: SplitModalResult) => void
}

function parseWeight(value: string): number {
  const normalized = Number(value.replace(',', '.'))
  return Number.isFinite(normalized) ? normalized : Number.NaN
}

export function SplitModal({
  open,
  onOpenChange,
  targetRect,
  mode,
  existingChildren = [],
  existingAxis,
  existingWeights,
  hasContent = false,
  onApply,
}: SplitModalProps) {
  const theme = useEditorStore((state) => state.presentation?.theme)
  const gap = themeMetrics(theme).gap
  const defaultAxis: Axis =
    existingAxis ?? (targetRect.width >= targetRect.height ? 'x' : 'y')
  const [axis, setAxis] = useState<Axis>(defaultAxis)
  const [count, setCount] = useState(existingWeights?.length ?? 2)
  const [weightInputs, setWeightInputs] = useState<string[]>(
    existingWeights?.map(String) ?? ['1', '1'],
  )
  const [contentTargetIndex, setContentTargetIndex] = useState(0)
  const [removedDisposition, setRemovedDisposition] = useState<'sandbox' | 'delete'>('sandbox')

  const changeCount = (next: number): void => {
    const clamped = Math.max(MIN_SPLIT_CHILDREN, Math.min(MAX_SPLIT_CHILDREN, Math.round(next)))
    setCount(clamped)
    setWeightInputs((current) => {
      if (clamped <= current.length) return current.slice(0, clamped)
      return [...current, ...Array.from({ length: clamped - current.length }, () => '1')]
    })
    setContentTargetIndex((current) => Math.min(current, clamped - 1))
  }

  const weights = weightInputs.map(parseWeight)
  const weightsValid = weights.length === count && weights.every((w) => Number.isFinite(w) && w > 0)

  const proposedChildren: LayoutNode[] = useMemo(() => {
    const kept = existingChildren.slice(0, count)
    const added = Math.max(0, count - kept.length)
    return [...kept, ...Array.from({ length: added }, () => createLeaf())]
  }, [count, existingChildren])

  const preview = weightsValid
    ? previewSplit(targetRect, axis, weights, {}, mode === 'edit' ? proposedChildren : undefined)
    : null

  const removedChildren = existingChildren.slice(count)
  const removedContentCount = removedChildren.reduce((total, child) => total + countContent(child), 0)

  const previewNode: LayoutNode | null = weightsValid
    ? { id: '__preview__', kind: 'split', axis, weights, children: proposedChildren }
    : null

  const previewScale = PREVIEW_WIDTH / targetRect.width
  const previewHeight = targetRect.height * previewScale
  const previewRects =
    previewNode && preview?.valid
      ? computeLayoutRects(
          previewNode,
          { x: 0, y: 0, width: targetRect.width, height: targetRect.height },
          gap,
        )
      : null

  const canApply = Boolean(weightsValid && preview?.valid)

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'create' ? 'Splitt sone' : 'Rediger splitting'}
      description={
        mode === 'create'
          ? 'Del sonen i 2–10 subsoner med forholdstall.'
          : 'Endre orientering, antall subsoner og forholdstall.'
      }
      testId="split-modal"
      width={660}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canApply}
            data-testid="split-apply"
            onClick={() =>
              onApply({ axis, weights, contentTargetIndex, removedDisposition })
            }
          >
            Bruk
          </button>
        </>
      }
    >
      <div className="split-controls">
        <div className="field">
          <label>Orientering</label>
          <ToggleGroup.Root
            type="single"
            className="toggle-group"
            value={axis}
            onValueChange={(value) => value && setAxis(value as Axis)}
          >
            <ToggleGroup.Item className="btn" value="x" data-testid="split-axis-x">
              <Icon name="split-x" /> Side ved side
            </ToggleGroup.Item>
            <ToggleGroup.Item className="btn" value="y" data-testid="split-axis-y">
              <Icon name="split-y" /> Over/under
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>

        <div className="field">
          <label htmlFor="split-count">Antall subsoner: {count}</label>
          <input
            id="split-count"
            className="input"
            type="range"
            min={MIN_SPLIT_CHILDREN}
            max={MAX_SPLIT_CHILDREN}
            step={1}
            value={count}
            data-testid="split-count"
            onChange={(event) => changeCount(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="field">
        <label>Forholdstall</label>
        <div className="split-weights">
          {weightInputs.map((value, index) => (
            <input
              key={index}
              className={
                Number.isFinite(parseWeight(value)) && parseWeight(value) > 0
                  ? 'input'
                  : 'input input--invalid'
              }
              value={value}
              inputMode="decimal"
              aria-label={`Forholdstall for subsone ${index + 1}`}
              data-testid={`split-weight-${index}`}
              onChange={(event) =>
                setWeightInputs((current) =>
                  current.map((entry, i) => (i === index ? event.target.value : entry)),
                )
              }
            />
          ))}
        </div>
        <span className="hint">
          [1, 2] gir dobbelt så stor andre sone. [0.5, 1] og [2, 4] gir nøyaktig samme resultat.
        </span>
      </div>

      <div className="split-preview" style={{ width: PREVIEW_WIDTH, height: previewHeight }}>
        {previewRects && previewNode ? (
          collectNodes(previewNode).map((node) => {
            const rect = previewRects.get(node.id)
            if (!rect || node.id === '__preview__') return null
            const isTopLevel = previewNode.kind === 'split' && previewNode.children.some((child) => child.id === node.id)
            const index = previewNode.kind === 'split' ? previewNode.children.findIndex((child) => child.id === node.id) : -1
            return (
              <div
                key={node.id}
                className={
                  node.kind === 'split' ? 'split-preview__cell split-preview__cell--split' : 'split-preview__cell'
                }
                style={{
                  left: rect.x * previewScale,
                  top: rect.y * previewScale,
                  width: rect.width * previewScale,
                  height: rect.height * previewScale,
                }}
              >
                {isTopLevel && index >= 0 && <span>{index + 1}</span>}
              </div>
            )
          })
        ) : (
          <div className="split-preview__invalid" data-testid="split-invalid">
            {weightsValid
              ? 'Én eller flere subsoner blir for små.'
              : 'Alle forholdstall må være tall større enn 0.'}
          </div>
        )}
      </div>

      {mode === 'create' && hasContent && (
        <div className="field">
          <label>Hvilken subsone skal beholde innholdet?</label>
          <div className="split-weights">
            {Array.from({ length: count }, (_, index) => (
              <button
                key={index}
                type="button"
                className={contentTargetIndex === index ? 'btn btn--active' : 'btn'}
                onClick={() => setContentTargetIndex(index)}
                data-testid={`split-content-target-${index}`}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <span className="hint">
            Får innholdet ikke plass der, flyttes det til sandkassen i stedet.
          </span>
        </div>
      )}

      {mode === 'edit' && removedContentCount > 0 && (
        <div className="field">
          <label>{removedContentCount} innholdselement(er) mister sonen sin</label>
          <ToggleGroup.Root
            type="single"
            className="toggle-group"
            value={removedDisposition}
            onValueChange={(value) => value && setRemovedDisposition(value as 'sandbox' | 'delete')}
          >
            <ToggleGroup.Item className="btn" value="sandbox" data-testid="removed-to-sandbox">
              <Icon name="sandbox" /> Flytt til sandkassen
            </ToggleGroup.Item>
            <ToggleGroup.Item className="btn" value="delete" data-testid="removed-delete">
              <Icon name="trash" /> Slett innholdet
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </div>
      )}
    </Modal>
  )
}
