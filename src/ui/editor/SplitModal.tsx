/**
 * Split / edit-split dialog.
 *
 * The preview is not a drawing: it is the geometry engine run against the real
 * target rect, so what the dialog shows is exactly what committing will produce.
 * Apply stays disabled until the proposed geometry is legal.
 *
 * That is why the fields are free and the preview is not. An author may type
 * `0.25`, `1.6` or `3.14159` — they are relative weights, and holding them to
 * whole numbers while typing would make the dialog argue with a wish it is
 * perfectly able to honour. What gets committed is the nearest ratio the layout
 * can actually be written in, so the preview, the minimum-size check and the
 * Apply button all work on *that* rather than on the typed numbers, and the
 * result is named beside the fields so nobody has to guess what `0.25` became.
 *
 * The dialog is a draft (zone-editing plan, Z2): nothing reaches the deck until
 * «Bruk», which is one undoable change, and Avbryt, Escape or closing throws the
 * draft away. Before «Bruk» it says what the change will do to what is already
 * there — which zones a lower count removes and how much content is in them,
 * where the content of a split leaf goes, and, through a dry run of the very
 * command «Bruk» runs (`check`), whether content would be moved to the sandbox
 * or the change refused. Deleting content instead of rescuing it is asked
 * about separately, with the count. A refusal at «Bruk» keeps the dialog open
 * and says why in it.
 */

import { useEffect, useRef, useState } from 'react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN } from '../../domain/constants'
import { geometryForTheme } from '../../domain/metrics'
import { areWeightsValid, previewSplit } from '../../domain/geometry'
import { countContent, createLeaf } from '../../domain/layout'
import { quantizeRatios } from '../../domain/ratios'
import type { Axis, LayoutNode, PresentationTheme, Rect, ZoneContent } from '../../domain/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { InspectorFold } from './InspectorParts'
import { SplitPreview } from './SplitPreview'
import {
  COUNT_ERROR,
  contentCount,
  listed,
  parseCount,
  parseWeight,
  removalSummary,
  removedDetail,
  removedZones,
  shares,
  weightFieldError,
  type SplitCheck,
} from './splitDraft'
import { splitPreviewModel, type PreviewZone } from './splitPreviewModel'

/** How long the fields rest before the dry run measures the proposal's content. */
const CHECK_DELAY_MS = 150

/** «Sone 1 blir for liten (skravert).» / «Sonene 1, 2 og 3 blir for små (skravert).» */
function tooSmallMessage(labels: readonly string[]): string {
  if (labels.length === 1) return `Sone ${labels[0]} blir for liten (skravert).`
  return `Sonene ${listed(labels)} blir for små (skravert).`
}

const AXIS_LABELS: Record<Axis, string> = { x: 'side ved side', y: 'over hverandre' }

/** «Sone 2 inneholder 3 underordnede soner; disse beholdes.» — for each zone that has any. */
function keptStructure(zones: readonly PreviewZone[]): string[] {
  return zones
    .filter((zone) => zone.keptZones > 0)
    .map(
      (zone) =>
        `Sone ${zone.label} inneholder ${zone.keptZones} underordnede soner; disse beholdes.`,
    )
}

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
  /**
   * The theme `targetRect` was measured in, and the commands will validate
   * against. Passed by the caller rather than read from the open deck: the
   * template editor measures its own scratch deck, and a preview in another
   * deck's gap and type would disagree with what «Bruk» then does.
   */
  theme: Partial<PresentationTheme> | undefined
  /** Where the target sits in the zone tree, as the breadcrumb names it: `['Rot', '2']`. */
  targetLabels: readonly string[]
  mode: 'create' | 'edit'
  /** Existing children when editing a split; empty when splitting a leaf. */
  existingChildren?: LayoutNode[]
  existingAxis?: Axis
  existingWeights?: number[]
  /**
   * The content the leaf being split already holds, when it holds any.
   *
   * The object and not a flag: it travels into one of the new children, and
   * what may be drawn in that child is decided by what the content *is*. A
   * preview that only knew «there is something» would disable «Bruk» for a
   * ratio the command accepts, or offer one it refuses.
   */
  leafContent?: ZoneContent | null
  /**
   * A dry run of what `onApply` would do with this proposal, on the document as
   * it stands — the same command with the same fit checks, not a second
   * reading of its rules. Asked only when content is involved and the geometry
   * is legal. Without it the dialog states only what it can see itself.
   */
  check?: (result: SplitModalResult) => SplitCheck
  /** Commit the proposal. Returns why it was refused, or `null` when it was not. */
  onApply: (result: SplitModalResult) => string | null
}

