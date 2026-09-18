/**
 * The deck's pictures, in the one place the author deals with them.
 *
 * Two halves, and the split is the whole point of the dialog. The top is the
 * only text a person writes: the visual context every picture in the deck
 * shares — how they should look, never what any one of them shows. The bottom
 * is the list of planned pictures, and each row carries the one thing this
 * dialog exists to hand over: **that picture's own prompt**, composed by
 * `composeImageGenerationPrompt` from the shared context and that one entry.
 *
 * The per-picture copy is the primary action, and that is a correction rather
 * than a preference. Copying «the whole brief» was the obvious button, and a
 * whole brief pasted into an image generator is a generator that has been shown
 * a set — which is what comes back: a collage, a contact sheet, a storyboard.
 * One clean prompt in a fresh conversation is the supported way to produce one
 * picture, so it is the button that looks like the errand.
 *
 * What the clipboard gets is only the prompt. The row around it may say «Bilde
 * 3», which slide it belongs on and what the file is called — a person needs
 * that to find their way — but none of it is in the copied text: a plan id, a
 * file name or «skal brukes på slide» tells an image generator it is working on
 * one of several, and says nothing about what to draw.
 *
 * The whole-plan brief is still generated (`composeImageBrief`) and still
 * reachable, one fold down and labelled for what it is: documentation and
 * debugging, never the generation action.
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
   * The same function the agent's image job calls, so the text a person pastes
   * into a fresh conversation and the text a host client is handed are one
   * text. Two composers here would be two orders for the same picture.
   */
  const prompts = useMemo(
    () =>
      new Map(
        images.map((image) => [
          image.id,
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
      description="Bildene dekket planlegger, med én ferdig prompt per bilde. Kopier prompten til ett bilde og lim den inn der bildet lages — helst i en ny, tom samtale. Dialogen vises aldri for publikum."
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
        Hvordan bildene skal se ut — ikke hva de viser. Slaids legger denne teksten inn som stil- og
        kvalitetsdelen av hver enkelt bildeprompt.
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

      <h3 className="inspector__heading">Bildene som skal lages</h3>
      {images.length === 0 ? (
        <p className="hint" data-testid="image-brief-modal-empty">
          Dekket har ingen planlagte bilder ennå. Lag en bildesone og legg bildet inn i bildeplanen,
          så står prompten klar her.
        </p>
      ) : (
        <>
          <p className="hint" data-testid="image-brief-modal-how">
            Hvert bilde har sin egen ferdige prompt: felles stil, motivet, komposisjonen, kravene og
            riktig aspect ratio, målt fra sonen bildet skal ligge i. Prompten står alene — lim den
            inn i en ny, tom ChatGPT-samtale, så lages akkurat det ene bildet der. Lagre filen med
            nummeret som står på raden.
          </p>
          <ol className="deposit-list" data-testid="image-brief-modal-list">
            {images.map((image) => {
              const prompt = prompts.get(image.id) ?? ''
              return (
                <li key={image.id} className="deposit-row">
                  <span className="deposit-row__mark" aria-hidden="true">
                    {image.number}
                  </span>
                  <span className="deposit-row__text">
                    <strong>
                      Bilde {image.number} · {image.aspectRatio} ({image.orientation})
                    </strong>
                    <span className="hint">{image.plan.subject}</span>
                    <span className="hint">På sliden «{image.slideLabel}»</span>
                    <span className="hint">Filnavn: {image.fileNameStem}.&lt;filendelse&gt;</span>
                    {image.filled && <span className="hint">Bildet ligger allerede i sonen</span>}
                  </span>
                  <button
                    type="button"
                    className="btn deposit-row__action"
                    data-testid={`image-brief-modal-copy-prompt-${image.number}`}
                    onClick={() => void copy(image.id, prompt)}
                  >
                    <Icon name="copy" size={15} />{' '}
                    {copied?.key === image.id && copied.ok ? 'Kopiert' : 'Kopier prompt'}
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      {ready && (
        <p className="hint" data-testid="image-brief-modal-next">
          Slik gjør du det: kopier prompten til ett bilde, lim den inn i en ny samtale der du lager
          bilder, og lagre bildet under filnavnet raden oppgir — <code>1</code>, <code>2</code>,{' '}
          <code>3</code> … med den filendelsen det får. Gjenta for hvert bilde, og trykk så «Bildene
          er klare».
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
         * the button would have copied.
         *
         * It used to point at the whole-plan brief under it — «åpne den samlede
         * briefen, merk teksten og kopier den selv» — which hands a person the
         * one message this dialog
         * exists to keep away from an image generator: every motif at once,
         * numbered and counted. A refused copy of one picture's prompt is
         * exactly when the clean single prompt matters most, so it is put right
         * here to select.
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

      {/*
        The whole plan as one text, one fold down and named for what it is. It
        counts the pictures, numbers them and shows every motif at once, which
        is exactly what one image generation must not see — so it is here for
        reading and debugging, not as the way to order pictures.
      */}
      <details className="image-brief__fold" data-testid="image-brief-modal-full">
        <summary className="hint">Samlet bildebrief — til dokumentasjon og feilsøking</summary>
        <p className="hint">
          Hele bildeplanen som én tekst, med bildeplan-id-er og filnavn. Den er nyttig når du vil se
          hva Slaids har bestilt, men den er ingen bildeprompt: den viser alle motivene samtidig, og
          en bildegenerator som ser et sett lager et sett. Bruk «Kopier prompt» på det enkelte bildet
          når et bilde skal lages.
        </p>
        {brief ? (
          <>
            <textarea
              className="editorial-text editorial-text--generated"
              data-testid="image-brief-modal-text"
              value={brief}
              readOnly
              spellCheck={false}
            />
            <button
              type="button"
              className="btn"
              data-testid="image-brief-modal-copy"
              onClick={() => void copy('brief', brief)}
            >
              <Icon name="copy" size={15} />{' '}
              {copied?.key === 'brief' && copied.ok ? 'Kopiert' : 'Kopier samlet brief'}
            </button>
          </>
        ) : (
          <button type="button" className="btn" data-testid="image-brief-modal-copy" disabled>
            <Icon name="copy" size={15} /> Kopier samlet brief
          </button>
        )}
      </details>

    </Modal>
  )
}
