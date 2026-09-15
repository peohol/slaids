/**
 * The deck's image brief, opened.
 *
 * One piece of text for the whole presentation: how its pictures should look,
 * not what any of them shows. It is meant to be copied once into the start of a
 * chat and left standing while the individual prompts follow, which is why the
 * copy button is as prominent as the field — see `Presentation.imageBrief`.
 */

import { MAX_IMAGE_BRIEF_CHARS } from '../../domain/constants'
import { setImageBrief } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import { EditorialTextModal } from './EditorialTextModal'

const PLACEHOLDER =
  'Beskriv det visuelle uttrykket som skal være felles for alle bildene i dekket: fotografisk eller illustrert, realismegrad, lyssetting, fargeholdning, komposisjonsprinsipper og hva som konsekvent skal unngås. Ikke beskriv motivene — de står i hvert enkelt bildenotat.'

export function ImageBriefModal({ onClose }: { onClose: () => void }) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  if (!presentation) return null

  return (
    <EditorialTextModal
      onClose={onClose}
      title="Bildebrief"
      description="Felles visuell premiss for bildene i dekket. Lim den inn først i ChatGPT-samtalen, og kopier deretter én bildeprompt om gangen. Briefen vises aldri for publikum."
      value={presentation.imageBrief ?? ''}
      onChange={(brief) => run('typing:image-brief', (current) => setImageBrief(current, brief))}
      maxChars={MAX_IMAGE_BRIEF_CHARS}
      placeholder={PLACEHOLDER}
      testId="image-brief-modal"
    />
  )
}
