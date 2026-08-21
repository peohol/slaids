/**
 * Upload dialog for images.
 *
 * SVG is kept as a vector asset and displayed through an `<img>` pointing at a
 * Blob URL, so no foreign markup is ever injected into the document.
 *
 * Where the picture lands is asked, not inferred. It used to depend on which
 * mode the editor happened to be in, so the same click either put the image in
 * the text field or replaced the whole zone with it — and "insert a picture
 * next to my text" quietly did the wrong one.
 */

import { useRef, useState } from 'react'
import { newAssetId } from '../../domain/ids'
import { registerAsset, setZoneContent } from '../../domain/commands'
import { domFitCheckers } from '../../state/measure'
import { createContainer } from '../../domain/content'
import { repository } from '../../persistence/dexieRepository'
import { readImageSize } from '../../state/assets'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import type { AssetRef } from '../../domain/types'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { fittingImageWidthPercent } from './SlaidsImageExtension'

const ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,.svg'
const MAX_BYTES = 25 * 1024 * 1024

type Placement = 'inline' | 'zone'

export function ImageUploadModal({
  onOpenChange,
  zoneNodeId,
}: {
  onOpenChange: (open: boolean) => void
  /** The selected leaf zone, when there is one — the target for 'zone'. */
  zoneNodeId: string | null
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const slideId = useEditorStore((state) => state.currentSlideId)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const editor = useActiveEditor((state) => state.editor)
  const activeField = useEditorStore((state) => state.activeField)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // The dialog takes focus the moment it opens, so the field that had it is
  // captured on mount — the parent only renders this while it is open. Zone
  // mode has no field being edited, so there is nowhere inline to go.
  const [target] = useState(() => (activeField ? editor : null))
  const canInline = Boolean(target)
  const canFillZone = Boolean(zoneNodeId && slideId)
  const [placement, setPlacement] = useState<Placement>(canInline ? 'inline' : 'zone')
  const effective: Placement = placement === 'inline' && !canInline ? 'zone' : placement

  const handleFile = async (file: File): Promise<void> => {
    if (!presentation) return
    if (file.size > MAX_BYTES) {
      notify.error('Filen er for stor (maks 25 MB).')
      return
    }
    const isVector = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')
    if (!file.type.startsWith('image/') && !isVector) {
      notify.error('Filtypen støttes ikke. Bruk vanlige bildeformater eller SVG.')
      return
    }

    setBusy(true)
    try {
      const size = await readImageSize(file)
      const ref: AssetRef = {
        id: newAssetId(),
        name: file.name,
        mimeType: isVector ? 'image/svg+xml' : file.type,
        byteSize: file.size,
        width: size.width,
        height: size.height,
        isVector,
      }
      await repository.putAsset(presentation.id, ref, file)
      run('asset-register', (current) => registerAsset(current, ref))

      if (effective === 'inline' && target) {
        const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : undefined
        // Sized to the room that is actually left in the field, so the picture
        // arrives next to the text instead of being rolled back for overflow.
        const widthPercent = fittingImageWidthPercent(target, aspect ?? 16 / 9)
        if (widthPercent === null) {
          notify.warning('Feltet har ikke plass til et bilde. Gjør sonen større eller kort ned teksten.')
          onOpenChange(false)
          return
        }
        target
          .chain()
          .focus()
          .insertSlaidsImage({ assetId: ref.id, alt: file.name, aspect, widthPercent })
          .run()
      } else if (zoneNodeId && slideId) {
        runStructural('place-asset', (current) =>
          setZoneContent(current, {
            slideId,
            nodeId: zoneNodeId,
            content: createContainer({ type: 'asset', assetId: ref.id, fit: 'contain' }),
            replace: true,
            ...domFitCheckers,
          }),
        )
      } else {
        notify.warning('Velg en sone eller et tekstfelt først.')
      }
      onOpenChange(false)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Opplastingen feilet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="Sett inn bilde"
      description="Rasterbilder og SVG lagres som filer i presentasjonen."
      testId="image-modal"
      width={520}
      footer={
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>
          Avbryt
        </button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        style={{ display: 'none' }}
        data-testid="image-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleFile(file)
        }}
      />
      <div className="placement-choice" data-testid="image-placement">
        <span className="hint">Plassering:</span>
        <button
          type="button"
          className={effective === 'inline' ? 'btn btn--sm btn--active' : 'btn btn--sm'}
          disabled={!canInline}
          onClick={() => setPlacement('inline')}
          data-testid="image-placement-inline"
          aria-pressed={effective === 'inline'}
        >
          I tekstfeltet
        </button>
        <button
          type="button"
          className={effective === 'zone' ? 'btn btn--sm btn--active' : 'btn btn--sm'}
          disabled={!canFillZone}
          onClick={() => setPlacement('zone')}
          data-testid="image-placement-zone"
          aria-pressed={effective === 'zone'}
        >
          Fyll sonen
        </button>
      </div>
      <p className="hint">
        {effective === 'inline'
          ? 'Bildet settes inn der markøren står, sammen med teksten.'
          : 'Bildet fyller hele sonen. Innhold som ligger der fra før flyttes til sandkassen.'}
      </p>

      <div
        className={dragOver ? 'dropzone dropzone--over' : 'dropzone'}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void handleFile(file)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
        }}
      >
        <Icon name="image" size={28} />
        <p>{busy ? 'Laster opp …' : 'Dra en fil hit, eller klikk for å velge'}</p>
        <span className="hint">PNG, JPG, GIF, WEBP, AVIF eller SVG</span>
      </div>
    </Modal>
  )
}
