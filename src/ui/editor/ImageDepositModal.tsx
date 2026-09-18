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
 *  - **There are two ways to say the order, and the dialog picks between them
 *    by itself.** Files called exactly `1`, `2`, `3` … say it in their names,
 *    whatever order they were dropped in. Anything else does not, and then the
 *    person says it by dragging the pictures into place — with the actual
 *    pictures on screen, because the one thing they can answer instantly is
 *    «which picture is which», and the one thing they cannot is what a
 *    generator decided to call its output.
 *  - **Nothing is guessed.** `01.png`, `bilde1.png` and `1-final.png` are
 *    ordinary file names, not broken numbers: they go into the manual order
 *    like everything else rather than being quietly matched to picture 1 or
 *    rejected for their names. Only a complete, unambiguous 1‥N is read as a
 *    numbering. `domain/imageDeposit.ts` owns that rule; this shows its
 *    verdicts.
 *  - **«Fullfør» is the last check, not the first.** It stays disabled until
 *    there are exactly N usable pictures with a place each, and the same domain
 *    predicate that greys it out is what the command refuses on, so the button
 *    cannot be enabled for a set the write would turn down.
 *
 * The write itself goes outside the undo history, exactly as the image
 * optimiser's does and for the same reason: files are stored on the way, so a
 * Ctrl+Z back to «no pictures» would be an undo into a state the deck's own
 * files no longer match.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { completeImageDeposit, registerAsset, type DepositPlacement } from '../../domain/commands'
import {
  depositImages,
  reviewDepositFiles,
  type DepositFileProblem,
} from '../../domain/imageDeposit'
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
import { useReorderDrag } from '../components/reorderDrag'

/** What to say about a file that cannot be used, in the user's own terms. */
const PROBLEM_TEXT: Record<DepositFileProblem, string> = {
  TYPE: 'Ikke en bildefil Slaids kan lagre. Bruk PNG, JPG, WEBP, AVIF, GIF eller SVG.',
  EXCESS: 'Det er flere bilder enn presentasjonen har plass til. Fjern de som ikke skal inn.',
}

