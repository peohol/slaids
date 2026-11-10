/**
 * Upload dialog for images.
 *
 * SVG is kept as a vector asset and displayed through an `<img>` pointing at a
 * Blob URL, so no foreign markup is ever injected into the document.
 *
 * What may be stored is not decided here. `state/assetUpload.ts` is the door,
 * and behind it stands `domain/assetIngress.ts` — the same policy
 * `upload_asset` and `create_svg_asset` stand behind, so a figure a user picks
 * meets exactly the rules a figure an agent sends meets, and the bytes that
 * land in the store are the sanitised ones either way. This file translates the
 * verdict into a toast and, when it passes, puts the picture where the user
 * pointed.
 *
 * Where the picture lands is asked, not inferred. It used to depend on which
 * mode the editor happened to be in, so the same click either put the image in
 * the text field or replaced the whole zone with it — and "insert a picture
 * next to my text" quietly did the wrong one.
 *
 * The one case that is not a question is `fillZone`: the dialog was opened by
 * pressing an empty picture panel, so the user has already pointed at where the
 * picture goes. Asking again there let a text field that happened to have the
 * caret a moment earlier win, and the file went into the text instead of into
 * the picture the user was pointing at.
 *
 * The other case is not a question either, for the opposite reason: a title, a
 * cover line and a caption are one line of text, and their schema has no
 * picture node in it. Having the caret in one of those is not an inline target,
 * and offering it was a crash waiting for somebody to stand in a caption and
 * press the button — the file was stored, and *then* the insert failed on a
 * command that field's editor does not have. `acceptsInlineImage` asks the
 * editor rather than listing the kinds of field, so the answer stays right on
 * its own.
 */

import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { registerAsset, setImageAsset, setZoneContent } from '../../domain/commands'
import { IMAGE_FILE_ACCEPT } from '../../domain/imageBytes'
import { describeError } from '../../domain/result'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { createImage, imagePanelOf } from '../../domain/content'
import { findLeaf } from '../../domain/layout'
import { describeSanitizing, storeUploadedFile } from '../../state/assetUpload'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { acceptsInlineImage, fittingImageWidthPercent } from './SlaidsImageExtension'

type Placement = 'inline' | 'zone'

export function ImageUploadModal({
  onOpenChange,
  zoneNodeId,
  fillZone = false,
}: {
  onOpenChange: (open: boolean) => void
  /** The selected leaf zone, when there is one — the target for 'zone'. */
  zoneNodeId: string | null
  /** Opened by pressing a picture panel: the target is settled, so do not ask. */
  fillZone?: boolean
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

  /*
   * The field the caret was in, and — when there was one that cannot hold a
   * picture — the fact that it was refused rather than absent. Both are read on
   * mount, because the dialog takes the focus the moment it opens and the
   * parent only renders it while it is open. Zone mode has no field being
   * edited at all, so there is nowhere inline to go.
   */
  const [inline] = useState<{ target: Editor | null; refused: boolean }>(() => {
    if (fillZone || !activeField || !editor) return { target: null, refused: false }
    if (acceptsInlineImage(editor)) return { target: editor, refused: false }
    return { target: null, refused: true }
  })
  const target = inline.target
  const canInline = Boolean(target)
  const canFillZone = Boolean(zoneNodeId && slideId)
  const [placement, setPlacement] = useState<Placement>(canInline ? 'inline' : 'zone')
  const effective: Placement = placement === 'inline' && !canInline ? 'zone' : placement

  const handleFile = async (file: File): Promise<void> => {
    if (!presentation) return

    setBusy(true)
    try {
      /*
       * Nothing is written before this returns. A file that is refused — unsafe
       * SVG, invalid SVG, a format Slaids does not store, one that is too big —
       * leaves no blob behind, no `AssetRef` in the document and no half-placed
       * picture in a zone, because the rejection happens before the first write
       * rather than being undone after it.
       */
      const stored = await storeUploadedFile(presentation, file)
      if (!stored.ok) {
        notify.error(describeError(stored.error))
        return
      }
      const { ref } = stored.value
      const dropped = describeSanitizing(stored.value.report)
      if (dropped) notify.warning(dropped)
      if (stored.value.reused) {
        notify.info('Presentasjonen hadde allerede denne filen, så den ble brukt igjen.')
      }
      run('asset-register', (current) => registerAsset(current, ref))

      if (effective === 'inline' && target) {
        const aspect = ref.width > 0 && ref.height > 0 ? ref.width / ref.height : undefined
        // Sized to the room that is actually left in the field, so the zone
        // keeps its type size when there is room for the picture at all.
        const widthPercent = fittingImageWidthPercent(target, aspect ?? 16 / 9)
        target
          .chain()
          .focus()
          .insertSlaidsImage({ assetId: ref.id, alt: file.name, aspect, widthPercent })
          .run()
      } else if (zoneNodeId && slideId) {
        /*
         * A zone that is already a picture only changes file — its crop, its
         * caption and, for a titled image card, its header all stay. Replacing
         * the whole content would throw those away for what the user read as
         * "pick a different photo".
         */
        const slide = useEditorStore.getState().currentContentSlide()
        const existing =
          slide?.id === slideId ? (findLeaf(slide.root, zoneNodeId)?.content ?? null) : null
        if (existing && imagePanelOf(existing)) {
          run('image-asset', (current) =>
            setImageAsset(current, {
              slideId,
              nodeId: zoneNodeId,
              assetId: ref.id,
              ...HUMAN_EDIT,
            }),
          )
        } else {
          runStructural('place-asset', (current) =>
            setZoneContent(current, {
              slideId,
              nodeId: zoneNodeId,
              content: createImage(ref.id),
              replace: true,
              ...HUMAN_EDIT,
            }),
          )
        }
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
        accept={IMAGE_FILE_ACCEPT}
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
          title={
            inline.refused
              ? 'Feltet du står i er én linje tekst og kan ikke inneholde bilder.'
              : undefined
          }
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
          : 'Bildet fyller hele sonen, helt ut til kantene, og beskjæres om formatet ikke passer. Dra i bildet etterpå for å velge utsnitt.'}
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