export function SplitModal({
  open,
  onOpenChange,
  targetRect,
  theme,
  targetLabels,
  mode,
  existingChildren = [],
  existingAxis,
  existingWeights,
  leafContent = null,
  check,
  onApply,
}: SplitModalProps) {
  const hasContent = leafContent !== null
  const geometry = geometryForTheme(theme)
  const defaultAxis: Axis =
    existingAxis ?? (targetRect.width >= targetRect.height ? 'x' : 'y')
  const [axis, setAxis] = useState<Axis>(defaultAxis)
  const [count, setCount] = useState(existingWeights?.length ?? 2)
  /** What the count field shows: the count, or a number being typed that is not one yet. */
  const [countDraft, setCountDraft] = useState(String(count))
  const [weightInputs, setWeightInputs] = useState<string[]>(
    existingWeights?.map(String) ?? ['1', '1'],
  )
  const [contentTargetIndex, setContentTargetIndex] = useState(0)
  const [removedDisposition, setRemovedDisposition] = useState<'sandbox' | 'delete'>('sandbox')
  const [focusedZone, setFocusedZone] = useState<number | null>(null)
  const [hoveredZone, setHoveredZone] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [checked, setChecked] = useState<{ key: string; result: SplitCheck } | null>(null)
  const [refusal, setRefusal] = useState<{ key: string; message: string } | null>(null)
  const weightFields = useRef<(HTMLInputElement | null)[]>([])

  const changeCount = (next: number): void => {
    const clamped = Math.max(MIN_SPLIT_CHILDREN, Math.min(MAX_SPLIT_CHILDREN, Math.round(next)))
    setCount(clamped)
    setCountDraft(String(clamped))
    setWeightInputs((current) => {
      if (clamped <= current.length) return current.slice(0, clamped)
      return [...current, ...Array.from({ length: clamped - current.length }, () => '1')]
    })
    setContentTargetIndex((current) => Math.min(current, clamped - 1))
  }
  const countInvalid = parseCount(countDraft) === null

  const typed = weightInputs.map(parseWeight)
  // The geometry engine's own predicate rather than a second reading of it: it
  // also rules out the pair of enormous numbers whose *sum* is not finite,
  // which quantisation cannot answer either.
  const weightsValid = typed.length === count && areWeightsValid(typed)
  // The layout this dialog is really proposing: the typed wish, quantised.
  // Cheap enough to redo on every keystroke — the search is a few thousand
  // additions over at most ten zones — so it is not worth a memo whose key
  // would be the field contents anyway.
  const weights = weightsValid ? quantizeRatios(typed) : null
  const zoneShares = weights ? shares(weights) : null

  const kept = existingChildren.slice(0, count)
  const proposedChildren: LayoutNode[] = [
    ...kept,
    ...Array.from({ length: Math.max(0, count - kept.length) }, () => createLeaf()),
  ]

  /**
   * The children the split will actually have, as far as the minimum-size rule
   * is concerned.
   *
   * Editing a split keeps its subtrees; splitting a leaf makes empty ones —
   * except for the one that receives what is in the leaf today. An empty child
   * draws nothing a narrow rectangle could hide, so it constrains nothing,
   * which is what makes a sliver of deliberate air reachable in one gesture.
   */
  const measuredChildren: (LayoutNode | null)[] =
    mode === 'edit'
      ? proposedChildren
      : Array.from({ length: count }, (_, index) =>
          leafContent && index === contentTargetIndex ? createLeaf(leafContent) : null,
        )

  // The deck's own geometry, not the base tokens: the gap decides where the
  // boundaries land and the theme's type decides how small a card may be, so a
  // preview measured against the defaults would disable «Bruk» on a split the
  // command accepts, or the other way round.
  const preview = weights
    ? previewSplit(targetRect, axis, weights, geometry, measuredChildren)
    : null

  const removed = mode === 'edit' ? removedZones(existingChildren, count) : []
  const removedContent = removed.reduce((total, zone) => total + zone.content, 0)

  /*
   * The dry run. Only once the fields have rested — it measures real content —
   * and only when content is involved: an empty split has nothing a command
   * could refuse or move that the preview has not already shown. Its answer is
   * kept with the proposal it was asked about and ignored once that changes.
   */
  const proposal: SplitModalResult | null = weights
    ? { axis, weights, contentTargetIndex, removedDisposition }
    : null
  const proposalKey = proposal ? JSON.stringify([count, proposal]) : ''
  const involvesContent =
    mode === 'create' ? hasContent : existingChildren.some((child) => countContent(child) > 0)
  const wantsCheck = Boolean(check && proposal && preview?.valid && involvesContent)
  useEffect(() => {
    if (!wantsCheck || !check || !proposalKey) return
    const asked = (JSON.parse(proposalKey) as [number, SplitModalResult])[1]
    const timer = window.setTimeout(
      () => setChecked({ key: proposalKey, result: check(asked) }),
      CHECK_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [check, proposalKey, wantsCheck])
  const verdict = wantsCheck && checked?.key === proposalKey ? checked.result : null
  const refused = verdict && !verdict.ok ? verdict : null
  const shownRefusal = refusal?.key === proposalKey ? refusal.message : null

  // The whole proposed tree, kept subtrees and all, in the target's own
  // coordinates: the preview draws exactly what committing would produce.
  const targetSize = { width: targetRect.width, height: targetRect.height }
  const flagged = [...(preview?.tooSmall ?? []), ...(refused?.zones ?? [])]
  const previewModel =
    weights && preview
      ? splitPreviewModel(
          { id: '__preview__', kind: 'split', axis, weights, children: proposedChildren },
          targetSize,
          geometry.gap,
          flagged,
        )
      : null
  const keptLines = previewModel ? keptStructure(previewModel.zones) : []
  const tooSmallLabels = (preview?.tooSmall ?? []).map((index) => String(index + 1))
  const contentIndex = mode === 'create' && hasContent ? contentTargetIndex : null
  const previewDescription = previewModel
    ? [
        `Forhåndsvisning: ${count} subsoner ${AXIS_LABELS[axis]} i forholdet ${weights?.join(' : ')}.`,
        ...keptLines,
        ...(contentIndex !== null ? [`Innholdet havner i sone ${contentIndex + 1}.`] : []),
      ].join(' ')
    : 'Ingen forhåndsvisning: forholdstallene kan ikke leses.'

  const canApply = Boolean(weights && preview?.valid && !countInvalid && !refused)
  const activeZone = focusedZone ?? hoveredZone
  const typedEqualsStored =
    weights !== null && weights.every((weight, index) => weight === typed[index])
  const alreadyEqual = weights !== null && weights.every((weight) => weight === weights[0])

  const apply = (disposition: 'sandbox' | 'delete'): void => {
    if (!proposal) return
    const message = onApply({ ...proposal, removedDisposition: disposition })
    if (message !== null) {
      setRefusal({ key: JSON.stringify([count, { ...proposal, removedDisposition: disposition }]), message })
    }
  }
  const requestApply = (): void => {
    if (removedContent > 0 && removedDisposition === 'delete') setConfirmingDelete(true)
    else apply(removedDisposition)
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'Del sone' : 'Rediger deling'}
        description={
          mode === 'create'
            ? 'Del sonen i 2–10 subsoner med forholdstall.'
            : 'Endre retning, antall subsoner og forholdstall.'
        }
        testId="split-modal"
        width={940}
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
              onClick={requestApply}
            >
              Bruk
            </button>
          </>
        }
      >
        <p className="split-target" data-testid="split-target">
          Du redigerer: <strong>{targetLabels.join(' › ')}</strong>
        </p>

        <div className="split-layout">
          <figure className="split-figure">
            <SplitPreview
              size={targetSize}
              model={previewModel}
              description={previewDescription}
              activeIndex={activeZone}
              contentIndex={contentIndex}
              onZoneHover={setHoveredZone}
              onZoneSelect={(index) => weightFields.current[index]?.focus()}
            />
            <figcaption className="split-figure__caption">
              {previewModel ? (
                <>
                  <span data-testid="split-legend">
                    Heltrukket: sonene du endrer.
                    {previewModel.dividers.length > 0 && ' Stiplet: underinndelinger som beholdes.'}
                  </span>
                  <span>Du endrer fordelingen mellom {count} direkte subsoner.</span>
                  {keptLines.map((line) => (
                    <span key={line} data-testid="split-kept">
                      {line}
                    </span>
                  ))}
                  {contentIndex !== null && (
                    <span data-testid="split-content-line">
                      Innholdet havner i sone {contentIndex + 1}.
                    </span>
                  )}
                </>
              ) : null}
              {(!previewModel || tooSmallLabels.length > 0) && (
                <span className="split-figure__invalid" data-testid="split-invalid" role="status">
                  {previewModel
                    ? tooSmallMessage(tooSmallLabels)
                    : 'Alle forholdstall må være tall større enn 0.'}
                </span>
              )}
              {refused && (
                <span className="split-figure__invalid" data-testid="split-check" role="status">
                  {refused.message}
                  {refused.zones.length > 0 &&
                    ` Gjelder sone ${listed(refused.zones.map((index) => String(index + 1)))} (skravert).`}
                </span>
              )}
              {verdict?.ok && mode === 'create' && verdict.movedToSandbox > 0 && (
                <span className="split-figure__warning" data-testid="split-check" role="status">
                  Innholdet får ikke plass i sone {contentTargetIndex + 1}, så det flyttes til
                  sandkassen når du trykker «Bruk».
                </span>
              )}
              {shownRefusal && (
                <span className="split-figure__invalid" data-testid="split-refusal" role="alert">
                  Ikke endret: {shownRefusal}
                </span>
              )}
            </figcaption>
          </figure>

          <div className="split-form">
            <div className="field">
              <span className="field__label" id="split-axis-label">
                Retning
              </span>
              <ToggleGroup.Root
                type="single"
                className="toggle-group"
                aria-labelledby="split-axis-label"
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
              <label htmlFor="split-count">Antall subsoner</label>
              <div className="split-stepper">
                <button
                  type="button"
                  className="btn btn--icon"
                  aria-label="Færre subsoner"
                  data-testid="split-count-decrease"
                  disabled={count <= MIN_SPLIT_CHILDREN}
                  onClick={() => changeCount(count - 1)}
                >
                  <Icon name="minus" size={14} />
                </button>
                <input
                  id="split-count"
                  className={countInvalid ? 'input split-stepper__value input--invalid' : 'input split-stepper__value'}
                  type="number"
                  inputMode="numeric"
                  min={MIN_SPLIT_CHILDREN}
                  max={MAX_SPLIT_CHILDREN}
                  step={1}
                  value={countDraft}
                  aria-invalid={countInvalid || undefined}
                  aria-describedby={countInvalid ? 'split-count-error' : 'split-count-hint'}
                  data-testid="split-count"
                  onChange={(event) => {
                    setCountDraft(event.target.value)
                    const parsed = parseCount(event.target.value)
                    if (parsed !== null) changeCount(parsed)
                  }}
                  onBlur={() => setCountDraft(String(count))}
                />
                <button
                  type="button"
                  className="btn btn--icon"
                  aria-label="Flere subsoner"
                  data-testid="split-count-increase"
                  disabled={count >= MAX_SPLIT_CHILDREN}
                  onClick={() => changeCount(count + 1)}
                >
                  <Icon name="plus" size={14} />
                </button>
                {countInvalid ? (
                  <span className="error-text" id="split-count-error" data-testid="split-count-error">
                    {COUNT_ERROR}
                  </span>
                ) : (
                  <span className="hint" id="split-count-hint">
                    Fra {MIN_SPLIT_CHILDREN} til {MAX_SPLIT_CHILDREN}.
                  </span>
                )}
              </div>
            </div>

            {removed.length > 0 && (
              <div className="split-removal" data-testid="split-removed">
                <p className="split-removal__summary" role="status">
                  {removalSummary(removed)}
                  {removedContent > 0
                    ? ` ${contentCount(removedContent)} mister sonen sin.`
                    : ' Ingen innhold påvirkes.'}
                </p>
                <ul className="split-removal__list">
                  {removed.map((zone) => (
                    <li key={zone.label}>{removedDetail(zone)}</li>
                  ))}
                </ul>
                {removedContent > 0 && (
                  <>
                    <ToggleGroup.Root
                      type="single"
                      className="toggle-group"
                      aria-label="Hva skal skje med innholdet?"
                      value={removedDisposition}
                      onValueChange={(value) =>
                        value && setRemovedDisposition(value as 'sandbox' | 'delete')
                      }
                    >
                      <ToggleGroup.Item className="btn" value="sandbox" data-testid="removed-to-sandbox">
                        <Icon name="sandbox" /> Flytt til sandkassen
                      </ToggleGroup.Item>
                      <ToggleGroup.Item className="btn" value="delete" data-testid="removed-delete">
                        <Icon name="trash" /> Slett innholdet
                      </ToggleGroup.Item>
                    </ToggleGroup.Root>
                    <span className="hint">
                      {removedDisposition === 'sandbox'
                        ? 'Innholdet legges i sandkassen, så du kan bruke det igjen.'
                        : 'Innholdet slettes. Du blir spurt én gang til før noe slettes.'}
                    </span>
                  </>
                )}
              </div>
            )}

            <div className="field">
              <div className="split-weights__header">
                <span className="field__label" id="split-weights-label">
                  Forholdstall
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  data-testid="split-equalize"
                  disabled={alreadyEqual}
                  onClick={() => setWeightInputs((current) => current.map(() => '1'))}
                >
                  Fordel likt
                </button>
              </div>
              <div className="split-weights" role="group" aria-labelledby="split-weights-label">
                {weightInputs.map((value, index) => {
                  const error = weightFieldError(value)
                  const active = activeZone === index
                  return (
                    <div
                      key={index}
                      className={active ? 'split-weight is-active' : 'split-weight'}
                      data-active={active || undefined}
                      data-testid={`split-weight-row-${index}`}
                      onPointerEnter={() => setHoveredZone(index)}
                      onPointerLeave={() => setHoveredZone(null)}
                    >
                      <label className="split-weight__label" htmlFor={`split-weight-${index}`}>
                        Sone {index + 1}
                      </label>
                      <input
                        ref={(element) => {
                          weightFields.current[index] = element
                        }}
                        id={`split-weight-${index}`}
                        className={error ? 'input split-weight__value input--invalid' : 'input split-weight__value'}
                        value={value}
                        inputMode="decimal"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `split-weight-error-${index}` : undefined}
                        data-testid={`split-weight-${index}`}
                        onFocus={() => setFocusedZone(index)}
                        onBlur={() => setFocusedZone(null)}
                        onChange={(event) =>
                          setWeightInputs((current) =>
                            current.map((entry, i) => (i === index ? event.target.value : entry)),
                          )
                        }
                      />
                      <span className="split-weight__share" data-testid={`split-share-${index}`}>
                        {zoneShares ? `${zoneShares[index]} %` : '–'}
                      </span>
                      {error && (
                        <span
                          className="error-text split-weight__error"
                          id={`split-weight-error-${index}`}
                          data-testid={`split-weight-error-${index}`}
                        >
                          {error}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              {weights && (
                <span className="hint" data-testid="split-quantized">
                  Lagres som <strong>{weights.join(' : ')}</strong>
                  {typedEqualsStored ? '.' : ', nærmeste hele forhold.'} Prosentene er regnet uten
                  mellomrommene.
                </span>
              )}
              <InspectorFold id="split-ratio-help" summary="Hvordan fungerer forholdstall?" icon="info">
                <p className="hint">
                  Tallene er relative, så 1 : 2, 0,5 : 1 og 2 : 4 beskriver samme deling. Du kan skrive
                  desimaltall og tall over 10; delingen lagres som nærmeste forhold med hele tall fra 1
                  til 10. Prosenten ved hver sone er dens andel av plassen som er igjen når
                  mellomrommene mellom sonene er trukket fra.
                </p>
              </InspectorFold>
            </div>

            {mode === 'create' && hasContent && (
              <div className="field">
                <span className="field__label" id="split-content-label">
                  Hvilken subsone skal få innholdet?
                </span>
                <div className="split-targets" role="group" aria-labelledby="split-content-label">
                  {Array.from({ length: count }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      className={contentTargetIndex === index ? 'btn btn--active' : 'btn'}
                      aria-pressed={contentTargetIndex === index}
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
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Slette ${contentCount(removedContent)}?`}
        message={`${removalSummary(removed)} ${contentCount(removedContent)} i ${
          removed.length === 1 ? 'den' : 'dem'
        } slettes. Du kan angre etterpå, men innholdet havner ikke i sandkassen.`}
        confirmLabel={`Slett ${contentCount(removedContent)}`}
        alternativeLabel="Flytt til sandkassen i stedet"
        onConfirm={() => {
          setConfirmingDelete(false)
          apply('delete')
        }}
        onAlternative={() => {
          setConfirmingDelete(false)
          setRemovedDisposition('sandbox')
          apply('sandbox')
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  )
}
