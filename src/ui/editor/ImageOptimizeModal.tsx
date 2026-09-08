/**
 * Optimising pictures: what would happen, then making it happen.
 *
 * The dialog runs the analysis the moment it opens and shows the result before
 * anything is touched — exact sizes, not estimates, because the analysis
 * produces the very bytes that would be stored (see
 * `state/imageOptimization.ts`). The user reads what will be done and how much
 * it saves, and only their press on «Optimaliser» writes anything. Closing the
 * dialog at any point before that leaves the presentation exactly as it was.
 *
 * Two things the dialog has to say plainly, and does: a permanent crop throws
 * pixels away for good, and the whole operation is outside the undo history.
 *
 * One component for both scopes — the whole deck, or one picture — because the
 * flow is the same and only the words differ. `scope` decides which.
 */

import { useEffect, useState } from 'react'
import type { OptimizationScope } from '../../domain/imageOptimization'
import { repository } from '../../persistence/activeRepository'
import {
  analyzeImages,
  applyImageOptimization,
  createRasterProcessor,
  hasChanges,
  type AnalysisItem,
  type ApplyReport,
  type ImageAnalysis,
  type Operation,
  type ProgressReport,
} from '../../state/imageOptimization'
import { useEditorStore } from '../../state/store'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { formatBytes, formatPercent, formatPixels } from '../format'

type Phase =
  | { kind: 'analyzing'; progress: ProgressReport | null }
  | { kind: 'ready'; analysis: ImageAnalysis }
  | { kind: 'applying'; progress: ProgressReport | null }
  | { kind: 'done'; analysis: ImageAnalysis; report: ApplyReport }
  | { kind: 'error'; message: string }

