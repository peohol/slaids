/**
 * The deck's pictures, in the one place the author deals with them.
 *
 * Two halves, and the split is the whole point of the dialog. The top is the
 * only text a person writes: the visual context every picture in the deck
 * shares — how they should look, never what any one of them shows. Under it is
 * the thing they came for: **the whole series as one finished order**, composed
 * by `composeImageBrief`, to copy into one conversation that from that point
 * makes nothing but pictures.
 *
 * That the whole brief is the primary action is a correction, and it is the
 * second one. Copying the whole brief was the obvious button; then a deck of
 * eight came back as a storyboard, and the answer was to hand out one picture's
 * prompt at a time with the agent looping back between them. The loop is what
 * failed next — a host client's image tool does not survive alternating between
 * deck work and image calls — and what works is the thing the storyboard was
 * blamed on, stated properly: one task, N separate files. The brief says so in
 * its first line, its numbering and its last line.
 *
 * The per-picture prompt is still here, one fold down, as what it actually is:
 * the repair. Picture 5 came back wrong, or never came back — copy that one
 * order into an empty conversation and get that one picture, without ordering
 * the series again.
 *
 * What is wrong with the plan is listed under the pictures rather than hidden
 * behind a validation step: a plan whose pictures no longer match the zones is
 * exactly the plan somebody is about to generate from.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_IMAGE_CONTEXT_CHARS } from '../../domain/constants'
import { setImageContext, syncImagePlaceholders } from '../../domain/commands'
import { depositIsWaiting } from '../../domain/imageDeposit'
import {
  checkImagePlan,
  composeImageBrief,
  composeImageGenerationPrompt,
  imageZoneKey,
  resolveImagePlan,
} from '../../domain/imagePlan'
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../components/clipboard'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useEditorStore } from '../../state/store'

const PLACEHOLDER =
  'Beskriv det visuelle uttrykket som skal være felles for alle bildene i dekket: fotografisk eller illustrert, realismegrad, lyssetting, fargeholdning, komposisjonsprinsipper og hva som konsekvent skal unngås. Ikke beskriv motivene — de hører hjemme i bildeplanen, ett motiv per bildesone.'

/**
 * The one thing a copy button may be doing at a time, so feedback lands on it.
 *
 * The text is kept beside the outcome because a refused copy has to offer
 * *that* text to select by hand — the one that failed, never some other one.
 */
type CopyState = { key: string; ok: boolean; text: string } | null

