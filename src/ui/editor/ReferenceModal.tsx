/**
 * Reference manager.
 *
 * References are stable ids; the numbers the reader sees are derived. Deleting
 * a live reference removes every citation that points at it, so it is confirmed.
 */

import { useState } from 'react'
import {
  addReference,
  deleteReference,
  deleteUnusedReferences,
  updateReference,
} from '../../domain/commands'
import { computeReferenceNumbering, formatReference, splitReferences } from '../../domain/references'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import type { Reference } from '../../domain/types'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { notify } from '../../state/toast'

const EMPTY: Omit<Reference, 'id'> = { title: '', authors: '', url: '', year: '' }

export function ReferenceModal({
  open,
  onOpenChange,
  focusReferenceId = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opened from a single citation: bring that reference into view. */
  focusReferenceId?: string | null
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const run = useEditorStore((state) => state.run)
  const editor = useActiveEditor((state) => state.editor)
  const [draft, setDraft] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Reference | null>(null)
  const [clearingUnused, setClearingUnused] = useState(false)

  if (!presentation) return null

  const numbering = computeReferenceNumbering(presentation)
  const { used, unused } = splitReferences(presentation)
  const canSubmit = Boolean(draft.title.trim() || draft.authors.trim() || draft.url.trim())

  const insert = (reference: Reference): void => {
    if (!editor) {
      notify.warning('Klikk i et tekstfelt først, så settes referansen inn der.')
      return
    }
    editor.chain().focus().insertCitation([reference.id]).run()
    // A separate call, so the merge sees the document the insert produced.
    editor.commands.mergeCitations()
  }

  const submit = (): void => {
    if (!canSubmit) return
    if (editing) {
      run('reference-update', (current) => updateReference(current, editing, draft))
      setEditing(null)
      setDraft(EMPTY)
      return
    }
    const current = useEditorStore.getState().presentation
    if (!current) return
    const result = addReference(current, draft)
    if (!result.ok) {
      notify.error(result.error.message)
      return
    }
    run('reference-add', () => ({ ok: true, value: result.value.presentation }))
    setDraft(EMPTY)
    insert(result.value.reference)
  }

  const renderRow = (reference: Reference, isUsed: boolean) => (
    <li
      key={reference.id}
      className={
        reference.id === focusReferenceId ? 'reference-row reference-row--focused' : 'reference-row'
      }
      data-testid="reference-row"
      data-focused={reference.id === focusReferenceId ? '' : undefined}
      ref={
        reference.id === focusReferenceId
          ? (element) => element?.scrollIntoView({ block: 'nearest' })
          : undefined
      }
    >
      {isUsed && <span className="reference-row__number">{numbering.get(reference.id)}</span>}
      <span className="reference-row__text">{formatReference(reference) || '(tom referanse)'}</span>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => insert(reference)}
        data-testid="insert-citation"
      >
        Sett inn
      </button>
      <button
        type="button"
        className="btn btn--sm btn--icon"
        aria-label="Rediger referanse"
        onClick={() => {
          setEditing(reference.id)
          setDraft({
            title: reference.title,
            authors: reference.authors,
            url: reference.url,
            year: reference.year,
          })
        }}
      >
        <Icon name="edit" size={14} />
      </button>
      <button
        type="button"
        className="btn btn--sm btn--icon"
        aria-label="Slett referanse"
        data-testid="delete-reference"
        onClick={() => setDeleting(reference)}
      >
        <Icon name="close" size={14} />
      </button>
    </li>
  )

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Referanser"
        description="Nummereringen følger rekkefølgen referansene først brukes i."
        testId="reference-modal"
        width={720}
        footer={
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Lukk
          </button>
        }
      >
        <div className="reference-form">
          <div className="field">
            <label htmlFor="reference-title">Tittel</label>
            <input
              id="reference-title"
              className="input"
              value={draft.title}
              data-testid="reference-title"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="reference-authors">Forfatter(e)</label>
            <input
              id="reference-authors"
              className="input"
              value={draft.authors}
              onChange={(event) => setDraft({ ...draft, authors: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="reference-url">Hyperkobling</label>
            <input
              id="reference-url"
              className="input"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="reference-year">År</label>
            <input
              id="reference-year"
              className="input"
              value={draft.year}
              onChange={(event) => setDraft({ ...draft, year: event.target.value })}
            />
          </div>
          <div className="reference-form__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canSubmit}
              onClick={submit}
              data-testid="save-reference"
            >
              {editing ? 'Lagre endringer' : 'Legg til og sett inn'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEditing(null)
                  setDraft(EMPTY)
                }}
              >
                Avbryt
              </button>
            )}
            <span className="hint">Minst tittel, forfatter eller lenke må fylles ut.</span>
          </div>
        </div>

        <div>
          <h3 className="reference-heading">I bruk ({used.length})</h3>
          {used.length === 0 ? (
            <p className="hint">Ingen referanser er brukt ennå.</p>
          ) : (
            <ul className="reference-list">{used.map((reference) => renderRow(reference, true))}</ul>
          )}
        </div>

        <div>
          <div className="reference-heading-row">
            <h3 className="reference-heading">Ubrukte ({unused.length})</h3>
            {unused.length > 0 && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setClearingUnused(true)}
                data-testid="clear-unused-references"
              >
                <Icon name="trash" size={14} /> Slett alle ubrukte
              </button>
            )}
          </div>
          {unused.length === 0 ? (
            <p className="hint">Ingen ubrukte referanser.</p>
          ) : (
            <ul className="reference-list">{unused.map((reference) => renderRow(reference, false))}</ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Slette referansen?"
        message={
          deleting && numbering.has(deleting.id)
            ? 'Referansen er i bruk. Alle henvisninger til den fjernes fra teksten.'
            : 'Referansen slettes fra listen.'
        }
        onConfirm={() => {
          if (!deleting) return
          run('reference-delete', (current) => deleteReference(current, deleting.id))
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={clearingUnused}
        title="Slette alle ubrukte referanser?"
        message={`${unused.length} referanse(r) som ikke er i bruk slettes.`}
        onConfirm={() => {
          run('reference-clear-unused', (current) => deleteUnusedReferences(current))
          setClearingUnused(false)
        }}
        onCancel={() => setClearingUnused(false)}
      />
    </>
  )
}