export function ImageOptimizeModal({
  scope,
  onOpenChange,
  save,
}: {
  scope: OptimizationScope
  onOpenChange: (open: boolean) => void
  /** Store the committed document. Resolves `true` once it is stored. */
  save: () => Promise<boolean>
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'analyzing', progress: null })

  useEffect(() => {
    const controller = new AbortController()
    const processor = createRasterProcessor()
    const analyse = async (): Promise<ImageAnalysis> => {
      const presentation = useEditorStore.getState().presentation
      if (!presentation) throw new Error('Ingen presentasjon er åpen.')
      return analyzeImages(presentation, scope, {
        repository,
        processor,
        signal: controller.signal,
        onProgress: (progress) =>
          setPhase((current) =>
            current.kind === 'analyzing' ? { kind: 'analyzing', progress } : current,
          ),
      })
    }
    analyse()
      .then((analysis) => {
        if (!controller.signal.aborted) setPhase({ kind: 'ready', analysis })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPhase({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Analysen av bildene feilet.',
        })
      })
      .finally(() => processor.dispose())
    return () => {
      controller.abort()
      processor.dispose()
    }
  }, [scope])

  const apply = async (): Promise<void> => {
    if (phase.kind !== 'ready') return
    const { analysis } = phase
    setPhase({ kind: 'applying', progress: null })
    try {
      const report = await applyImageOptimization(analysis, {
        repository,
        current: () => useEditorStore.getState().presentation,
        commit: (next) => useEditorStore.getState().replaceDocument(next),
        save,
        onProgress: (progress) =>
          setPhase((current) => (current.kind === 'applying' ? { kind: 'applying', progress } : current)),
      })
      setPhase({ kind: 'done', analysis, report })
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Optimaliseringen feilet.',
      })
    }
  }

  const whole = scope.kind === 'all'
  const busy = phase.kind === 'applying'
  const ready = phase.kind === 'ready' && hasChanges(phase.analysis)

  return (
    <Modal
      open
      // Nothing may interrupt the write once it has started: the files are
      // stored in an order that is safe to stop at, but the dialog is what
      // tells the user how it ended.
      onOpenChange={(open) => {
        if (!open && busy) return
        onOpenChange(open)
      }}
      title={whole ? 'Optimaliser bilder' : 'Optimaliser bildet'}
      description={
        whole
          ? 'Mindre filer uten synlig kvalitetstap: beskjæring, nedskalering, komprimering og fjerning av metadata.'
          : 'Filen tilpasses det som faktisk vises på sliden.'
      }
      testId="optimize-modal"
      width={560}
      footer={
        <>
          {phase.kind === 'ready' || phase.kind === 'analyzing' ? (
            <button type="button" className="btn" onClick={() => onOpenChange(false)} data-testid="optimize-cancel">
              {ready ? 'Avbryt' : 'Lukk'}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              data-testid="optimize-close"
            >
              Lukk
            </button>
          )}
          {ready && (
            <button type="button" className="btn btn--primary" onClick={() => void apply()} data-testid="optimize-confirm">
              <Icon name="optimize" size={15} /> Optimaliser
            </button>
          )}
        </>
      }
    >
      {phase.kind === 'analyzing' && <Progress progress={phase.progress} fallback="Analyserer bildene …" />}
      {phase.kind === 'applying' && <Progress progress={phase.progress} fallback="Optimaliserer …" />}
      {phase.kind === 'error' && (
        <p className="error-text" data-testid="optimize-error">
          {phase.message}
        </p>
      )}
      {phase.kind === 'ready' &&
        (whole ? <WholeDeckSummary analysis={phase.analysis} /> : <SingleFileSummary analysis={phase.analysis} />)}
      {phase.kind === 'ready' && hasChanges(phase.analysis) && <Warnings analysis={phase.analysis} />}
      {phase.kind === 'done' && <Outcome analysis={phase.analysis} report={phase.report} />}
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function Progress({ progress, fallback }: { progress: ProgressReport | null; fallback: string }) {
  const share = progress && progress.total > 0 ? progress.done / progress.total : 0
  return (
    <div className="optimize-progress" data-testid="optimize-progress" data-phase={progress?.phase ?? 'start'}>
      <p className="hint">{progress ? describeProgress(progress) : fallback}</p>
      <div className="optimize-meter" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={share}>
        <div className="optimize-meter__fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  )
}

function describeProgress(progress: ProgressReport): string {
  const step = progress.total > 0 ? ` (${Math.min(progress.done + 1, progress.total)} av ${progress.total})` : ''
  switch (progress.phase) {
    case 'reading':
      return `Leser filene …${step}`
    case 'processing':
      return progress.name ? `Behandler «${progress.name}» …${step}` : `Behandler bildene …${step}`
    case 'storing':
      return `Lagrer de nye filene …${step}`
    case 'saving':
      return 'Lagrer presentasjonen …'
    case 'cleaning':
      return 'Fjerner de gamle filene …'
  }
}

/** The whole deck: totals first, then how many pictures each step touches. */
function WholeDeckSummary({ analysis }: { analysis: ImageAnalysis }) {
  const { summary } = analysis
  if (summary.before === 0) {
    return <p className="hint">Presentasjonen har ingen bildefiler.</p>
  }
  if (!hasChanges(analysis)) {
    return (
      <p data-testid="optimize-nothing">
        Bildene er allerede optimalt dimensjonert og komprimert. Ingenting å gjøre.
        {summary.failed > 0 && <FailedNames analysis={analysis} />}
      </p>
    )
  }
  const saving = summary.before - summary.after
  return (
    <>
      <dl className="optimize-summary" data-testid="optimize-summary">
        <dt>Bilder</dt>
        <dd>
          <strong>{formatBytes(summary.before)}</strong> → ca. <strong>{formatBytes(summary.after)}</strong>
        </dd>
        <dt>Forventet besparelse</dt>
        <dd>
          <strong data-testid="optimize-saving">{formatPercent(saving / summary.before)}</strong> ({formatBytes(saving)})
        </dd>
      </dl>
      <ul className="optimize-list" data-testid="optimize-counts">
        {summary.cropped > 0 && <li>{plural(summary.cropped, 'bilde beskjæres', 'bilder beskjæres')} permanent til det synlige utsnittet</li>}
        {summary.downscaled > 0 && <li>{plural(summary.downscaled, 'bilde skaleres', 'bilder skaleres')} ned til den oppløsningen sliden trenger</li>}
        {summary.recompressed > 0 && <li>{plural(summary.recompressed, 'bilde komprimeres', 'bilder komprimeres')} i et mer plassbesparende format</li>}
        {summary.metadataStripped > 0 && <li>{plural(summary.metadataStripped, 'bilde får', 'bilder får')} fjernet metadata (EXIF, GPS, miniatyrbilder)</li>}
        {summary.merged > 0 && <li>{plural(summary.merged, 'kopi av en fil', 'kopier av filer')} som alt finnes slås sammen med originalen</li>}
        {summary.optimal > 0 && <li>{plural(summary.optimal, 'bilde er', 'bilder er')} allerede optimalt og beholdes</li>}
        {summary.failed > 0 && (
          <li className="optimize-failed">
            {plural(summary.failed, 'bilde kunne', 'bilder kunne')} ikke behandles og beholdes som de er
            <FailedNames analysis={analysis} />
          </li>
        )}
      </ul>
    </>
  )
}

/** One picture: the file as it is, and each thing that would be done to it. */
function SingleFileSummary({ analysis }: { analysis: ImageAnalysis }) {
  const item: AnalysisItem | undefined = analysis.items[0]
  if (!item) return <p className="hint">Sonen viser ingen bildefil.</p>
  const { plan, outcome } = item
  const others = plan.occurrences.length - 1

  return (
    <>
      <div className="optimize-file" data-testid="optimize-file">
        <strong>{plan.ref.name}</strong>
        <span className="hint">
          {formatPixels(plan.ref.width, plan.ref.height)} · {formatBytes(plan.ref.byteSize)}
          {plan.ref.isVector ? ' · SVG' : ''}
        </span>
      </div>
      {outcome.kind === 'optimized' ? (
        <>
          <ul className="optimize-list" data-testid="optimize-operations">
            {outcome.operations.map((operation) => (
              <li key={operation} data-operation={operation}>
                {describeOperation(operation, item)}
              </li>
            ))}
          </ul>
          <dl className="optimize-summary" data-testid="optimize-summary">
            <dt>Størrelse</dt>
            <dd>
              <strong>{formatBytes(outcome.before)}</strong> → <strong>{formatBytes(outcome.after)}</strong>
            </dd>
            <dt>Besparelse</dt>
            <dd>
              <strong data-testid="optimize-saving">{formatPercent((outcome.before - outcome.after) / outcome.before)}</strong>
            </dd>
          </dl>
          {plan.mode === 'fork' && (
            <p className="hint" data-testid="optimize-fork-note">
              Bildet brukes også {plural(others, 'ett annet sted', 'andre steder')} i presentasjonen. De beholder
              originalen; dette panelet får sin egen, beskårne fil.
            </p>
          )}
          {plan.mode === 'shared' && others > 0 && (
            <p className="hint" data-testid="optimize-shared-note">
              Bildet brukes {others + 1} steder i presentasjonen og er dimensjonert etter det største av dem.
              Alle stedene får den nye filen.
            </p>
          )}
        </>
      ) : (
        <p data-testid="optimize-nothing">{describeUnchanged(outcome)}</p>
      )}
    </>
  )
}

function describeOperation(operation: Operation, item: AnalysisItem): string {
  const { plan, outcome } = item
  const raster = plan.raster
  switch (operation) {
    case 'crop': {
      const hidden =
        raster && plan.ref.width > 0 && plan.ref.height > 0
          ? 1 - (raster.source.width * raster.source.height) / (plan.ref.width * plan.ref.height)
          : 0
      return `Beskjærer permanent til det synlige utsnittet og fjerner ${formatPercent(hidden)} av pikslene`
    }
    case 'downscale':
      return outcome.kind === 'optimized'
        ? `Skalerer ned fra ${formatPixels(plan.ref.width, plan.ref.height)} til ${formatPixels(outcome.ref.width, outcome.ref.height)}`
        : 'Skalerer ned til den oppløsningen sliden trenger'
    case 'recompress':
      return outcome.kind === 'optimized'
        ? `Komprimerer som ${formatLabel(outcome.ref.mimeType)}`
        : 'Komprimerer i et mer plassbesparende format'
    case 'metadata':
      return 'Fjerner metadata (EXIF, GPS-posisjon, miniatyrbilde)'
  }
}

function describeUnchanged(outcome: AnalysisItem['outcome']): string {
  if (outcome.kind === 'failed') return `Bildet kunne ikke behandles: ${outcome.message}`
  if (outcome.kind === 'optimal') {
    switch (outcome.reason) {
      case 'vector':
        return 'SVG beholdes som vektorgrafikk og trenger ingen optimalisering.'
      case 'animated':
        return 'Animerte bilder beholdes uendret, ellers ville bare første bilde overlevd.'
      case 'no-gain':
        return 'Bildet er allerede optimalt dimensjonert og komprimert for det som vises.'
    }
  }
  return 'Ingen endring.'
}

/** What the user has to know before pressing the button. */
function Warnings({ analysis }: { analysis: ImageAnalysis }) {
  return (
    <>
      {analysis.summary.cropped > 0 && (
        <p className="optimize-warning" data-testid="optimize-crop-warning">
          Delene av bildet som ligger utenfor rammen slettes for godt og kan ikke hentes tilbake. Flytt
          utsnittet eller gjør sonen større først hvis du vil beholde mer av bildet.
        </p>
      )}
      <p className="hint" data-testid="optimize-undo-note">
        Optimaliseringen erstatter selve bildefilene og kan ikke angres med Ctrl+Z. Angrehistorikken
        nullstilles.
      </p>
    </>
  )
}

function Outcome({ analysis, report }: { analysis: ImageAnalysis; report: ApplyReport }) {
  const kept = analysis.items.length - report.failed.length
  return (
    <div className="optimize-outcome" data-testid="optimize-done">
      <p>
        {report.replaced === 0
          ? 'Ingen filer ble endret.'
          : `${plural(report.replaced, 'fil ble', 'filer ble')} optimalisert. Presentasjonen bruker ${formatBytes(report.savedBytes)} mindre plass.`}
      </p>
      {!report.saved && report.replaced > 0 && (
        <p className="optimize-warning" data-testid="optimize-unsaved">
          Presentasjonen er endret, men ikke lagret ennå. De gamle filene beholdes til lagringen lykkes.
        </p>
      )}
      {report.failed.length > 0 && (
        <ul className="optimize-list optimize-failed">
          {report.failed.map((failure) => (
            <li key={failure.ref.id}>
              «{failure.ref.name}» ble ikke erstattet: {failure.message}
            </li>
          ))}
        </ul>
      )}
      {report.orphaned.length > 0 && (
        <p className="hint">
          {plural(report.orphaned.length, 'gammel fil', 'gamle filer')} kunne ikke slettes fra lagringen. Ingenting
          peker på dem lenger; de ryddes opp senere.
        </p>
      )}
      {kept < analysis.items.length && <span className="hint">{analysis.items.length - kept} beholdt som før.</span>}
    </div>
  )
}

function FailedNames({ analysis }: { analysis: ImageAnalysis }) {
  const failed = analysis.items.filter((item) => item.outcome.kind === 'failed')
  return (
    <ul className="optimize-list">
      {failed.map((item) => (
        <li key={item.plan.ref.id}>
          «{item.plan.ref.name}»: {item.outcome.kind === 'failed' ? item.outcome.message : ''}
        </li>
      ))}
    </ul>
  )
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

const FORMAT_LABELS: Record<string, string> = {
  'image/webp': 'WebP',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
}

function formatLabel(mimeType: string): string {
  return FORMAT_LABELS[mimeType] ?? mimeType
}