export function ImageBriefModal({
  onClose,
  onDeposit,
}: {
  onClose: () => void
  /**
   * Go on to the deposit. Offered only while the deck is actually waiting for
   * files: a brief is worth reading at any time, but «bildene er klare» has
   * nowhere to lead once the pictures are in the zones.
   */
  onDeposit?: () => void
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  const [copied, setCopied] = useState<CopyState>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  /*
   * Bring the slides' placeholder captions back in line with the brief, once,
   * as the dialog opens.
   *
   * The numbering is deck order and the deck keeps moving after a plan is
   * written — a slide dragged in the filmstrip renumbers the brief while the
   * captions keep saying what they said. This is the one screen where the two
   * are read together, so it is the honest place to reconcile them, and it is
   * the app's job rather than the author's. Idempotent: a deck already in line
   * comes back unchanged and nothing is saved.
   */
  useEffect(() => {
    run('image-placeholders', (current) => syncImagePlaceholders(current))
  }, [run])

  const brief = useMemo(
    () => (presentation ? composeImageBrief(presentation) : null),
    [presentation],
  )
  const issues = useMemo(() => (presentation ? checkImagePlan(presentation) : []), [presentation])
  const images = useMemo(() => (presentation ? resolveImagePlan(presentation) : []), [presentation])
  /*
   * One order per picture, for the fold-down repair. Composed by the domain, so
   * a picture ordered again on its own is ordered from the same fields the
   * series brief states it with.
   */
  const prompts = useMemo(
    () =>
      new Map(
        images.map((image) => [
          image.number,
          composeImageGenerationPrompt(image, presentation?.imageContext ?? ''),
        ]),
      ),
    [images, presentation?.imageContext],
  )

  if (!presentation) return null
  const context = presentation.imageContext ?? ''
  const ready = Boolean(onDeposit) && depositIsWaiting(presentation)

  const copy = async (key: string, text: string): Promise<void> => {
    const ok = await copyToClipboard(text)
    setCopied({ key, ok, text })
    if (timer.current) clearTimeout(timer.current)
    if (ok) timer.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS)
  }

  const refused = copied?.ok === false ? copied : null

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Bildebrief"
      description="Hele bildebestillingen for dekket som én tekst. Kopier den og lim den inn i én samtale som fra det punktet bare lager bilder — så kommer alle bildene ut av den ene oppgaven. Dialogen vises aldri for publikum."
      testId="image-brief-modal"
      width={720}
      footer={
        <>
          <span className="hint" data-testid="image-brief-modal-count">
            {images.length === 0
              ? 'Ingen bilder planlagt'
              : `${images.length} ${images.length === 1 ? 'bilde' : 'bilder'} planlagt`}
          </span>
          {ready && (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="image-brief-modal-deposit"
              onClick={onDeposit}
            >
              Bildene er klare
            </button>
          )}
          <button
            type="button"
            className={ready ? 'btn' : 'btn btn--primary'}
            onClick={onClose}
          >
            Lukk
          </button>
        </>
      }
    >
      <h3 className="inspector__heading">Felles bildekontekst</h3>
      <p className="hint">
        Hvordan bildene skal se ut — ikke hva de viser. Slaids legger denne teksten inn én gang
        øverst i briefen, som stilen hele serien deler.
      </p>
      <textarea
        className="editorial-text"
        data-testid="image-brief-modal-context"
        value={context}
        maxLength={MAX_IMAGE_CONTEXT_CHARS}
        placeholder={PLACEHOLDER}
        spellCheck
        onChange={(event) =>
          run('typing:image-context', (current) => setImageContext(current, event.target.value))
        }
      />
      <p className="hint" data-testid="image-brief-modal-context-count">
        {context.length} / {MAX_IMAGE_CONTEXT_CHARS} tegn
      </p>

      <h3 className="inspector__heading">Bestillingen</h3>
      {images.length === 0 ? (
        <>
          <p className="hint" data-testid="image-brief-modal-empty">
            Dekket har ingen planlagte bilder ennå. Lag en bildesone og legg bildet inn i
            bildeplanen, så står bestillingen klar her.
          </p>
          <button type="button" className="btn" data-testid="image-brief-modal-copy" disabled>
            <Icon name="copy" size={15} /> Kopier bildebrief
          </button>
        </>
      ) : (
        <>
          <p className="hint" data-testid="image-brief-modal-how">
            Slik gjør du det: kopier teksten under, lim den inn i én samtale — gjerne en ny — og la
            den samtalen bare handle om å lage bilder. Bestillingen ber om{' '}
            {images.length === 1 ? 'ett bilde' : `${images.length} separate bilder`}, med riktig
            aspect ratio på hvert av dem. Lagre {images.length === 1 ? 'bildet' : 'bildene'} som{' '}
            {images.length === 1 ? 'en egen fil' : 'separate filer'}, og legg{' '}
            {images.length === 1 ? 'den' : 'dem'} inn her etterpå.
          </p>
          <textarea
            className="editorial-text editorial-text--generated"
            data-testid="image-brief-modal-text"
            value={brief ?? ''}
            readOnly
            spellCheck={false}
          />
          <button
            type="button"
            className="btn btn--primary"
            data-testid="image-brief-modal-copy"
            onClick={() => void copy('brief', brief ?? '')}
          >
            <Icon name="copy" size={15} />{' '}
            {copied?.key === 'brief' && copied.ok ? 'Kopiert' : 'Kopier bildebrief'}
          </button>
        </>
      )}

      {ready && (
        <p className="hint" data-testid="image-brief-modal-next">
          Når bildene er laget, trykk «Bildene er klare» og slipp alle filene inn på én gang. Heter
          de <code>1</code>, <code>2</code>, <code>3</code> … havner de riktig av seg selv; heter de
          noe annet, drar du dem i riktig rekkefølge.
        </p>
      )}

      {issues.length > 0 && (
        <ul className="hint" data-testid="image-brief-modal-issues">
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${index}`}>{issue.message}</li>
          ))}
        </ul>
      )}

      {refused && (
        /*
         * The browser said no, and the manual way out has to be the *same* text
         * the button would have copied — the series brief when that is what was
         * refused, that one picture's order when it was not.
         */
        <>
          <p className="hint" data-testid="image-brief-modal-copy-failed">
            Nettleseren tillot ikke kopiering. Teksten står her under – merk den og kopier den selv.
          </p>
          <textarea
            className="editorial-text editorial-text--generated"
            data-testid="image-brief-modal-copy-fallback"
            value={refused.text}
            readOnly
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
        </>
      )}

      {images.length > 0 && (
        /*
          One picture at a time, one fold down, and named for the errand it is
          for: something came back wrong, or did not come back. Ordering the
          series again for one missing picture is the thing this avoids.
        */
        <details className="image-brief__fold" data-testid="image-brief-modal-single">
          <summary className="hint">Lage ett enkelt bilde om igjen</summary>
          <p className="hint">
            Kom ett av bildene feil ut, eller mangler det? Kopier bestillingen for akkurat det ene
            bildet og lim den inn i en ny, tom samtale. Den står alene og sier ingenting om de
            andre, så du får det ene bildet — ikke serien på nytt.
          </p>
          <ol className="deposit-list" data-testid="image-brief-modal-list">
            {images.map((image) => {
              const prompt = prompts.get(image.number) ?? ''
              const key = imageZoneKey(image.plan.slideId, image.plan.nodeId)
              return (
                <li key={key} className="deposit-row">
                  <span className="deposit-row__mark" aria-hidden="true">
                    {image.number}
                  </span>
                  <span className="deposit-row__text">
                    <strong>
                      Bilde {image.number} · {image.aspectRatio} ({image.orientation})
                    </strong>
                    <span className="hint">{image.plan.subject}</span>
                    <span className="hint">På sliden «{image.slideLabel}»</span>
                    {image.filled && <span className="hint">Bildet ligger allerede i sonen</span>}
                  </span>
                  <button
                    type="button"
                    className="btn deposit-row__action"
                    data-testid={`image-brief-modal-copy-prompt-${image.number}`}
                    onClick={() => void copy(key, prompt)}
                  >
                    <Icon name="copy" size={15} />{' '}
                    {copied?.key === key && copied.ok ? 'Kopiert' : 'Kopier prompt'}
                  </button>
                </li>
              )
            })}
          </ol>
        </details>
      )}
    </Modal>
  )
}
