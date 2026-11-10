/**
 * The user's autoerstatt rules, edited as one list and saved with «Lagre».
 *
 * The same dialog as mdeditz's: what is typed on the left becomes what is on
 * the right. Spaces count in a rule — ` - ` is not `-` — but are invisible in a
 * field, so they are shown as «␣» while editing and turned back into spaces
 * when the list is read out. The list is repaired by
 * `normalizeAutocorrectRules` on the way to the store, so an empty row or a
 * duplicate is simply dropped rather than refused.
 */

import { useEffect, useState, type ChangeEvent } from 'react'
import {
  MAX_AUTOCORRECT_RULES,
  MAX_AUTOCORRECT_RULE_LENGTH,
  defaultAutocorrectRules,
  type AutocorrectRule,
} from '../../domain/autocorrect'
import {
  currentAutocorrectRules,
  loadAutocorrect,
  saveAutocorrect,
  useAutocorrect,
} from '../../state/autocorrect'
import { notify } from '../../state/toast'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

const VISIBLE_SPACE = '␣'
const showSpaces = (text: string): string => text.replace(/[ \u00A0]/g, VISIBLE_SPACE)
const readSpaces = (text: string): string => text.replaceAll(VISIBLE_SPACE, ' ')

interface Row extends AutocorrectRule {
  key: number
}

let nextKey = 0
const toRows = (rules: readonly AutocorrectRule[]): Row[] =>
  rules.map((rule) => ({ key: nextKey++, from: showSpaces(rule.from), to: showSpaces(rule.to) }))

export function AutocorrectModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [opened, setOpened] = useState(false)
  /** Whether `rows` holds the stored list yet; nothing can be saved before it does. */
  const [seeded, setSeeded] = useState(false)
  /** The row «Ny regel» just added, whose first field takes the focus. */
  const [added, setAdded] = useState<number | null>(null)
  const loaded = useAutocorrect((state) => state.loaded)

  // A fresh copy of the stored list every time the dialog opens, so «Avbryt»
  // and closing both leave what is stored as it was. Never a copy of a list
  // that has not arrived: saving that would replace the stored rules with it.
  if (open !== opened) {
    setOpened(open)
    setSeeded(false)
    setRows([])
  } else if (open && loaded && !seeded) {
    setSeeded(true)
    setRows(toRows(currentAutocorrectRules()))
  }

  // A load that failed when the workspace opened is tried again here.
  useEffect(() => {
    if (open && !loaded) void loadAutocorrect()
  }, [open, loaded])

  const edit = (key: number, side: 'from' | 'to') => (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const caret = input.selectionStart
    const value = showSpaces(input.value)
    // A space shows as ␣ the moment it is typed; same length, so the caret stays.
    if (value !== input.value) {
      input.value = value
      if (caret !== null) input.setSelectionRange(caret, caret)
    }
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [side]: value } : row)))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const changed = await saveAutocorrect(
        rows.map((row) => ({ from: readSpaces(row.from), to: readSpaces(row.to) })),
      )
      notify.success(changed ? 'Autoerstatt-reglene er lagret' : 'Ingen endringer')
      onOpenChange(false)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke lagre autoerstatt-reglene')
    } finally {
      setSaving(false)
    }
  }

  const field = (row: Row, side: 'from' | 'to', label: string) => (
    <input
      className="input"
      value={row[side]}
      maxLength={MAX_AUTOCORRECT_RULE_LENGTH}
      aria-label={label}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      autoFocus={side === 'from' && row.key === added}
      data-testid={`autocorrect-${side}`}
      onChange={edit(row.key, side)}
    />
  )

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Autoerstatt"
      description={`Det du skriver til venstre byttes ut med det til høyre, i alle presentasjonene dine. ${VISIBLE_SPACE} er et mellomrom.`}
      testId="autocorrect-modal"
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || !seeded}
            onClick={() => void save()}
            data-testid="autocorrect-save"
          >
            Lagre
          </button>
        </>
      }
    >
      {!seeded && <p className="hint">Henter reglene dine …</p>}
      <ul className="autocorrect-rules">
        {rows.map((row) => (
          <li className="autocorrect-rule" key={row.key} data-testid="autocorrect-rule">
            {field(row, 'from', 'Når du skriver')}
            <span className="autocorrect-rule__arrow" aria-hidden="true">
              →
            </span>
            {field(row, 'to', 'Blir det')}
            <button
              type="button"
              className="btn btn--sm btn--icon btn--ghost"
              aria-label="Fjern regelen"
              data-testid="autocorrect-remove"
              onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="autocorrect-tools">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!seeded || rows.length >= MAX_AUTOCORRECT_RULES}
          data-testid="autocorrect-add"
          onClick={() => {
            const [row] = toRows([{ from: '', to: '' }])
            setAdded(row.key)
            setRows((current) => [...current, row])
          }}
        >
          <Icon name="plus" size={14} /> Ny regel
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-testid="autocorrect-defaults"
          disabled={!seeded}
          onClick={() => setRows(toRows(defaultAutocorrectRules()))}
        >
          <Icon name="reset" size={14} /> Standardregler
        </button>
      </div>
    </Modal>
  )
}