export function ImageDepositModal({ onClose }: { onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const replaceDocument = useEditorStore((state) => state.replaceDocument)
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  /* The list as the drag sees it: the gesture reports a position, and the
     position has to be read against the array that was on screen. */
  const filesRef = useRef<File[]>(files)

  const images = useMemo(() => (presentation ? depositImages(presentation) : []), [presentation])
  const expected = images.length

  const review = useMemo(
    () => reviewDepositFiles(files.map((file) => file.name), expected),
    [files, expected],
  )

  useEffect(() => {
    filesRef.current = files
  })

  /*
   * A thumbnail per picked file, so the order is chosen by looking at pictures
   * rather than at file names.
   *
   * Object URLs rather than data URLs: the browser reads the blob it already
   * holds, so a folder of full-size pictures costs nothing to show. Minted when
   * a file is picked and kept by the `File` itself, because the list is rebuilt
   * on every removal and every drag — a URL made per render would flicker the
   * pictures each time one is moved, which is the one moment the person is
   * looking at them.
   *
   * Released together when the dialog goes, rather than the moment a file is
   * removed: revoking a URL an `<img>` is still showing draws a broken image,
   * and a handful of blobs living until the dialog closes is the cheaper of the
   * two mistakes.
   */
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<File, string>>(new Map())
  const live = useRef<ReadonlyMap<File, string>>(thumbnails)
  useEffect(() => {
    live.current = thumbnails
  })
  useEffect(() => {
    return () => {
      for (const url of live.current.values()) URL.revokeObjectURL(url)
    }
  }, [])

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
    setThumbnails((current) => {
      const next = new Map(current)
      for (const file of picked) {
        if (!next.has(file)) next.set(file, URL.createObjectURL(file))
      }
      return next
    })
    setFiles((current) => [...current, ...picked])
  }

  /* By identity rather than by position: two folders can both hold an
     `IMG_4821.png`, and removing by name would remove the wrong one. */
  const remove = (file: File): void => {
    setFiles((current) => current.filter((item) => item !== file))
  }

  /*
   * Dragging a picture to its place, with the ideas list's own gesture: a quick
   * drag with a mouse, press-and-hold on touch, a placeholder showing the gap,
   * and the list scrolling at its edges. Position *is* the picture number, so
   * the move is an ordinary array move and nothing else has to be decided.
   */
  const drag = useReorderDrag({
    scrollParent: () => listRef.current?.closest<HTMLElement>('.dialog__body') ?? null,
    placeholderClass: 'deposit-row deposit-row--placeholder',
    canStart: () => !busy,
    onDrop: ({ rowId, index }) => {
      const from = Number(rowId)
      const current = filesRef.current
      if (!Number.isInteger(from) || from < 0 || from >= current.length) return
      if (index === from) return
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(index, 0, moved)
      setFiles(next)
    },
  })

  /**
   * The check only a person can make, demanded exactly when nothing else can.
   *
   * A numbered delivery needs nothing extra: whoever named the files `1`‥`N`
   * made the binding, and Slaids only read it. A manual order is the person's
   * own answer, given by dragging, and a tick confirming it is cheap — but it
   * has to be about *this* order. The key is the arrangement itself, so moving
   * one picture unticks the box by itself.
   */
  const orderKey = files.map((file, index) => `${index}:${file.name}:${file.size}`).join('|')
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(null)
  const needsConfirmation = review.mode === 'manual' && review.ready
  const confirmed = !needsConfirmation || acknowledgedFor === orderKey

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

    const byIndex = new Map<number, File>()
    review.files.forEach((verdict, position) => {
      if (verdict.problem === null && verdict.index !== null) {
        byIndex.set(verdict.index, files[position])
      }
    })

    let next = source
    const placements: DepositPlacement[] = []
    for (const image of images) {
      const picked = byIndex.get(image.index)
      if (!picked) return false
      const uploaded = await storeUploadedFile(next, picked)
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

  /* The slot a file is about to become, so a row can say what the picture is
     supposed to show without the plan being looked up twice. */
  const slotOf = (index: number | null) =>
    index === null ? null : (images.find((image) => image.index === index) ?? null)
  const missing = review.missing.map(slotOf).flatMap((slot) => (slot ? [slot] : []))
  const draggable = review.mode === 'manual' && files.length > 1

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      title="Legg inn bildene"
      description={`Presentasjonen venter på ${expected} ${expected === 1 ? 'bilde' : 'bilder'}. Slipp filene her, så havner hvert bilde på riktig plass.`}
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
            disabled={!review.ready || busy || !confirmed}
            onClick={() => void complete()}
          >
            {busy ? 'Setter inn …' : 'Fullfør'}
          </button>
        </>
      }
    >
      {/*
        * Where the order came from, said plainly, because it is the one thing
        * the person has to understand to trust the result. Three sentences for
        * three states: nothing picked yet, a numbering read off the names, and
        * an order that is theirs to give.
        */}
      <p className="hint" data-testid="image-deposit-order" data-mode={review.mode}>
        {files.length === 0 ? (
          <>
            Heter filene <code>1</code>, <code>2</code>, <code>3</code> … opp til {expected}, leser
            Slaids rekkefølgen av navnene. Heter de noe annet, setter du rekkefølgen selv etterpå.
            Formatene kan gjerne være forskjellige.
          </>
        ) : review.mode === 'numbered' ? (
          <>
            Rekkefølgen er lest fra filnavnene 1–{expected}. Rekkefølgen du valgte filene i betyr
            ingenting.
          </>
        ) : (
          <>
            Filnavnene angir ikke rekkefølgen. Dra bildene i riktig rekkefølge — det øverste blir
            bilde 1, det neste bilde 2, og så videre.
          </>
        )}
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

      {files.length > 0 && (
        <>
          <h3 className="inspector__heading">Bildene du har lagt inn</h3>
          <ol
            ref={listRef}
            className={drag.dragging ? 'deposit-list is-dragging' : 'deposit-list'}
            data-testid="image-deposit-files"
          >
            {files.map((file, position) => {
              const verdict = review.files[position]
              const slot = slotOf(verdict?.index ?? null)
              const problem = verdict?.problem ?? null
              return (
                <li
                  key={`${position}:${file.name}`}
                  className={problem ? 'deposit-row deposit-row--problem' : 'deposit-row'}
                  data-testid={`image-deposit-file-${position}`}
                  data-number={verdict?.index ?? ''}
                  data-problem={problem ?? ''}
                  // The whole row is the handle, the remove button excepted: the
                  // picture *is* the row, and a drag that had to start on a
                  // narrow strip beside it is a drag you never find.
                  onPointerDown={(event) => {
                    if (!draggable) return
                    drag.arm(event, String(position), event.currentTarget, '.deposit-row__remove')
                  }}
                  onClickCapture={drag.swallowClick}
                >
                  <span className="deposit-row__mark" aria-hidden="true">
                    {verdict?.index ?? '!'}
                  </span>
                  <img
                    className="deposit-row__thumb"
                    src={thumbnails.get(file)}
                    alt=""
                    draggable={false}
                  />
                  <span className="deposit-row__text">
                    <strong>
                      {verdict?.index === undefined || verdict.index === null
                        ? 'Uten plass'
                        : `Bilde ${verdict.index}`}
                      {slot?.desiredAspectRatio ? ` · ${slot.desiredAspectRatio}` : ''}
                    </strong>
                    <span className="hint">{file.name}</span>
                    {problem ? (
                      <span className="hint">{PROBLEM_TEXT[problem]}</span>
                    ) : (
                      slot?.subject && <span className="hint">{slot.subject}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm deposit-row__remove"
                    onClick={() => remove(file)}
                    disabled={busy}
                    aria-label={`Fjern ${file.name}`}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      {missing.length > 0 && (
        <>
          <h3 className="inspector__heading">Bildene som mangler</h3>
          <ul className="deposit-list" data-testid="image-deposit-missing">
            {missing.map((slot) => (
              <li
                key={slot.index}
                className="deposit-row"
                data-testid={`image-deposit-missing-${slot.index}`}
              >
                <span className="deposit-row__mark" aria-hidden="true">
                  {slot.index}
                </span>
                <span className="deposit-row__text">
                  <strong>
                    Bilde {slot.index}
                    {slot.desiredAspectRatio ? ` · ${slot.desiredAspectRatio}` : ''}
                  </strong>
                  <span className="hint">{slot.subject || 'Ingen beskrivelse'}</span>
                </span>
                <span className="deposit-row__file hint">Mangler</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {needsConfirmation && (
        <label className="hint" data-testid="image-deposit-acknowledge">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setAcknowledgedFor(event.target.checked ? orderKey : null)}
          />{' '}
          Rekkefølgen stemmer: bildet øverst er bilde 1, det neste bilde 2, og så videre.
        </label>
      )}
    </Modal>
  )
}
