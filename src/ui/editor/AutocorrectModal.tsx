/**
 * The user's autoerstatt rules, edited as one list and saved with «Lagre».
 *
 * The same dialog as mdeditz's: what is typed on the left becomes what is on
 * the right. Spaces count in a rule — ` - ` is not `-` — but are invisible in a
 * field, so they are shown as «␣» while editing and turned back into spaces
 * when the list is read out. The list is repaired by
 * `normalizeAutocorrectRules` on the way to the store, so an empty row or a
 * duplicate is simply dropped rather than refused.
 *
 * The rules are put in order the way slides are: by their grip, with the same
 * dnd-kit sort and the same sensor as the filmstrip — or from the keyboard,
 * with the grip focused, space to lift and the arrows to move. The order is
 * saved as it stands.
 */

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  MAX_AUTOCORRECT_RULES,
  MAX_AUTOCORRECT_RULE_LENGTH,
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
import { useSurfacePointerSensor } from './dragActivation'

const VISIBLE_SPACE = '␣'
const showSpaces = (text: string): string => text.replace(/[ \u00A0]/g, VISIBLE_SPACE)
const readSpaces = (text: string): string => text.replaceAll(VISIBLE_SPACE, ' ')

interface Row extends AutocorrectRule {
  /** The row's name for React and for the sort; a string, since dnd-kit reads 0 as no id. */
  key: string
}

let nextKey = 0
const toRows = (rules: readonly AutocorrectRule[]): Row[] =>
  rules.map((rule) => ({ key: `rule-${nextKey++}`, from: showSpaces(rule.from), to: showSpaces(rule.to) }))

/** A rule only moves up and down: the list is one column. */
const alongTheList: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const LIFT_INSTRUCTIONS =
  'Trykk mellomrom for å løfte regelen, flytt den med pil opp og ned, og trykk mellomrom igjen for å slippe den. Escape legger den tilbake.'

/** What a screen reader hears while a rule is moved, by its place in the list. */
function announcements(place: (id: UniqueIdentifier) => number): Announcements {
  return {
    onDragStart: ({ active }) => `Regel ${place(active.id)} er løftet.`,
    onDragOver: ({ over }) => (over ? `Over plass ${place(over.id)}.` : undefined),
    onDragEnd: ({ over }) => (over ? `Regelen er sluppet på plass ${place(over.id)}.` : 'Regelen er sluppet.'),
    onDragCancel: () => 'Flyttingen er avbrutt. Regelen er på samme plass.',
  }
}

/** One rule in the list: a grip to move it by, and whatever the row holds. */
function SortableRule({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? 'autocorrect-rule autocorrect-rule--dragging' : 'autocorrect-rule'}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-testid="autocorrect-rule"
    >
      <span
        ref={setActivatorNodeRef}
        className="autocorrect-rule__grip"
        aria-label="Flytt regelen"
        data-drag-activation="immediate"
        data-testid="autocorrect-grip"
        {...attributes}
        {...listeners}
      >
        <Icon name="grip" size={14} />
      </span>
      {children}
    </li>
  )
}

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
  const [added, setAdded] = useState<string | null>(null)
  /** Whether a rule is in the air: Escape then puts it back instead of closing. */
  const [moving, setMoving] = useState(false)
  const loaded = useAutocorrect((state) => state.loaded)
  const sensors = useSensors(
    useSurfacePointerSensor(),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  /*
   * The same array for as long as the rows are: a fresh one on every render
   * would tell the sort the list had changed, and it would then skip the
   * animation of every rule stepping aside — see the filmstrip.
   */
  const ids = useMemo(() => rows.map((row) => row.key), [rows])

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

  const edit = (key: string, side: 'from' | 'to') => (event: ChangeEvent<HTMLInputElement>) => {
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

  const drop = ({ active, over }: DragEndEvent): void => {
    setMoving(false)
    if (!over || active.id === over.id) return
    setRows((current) => {
      const from = current.findIndex((row) => row.key === active.id)
      const to = current.findIndex((row) => row.key === over.id)
      return from < 0 || to < 0 ? current : arrayMove(current, from, to)
    })
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
      holdEscape={moving}
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[alongTheList]}
        accessibility={{
          screenReaderInstructions: { draggable: LIFT_INSTRUCTIONS },
          announcements: announcements((id) => ids.indexOf(String(id)) + 1),
        }}
        onDragStart={() => setMoving(true)}
        onDragEnd={drop}
        onDragCancel={() => setMoving(false)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="autocorrect-rules">
            {rows.map((row) => (
              <SortableRule key={row.key} id={row.key}>
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
              </SortableRule>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
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
      </div>
    </Modal>
  )
}
