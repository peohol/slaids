/**
 * The pieces every inspector is built from.
 *
 * A zone, a section, a miniapp and a generated page each get their own panel,
 * but they read alike: a heading that says what is selected, then named groups
 * of controls, then whatever is rare or long folded away. Building the four
 * from the same parts is what keeps them alike.
 */

import { create } from 'zustand'
import { useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { MenuAction } from '../components/contextMenu'
import { Icon, type IconName, type IconTone } from '../components/Icon'
import { pressedButton } from '../components/pressed'

/**
 * The panel itself: one landmark, named, whichever inspector fills it.
 *
 * The slide overview beside it is a complementary landmark too, and two of
 * those without names are the same entry twice in a screen reader's list of
 * places to go.
 */
export function InspectorPanel({ children }: { children: ReactNode }) {
  return (
    <aside className="inspector" data-testid="inspector" aria-label="Inspektør">
      {children}
    </aside>
  )
}

/**
 * What is selected: its icon, its name and one line about it.
 *
 * The edge is the selection blue, the same blue the stage draws the selected
 * zone in, so the panel and the slide visibly talk about the same thing.
 */
export function InspectorHeader({
  icon,
  tone,
  title,
  detail,
  children,
}: {
  icon: IconName
  tone?: IconTone
  title: string
  detail?: string
  children?: ReactNode
}) {
  return (
    <header className="inspector-head" data-testid="inspector-selection">
      <div className="inspector-head__title">
        <Icon name={icon} size={18} tone={tone} />
        <h2 className="inspector-head__name">{title}</h2>
      </div>
      {detail && <p className="inspector-head__detail">{detail}</p>}
      {children}
    </header>
  )
}

/** A named group of controls. */
export function InspectorSection({
  title,
  children,
  testId,
}: {
  title: string
  children: ReactNode
  testId?: string
}) {
  return (
    <section className="inspector__section" data-testid={testId}>
      <h2 className="inspector__heading">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Which folds are open. Kept for the session rather than per panel: the
 * inspector is rebuilt for every selection, and a fold that snapped shut each
 * time another zone was chosen would have to be reopened for each one.
 */
const useFolds = create<{ open: Record<string, boolean>; set: (id: string, open: boolean) => void }>(
  (set) => ({
    open: {},
    set: (id, open) => set((state) => ({ open: { ...state.open, [id]: open } })),
  }),
)

/**
 * Something rare or long, behind its name.
 *
 * A native `<details>`, so it opens from the keyboard, with a finger and for a
 * screen reader without anything here having to make it so.
 */
export function InspectorFold({
  id,
  summary,
  icon,
  children,
}: {
  id: string
  summary: string
  icon?: IconName
  children: ReactNode
}) {
  const open = useFolds((state) => state.open[id] ?? false)
  const setOpen = useFolds((state) => state.set)
  return (
    <details
      className="inspector-fold"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next !== open) setOpen(id, next)
      }}
      data-testid={`inspector-fold-${id}`}
    >
      <summary className="inspector-fold__summary">
        <Icon name="chevron-right" size={13} className="inspector-fold__chevron" />
        {icon && <Icon name={icon} size={14} />}
        <span>{summary}</span>
      </summary>
      <div className="inspector-fold__body">{children}</div>
    </details>
  )
}

/**
 * One action, with its icon, its name and — when it cannot be used — why,
 * written under the name rather than kept in a tooltip a finger cannot raise.
 */
export function InspectorButton({
  icon,
  tone,
  label,
  reason,
  disabled = false,
  danger = false,
  pressed,
  testId,
  onClick,
}: {
  icon?: IconName
  tone?: IconTone
  label: string
  reason?: string | null
  disabled?: boolean
  danger?: boolean
  /** The choice in force, for a button that is one of several choices. */
  pressed?: boolean
  testId?: string
  onClick: (control: HTMLElement) => void
}) {
  const base = `btn btn--sm inspector-button${danger ? ' inspector-button--danger' : ''}`
  return (
    <button
      type="button"
      {...(pressed === undefined ? { className: base } : pressedButton(base, pressed))}
      disabled={disabled}
      data-testid={testId}
      onClick={(event) => onClick(event.currentTarget)}
    >
      {icon && <Icon name={icon} size={14} tone={tone} />}
      <span className="inspector-button__text">
        <span>{label}</span>
        {disabled && reason && <span className="inspector-button__reason">{reason}</span>}
      </span>
    </button>
  )
}

/**
 * A context-menu entry as an inspector button: the same name, icon, refusal
 * and — for one that asks before it acts — the same question, so an action is
 * exactly as safe from the panel as from the menu.
 */
export function InspectorEntryButton({ entry, testId }: { entry: MenuAction; testId?: string }) {
  const [asking, setAsking] = useState(false)
  const { confirm } = entry
  return (
    <>
      <InspectorButton
        icon={entry.icon}
        tone={entry.tone}
        label={entry.label}
        reason={entry.reason}
        disabled={entry.disabled}
        danger={entry.danger}
        testId={testId}
        onClick={() => (confirm ? setAsking(true) : entry.onSelect())}
      />
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => {
            setAsking(false)
            entry.onSelect()
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
