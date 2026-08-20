/**
 * Upload dialog for images and vector graphics.
 *
 * SVG is kept as a vector asset and displayed through an `<img>` pointing at a
 * Blob URL, so no foreign markup is ever injected into the document.
 */

import { useRef, useState } from 'react'
import { newAssetId } from '../../domain/ids'
import { registerAsset, setZoneContent } from '../../domain/commands'
import { createContainer } from '../../domain/content'
import { repository } from '../../persistence/dexieRepository'
import { readImageSize } from '../../state/assets'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import type { AssetRef } from '../../domain/types'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'

const ACCEPTED = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,.svg'
const MAX_BYTES = 25 * 1024 * 1024

export function ImageUploadModal({
  open,
  onOpenChange,
  targetNodeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetNodeId: string | null
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const slideId = useEditorStore((state) => state.currentSlideId)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const editor = useActiveEditor((state) => state.editor)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

      if (editor && !targetNodeId) {
        editor.chain().focus().insertSlaidsImage({ assetId: ref.id, alt: file.name }).run()
      } else if (targetNodeId && slideId) {
        runStructural('place-asset', (current) =>
          setZoneContent(current, {
            slideId,
            nodeId: targetNodeId,
            content: createContainer({ type: 'asset', assetId: ref.id, fit: 'contain' }),
            replace: true,
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
      open={open}
      onOpenChange={onOpenChange}
      title="Sett inn bilde eller figur"
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
