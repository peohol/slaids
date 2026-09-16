/**
 * The deck's pictures, in the one place the author deals with them.
 *
 * Two halves, and the split is the whole point of the dialog. The top is the
 * only text a person writes: the visual context every picture in the deck
 * shares — how they should look, never what any one of them shows. The bottom
 * is the brief itself, and it is *generated* (`composeImageBrief`): the count,
 * the numbering, each picture's aspect ratio and the rules that keep an image
 * generator from merging them are derived from the plan and the zones, so there
 * is nothing here to keep in step by hand.
 *
 * The copy button copies the generated brief, not the field above it. That is
 * the errand the dialog exists for — one message, pasted once, that produces
 * every picture in the deck — and a copy button next to an editable field that
 * copied something else would be a trap, so the field has no copy button of its
 * own and the generated text is shown in full rather than summarised.
 *
 * What is wrong with the plan is listed under it rather than hidden behind a
 * validation step: a brief whose pictures no longer match the zones is exactly
 * the brief somebody is about to paste.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_IMAGE_CONTEXT_CHARS } from '../../domain/constants'
import { setImageContext, syncImagePlaceholders } from '../../domain/commands'
import { checkImagePlan, composeImageBrief, resolveImagePlan } from '../../domain/imagePlan'
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../components/clipboard'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useEditorStore } from '../../state/store'

const PLACEHOLDER =
  'Beskriv det visuelle uttrykket som skal være felles for alle bildene i dekket: fotografisk eller illustrert, realismegrad, lyssetting, fargeholdning, komposisjonsprinsipper og hva som konsekvent skal unngås. Ikke beskriv motivene — de hører hjemme i bildeplanen, ett motiv per bildesone.'

export function ImageBriefModal({ onClose }: { onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
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

  if (!presentation) return null
  const context = presentation.imageContext ?? ''

  const copy = async (): Promise<void> => {
    if (!brief) return
    const ok = await copyToClipboard(brief)
    setCopied(ok)
    setCopyFailed(!ok)
    if (!ok) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Bildebrief"
      description="Én samlet bestilling for alle bildene i dekket. Lim den inn der bildene lages, og sett filene inn i sonene etterpå. Den vises aldri for publikum."
      testId="image-brief-modal"
      width={720}
      footer={
        <>
          <span className="hint" data-testid="image-brief-modal-count">
            {images.length === 0
              ? 'Ingen bilder planlagt'
              : `${images.length} ${images.length === 1 ? 'bilde' : 'bilder'} planlagt`}
          </span>
          <button
            type="button"
            className="btn"
            data-testid="image-brief-modal-copy"
            disabled={!brief}
            onClick={() => void copy()}
          >
            <Icon name="copy" size={15} /> {copied ? 'Kopiert' : 'Kopier briefen'}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Lukk
          </button>
        </>
      }
    >
      <h3 className="inspector__heading">Felles bildekontekst</h3>
      <p className="hint">
        Hvordan bildene skal se ut — ikke hva de viser. Denne teksten blir seksjonen «FELLES
        BILDEKONTEKST» øverst i briefen.
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

      <h3 className="inspector__heading">Samlet bildebrief</h3>
      {brief ? (
        <>
          <p className="hint">
            Generert av Slaids: antall, nummerering og formatet på hvert bilde er målt fra sonene
            bildene skal ligge i.
          </p>
          <textarea
            className="editorial-text editorial-text--generated"
            data-testid="image-brief-modal-text"
            value={brief}
            readOnly
            spellCheck={false}
          />
        </>
      ) : (
        <p className="hint" data-testid="image-brief-modal-empty">
          Dekket har ingen planlagte bilder ennå. Lag en bildesone og legg bildet inn i bildeplanen,
          så genereres briefen her.
        </p>
      )}

      {issues.length > 0 && (
        <ul className="hint" data-testid="image-brief-modal-issues">
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${index}`}>{issue.message}</li>
          ))}
        </ul>
      )}

      {copyFailed && (
        // The browser said no. Rather than claiming success, the text is still
        // right there to select by hand — which is what the field already is.
        <p className="hint" data-testid="image-brief-modal-copy-failed">
          Nettleseren tillot ikke kopiering. Merk teksten i feltet og kopier den selv.
        </p>
      )}
    </Modal>
  )
}
