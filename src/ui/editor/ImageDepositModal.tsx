/**
 * Taking the whole set of generated pictures back in one go.
 *
 * The other end of `ImageBriefModal`: the brief asked for N pictures, numbered
 * 1‥N, and this is where the N files come back. Everything the dialog does is
 * in service of one promise — either every picture lands in the zone it was
 * made for, or nothing happens at all.
 *
 * Three things follow from that, and they are the whole design:
 *
 *  - **The file name is the only instruction.** `1.png`, `2.jpg`, `3.webp`.
 *    Nothing else is asked of the user — no dragging file onto slot, no
 *    matching by eye — because the numbering already exists, in the brief they
 *    pasted and in the placeholder on every slide. `domain/imageDeposit.ts`
 *    owns the rule; this shows its verdicts.
 *  - **Nothing is guessed.** `01.png` and `bilde1.png` are named, with the
 *    reason, rather than quietly matched to picture 1 — and two files claiming
 *    the same number are both flagged, because choosing between somebody's two
 *    pictures is not Slaids' to do.
 *  - **«Fullfør» is the last check, not the first.** It stays disabled until
 *    the set is exactly 1‥N with nothing rejected, and the same domain
 *    predicate that greys it out is what the command refuses on, so the button
 *    cannot be enabled for a set the write would turn down.
 *
 * The write itself goes outside the undo history, exactly as the image
 * optimiser's does and for the same reason: files are stored on the way, so a
 * Ctrl+Z back to «no pictures» would be an undo into a state the deck's own
 * files no longer match.
 */

import { useMemo, useRef, useState } from 'react'
import { completeImageDeposit, registerAsset, type DepositPlacement } from '../../domain/commands'
import { depositImages, reviewDepositFiles } from '../../domain/imageDeposit'
import { IMAGE_FILE_ACCEPT } from '../../domain/imageBytes'
import { describeError } from '../../domain/result'
import {
  describeSanitizing,
  discardUploadedAssets,
  storeUploadedFile,
} from '../../state/assetUpload'
import { domFitCheckers } from '../../state/measure'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

/** What to say about a file that cannot be used, in the user's own terms. */
const PROBLEM_TEXT: Record<'NAME' | 'RANGE' | 'DUPLICATE', string> = {
  NAME: 'Feil filnavn. Filen må hete et tall og ingenting mer, for eksempel 1.png.',
  RANGE: 'Nummeret er ikke blant bildene som skal settes inn.',
  DUPLICATE: 'To filer har det samme nummeret. Behold én av dem.',
}

export function ImageDepositModal({ onClose }: { onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const replaceDocument = useEditorStore((state) => state.replaceDocument)
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const images = useMemo(() => (presentation ? depositImages(presentation) : []), [presentation])
  const expected = images.length
  const review = useMemo(
    () => reviewDepositFiles(files.map((file) => file.name), expected),
    [files, expected],
  )
  const byIndex = useMemo(() => {
    const map = new Map<number, { file: File; position: number }>()
    review.files.forEach((verdict, position) => {
      if (verdict.problem === null && verdict.index !== null) {
        map.set(verdict.index, { file: files[position], position })
      }
    })
    return map
  }, [review, files])
  const problems = review.files.filter((verdict) => verdict.problem !== null)

  /**
   * Added, never replaced: the pictures may well arrive in two goes — a folder
   * dropped, then the one that had to be regenerated — and a second drop that
   * threw the first away would be a trap in a dialog whose whole job is to
   * gather a complete set.
   *
   * The caller hands over a plain array rather than the live `FileList`, and
   * that is not tidiness: the input is cleared the moment the event is read, so
   * a lazy state updater holding the `FileList` would read an empty one by the
   * time React flushed it.
   */
  const addFiles = (picked: readonly File[]): void => {
    if (picked.length === 0) return
    setFiles((current) => [...current, ...picked])
  }

  const removeAt = (position: number): void => {
    setFiles((current) => current.filter((_, index) => index !== position))
  }

  /**
   * Store the files and put them in their zones, or leave nothing behind.
   *
   * Two things can go wrong between the first byte written and the document
   * committed, and both are handled here rather than hoped against:
   *
   *  - **the deck can move under the upload.** Ctrl+Z reaches the document even
   *    while this dialog is open (see `EditorView`'s capture handler), and
   *    `replaceDocument` only checks the presentation's *id*. So the document
   *    this started from is held, and if it is no longer the live one the
   *    deposit is abandoned rather than written: committing would put back a
   *    document the user had just stepped away from, and clear the history on
   *    the way.
   *  - **a file can be refused after an earlier one was stored.**
   *    `storeUploadedFile` writes bytes before anything points at them, so a
   *    batch that stops halfway would leave files in the store that the deck
   *    does not list — unreachable, and not something `deleteOrphanAssets`
   *    reclaims, because the presentation is still very much there.
   *
   * So every file this call writes is remembered, and unless the document is
   * committed they are all taken back. «All or nothing» is the promise the
   * dialog makes about the slides; this is the same promise about storage.
   *
   * Returns whether the document was committed, which is what decides whether
   * the files it wrote are kept or taken back. Ids of files that were *reused*
   * are deliberately not collected: those were the deck's before this started.
   */
  const deposit = async (written: string[]): Promise<boolean> => {
    const source = useEditorStore.getState().presentation
    if (!source || !review.ready) return false

    let next = source
    const placements: DepositPlacement[] = []
    for (const image of images) {
      const picked = byIndex.get(image.index)
      if (!picked) return false
      const uploaded = await storeUploadedFile(next, picked.file)
      if (!uploaded.ok) {
        notify.error(`Bilde ${image.index}: ${describeError(uploaded.error)}`)
        return false
      }
      if (!uploaded.value.reused) written.push(uploaded.value.ref.id)
      const dropped = describeSanitizing(uploaded.value.report)
      if (dropped) notify.warning(`Bilde ${image.index}: ${dropped}`)
      const registered = registerAsset(next, uploaded.value.ref)
      if (!registered.ok) {
        notify.error(describeError(registered.error))
        return false
      }
      next = registered.value
      placements.push({ index: image.index, assetId: uploaded.value.ref.id })
    }

    // Identity, not id: the deck must be the very document the uploads were
    // computed against, or this would write a version of it that has since been
    // stepped away from.
    if (useEditorStore.getState().presentation !== source) {
      notify.warning(
        'Presentasjonen ble endret mens bildene ble lastet opp, så ingenting ble satt inn. Prøv igjen.',
      )
      return false
    }

    // One write for the whole set: a deck that took three of five pictures is
    // the state this dialog exists to prevent.
    const done = completeImageDeposit(next, placements, domFitCheckers)
    if (!done.ok) {
      notify.error(describeError(done.error))
      return false
    }
    replaceDocument(done.value)
    notify.success(
      placements.length === 1
        ? 'Bildet ble satt inn i presentasjonen.'
        : `Alle ${placements.length} bildene ble satt inn i presentasjonen.`,
    )
    return true
  }

  const complete = async (): Promise<void> => {
    setBusy(true)
    const written: string[] = []
    let committed = false
    try {
      committed = await deposit(written)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Bildene kunne ikke settes inn.')
    } finally {
      /*
       * Anything this call wrote for a deposit that did not land is taken back
       * *before* the dialog becomes usable again — so a second attempt cannot
       * race the first one's rollback, and the store is never briefly holding
       * files nothing points at while somebody is clicking.
       */
      if (!committed) await discardUploadedAssets(written)
      setBusy(false)
    }
    if (committed) onClose()
  }

  if (!presentation) return null

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title="Legg inn bildene"
      description={`Presentasjonen venter på ${expected} ${expected === 1 ? 'bilde' : 'bilder'}. Slipp filene her, så havner hvert bilde på riktig plass av seg selv.`}
      testId="image-deposit-modal"
      width={640}
      footer={
        <>
          <span className="hint" data-testid="image-deposit-progress">
            {review.present.length} av {expected} på plass
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="image-deposit-finish"
            disabled={!review.ready || busy}
            onClick={() => void complete()}
          >
            {busy ? 'Setter inn …' : 'Fullfør'}
          </button>
        </>
      }
    >
      <p className="hint">
        Filene må hete tallet sitt og ingenting mer: <code>1.png</code>, <code>2.jpg</code>,{' '}
        <code>3.webp</code> og så videre opp til {expected}. Formatene kan gjerne være forskjellige.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        multiple
        style={{ display: 'none' }}
        data-testid="image-deposit-input"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? [])
          event.target.value = ''
          addFiles(picked)
        }}
      />

      <div
        className={dragOver ? 'dropzone dropzone--over' : 'dropzone'}
        data-testid="image-deposit-dropzone"
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          addFiles(Array.from(event.dataTransfer.files ?? []))
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
      >
        <Icon name="upload" size={28} />
        <p>Dra alle bildene hit, eller klikk for å velge dem</p>
        <span className="hint">Du kan legge til flere filer i flere omganger</span>
      </div>

      <h3 className="inspector__heading">Bildene som skal inn</h3>
      <ul className="deposit-list" data-testid="image-deposit-status">
        {images.map((image) => {
          const picked = byIndex.get(image.index)
          return (
            <li
              key={image.index}
              className={picked ? 'deposit-row deposit-row--ready' : 'deposit-row'}
              data-testid={`image-deposit-row-${image.index}`}
              data-state={picked ? 'ready' : 'missing'}
            >
              <span className="deposit-row__mark" aria-hidden="true">
                {picked ? <Icon name="check" size={15} /> : image.index}
              </span>
              <span className="deposit-row__text">
                <strong>
                  Bilde {image.index}
                  {image.desiredAspectRatio ? ` · ${image.desiredAspectRatio}` : ''}
                </strong>
                <span className="hint">{image.generationBrief || 'Ingen beskrivelse'}</span>
              </span>
              {picked ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => removeAt(picked.position)}
                  disabled={busy}
                  aria-label={`Fjern ${picked.file.name}`}
                >
                  {picked.file.name} <Icon name="close" size={14} />
                </button>
              ) : (
                <span className="deposit-row__file hint">Mangler</span>
              )}
            </li>
          )
        })}
      </ul>

      {problems.length > 0 && (
        <>
          <h3 className="inspector__heading">Filer som ikke kan brukes</h3>
          <ul className="deposit-list" data-testid="image-deposit-problems">
            {review.files.map((verdict, position) =>
              verdict.problem === null ? null : (
                <li key={`${verdict.name}:${position}`} className="deposit-row deposit-row--problem">
                  <span className="deposit-row__text">
                    <strong>{verdict.name}</strong>
                    <span className="hint">{PROBLEM_TEXT[verdict.problem]}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => removeAt(position)}
                    aria-label={`Fjern ${verdict.name}`}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </Modal>
  )
}
