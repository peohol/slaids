/**
 * Agent tokens, from the owner's side.
 *
 * This is the other half of the agent API: without it, the only way to give an
 * agent access would be to write SQL by hand, and the only way to take it away
 * would be to write more.
 *
 * Two rules shape the whole screen:
 *
 *  - **the secret is shown once.** It is generated here, in this browser, and
 *    only its hash is sent anywhere. There is no "show token again", because
 *    there is nothing to show — that is the point of storing a hash, and saying
 *    so plainly is better than letting somebody discover it later.
 *  - **scopes are a choice, not a default.** `sharing:write` is deliberately not
 *    pre-selected: an agent that builds slides does not need the right to hand
 *    them to the internet, and the moment to decide that is now rather than
 *    after a deck has been published by accident.
 *
 * The checkboxes are a convenience, not a control: enforcement happens
 * server-side on every request, from the same `operation.scopes` the API's
 * catalogue publishes. Nothing here is trusted by anything.
 *
 * The library mounts this only while it is open, which is what takes the secret
 * off the screen and out of memory when the dialog closes — rather than an
 * effect that tries to remember to clear it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AGENT_SCOPES, type AgentScope } from '../../agent/types'
import {
  SupabaseAgentTokens,
  isAgentTokenActive,
  type AgentTokenRecord,
} from '../../persistence/agentTokens'
import { AGENT_API_BASE_PATH } from '../../routing'
import { notify } from '../../state/toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

/** What each scope lets an agent do, in the owner's words rather than the API's. */
const SCOPE_LABELS: Record<AgentScope, string> = {
  'presentations:read': 'Lese presentasjoner, inspisere slides og validere',
  'presentations:write': 'Lage og endre presentasjoner, slides, soner og referanser',
  'assets:write': 'Laste opp bilder og lage SVG-figurer',
  'sharing:write': 'Publisere en presentasjon på en delingslenke',
}

/** The scopes a new token starts with. Publishing is never one of them. */
const DEFAULT_SCOPES: AgentScope[] = ['presentations:read', 'presentations:write', 'assets:write']

const EXPIRY_CHOICES = [
  { id: 'never', label: 'Utløper ikke', days: null },
  { id: '30', label: 'Om 30 dager', days: 30 },
  { id: '90', label: 'Om 90 dager', days: 90 },
  { id: '365', label: 'Om ett år', days: 365 },
] as const

type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]['id']

function expiryFor(choice: ExpiryChoice, now: Date): string | null {
  const days = EXPIRY_CHOICES.find((entry) => entry.id === choice)?.days ?? null
  if (days === null) return null
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

function formatMoment(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Live, revoked or expired — the three states a row can be in. */
function statusOf(record: AgentTokenRecord, now: Date): { label: string; tone: string } {
  if (record.revokedAt) return { label: 'Trukket tilbake', tone: 'revoked' }
  if (!isAgentTokenActive(record, now)) return { label: 'Utløpt', tone: 'expired' }
  return { label: 'Aktivt', tone: 'active' }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied or unavailable; the field below is still selectable by hand.
  }
  return false
}

export interface AgentTokensModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Injected in tests; the app uses the browser's own Supabase client. */
  tokens?: SupabaseAgentTokens
}

export function AgentTokensModal({ open, onOpenChange, tokens }: AgentTokensModalProps) {
  const store = useMemo(() => tokens ?? new SupabaseAgentTokens(), [tokens])

  const [records, setRecords] = useState<AgentTokenRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<AgentScope[]>(DEFAULT_SCOPES)
  const [expiry, setExpiry] = useState<ExpiryChoice>('never')

  /** The one moment the secret exists outside the agent that will use it. */
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<AgentTokenRecord | null>(null)
  const [deleting, setDeleting] = useState<AgentTokenRecord | null>(null)

  // Bumped by anything that changes the list, which is what re-runs the read
  // below. `records === null` is "not read yet", so loading is derived rather
  // than a second flag that can disagree with it.
  const [reloadToken, setReloadToken] = useState(0)
  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  const now = new Date()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    store.list().then(
      (list) => {
        if (cancelled) return
        setRecords(list)
        setError(null)
      },
      (failure: unknown) => {
        if (cancelled) return
        setRecords([])
        setError(failure instanceof Error ? failure.message : 'Kunne ikke hente agenttokens.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, store, reloadToken])

  const create = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await store.create({ name, scopes, expiresAt: expiryFor(expiry, new Date()) })
      setCreated({ token: result.token, name: result.record.name })
      setCopied(false)
      setName('')
      refresh()
    } catch (failure) {
      notify.error(failure instanceof Error ? failure.message : 'Kunne ikke lage tokenet.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (record: AgentTokenRecord): Promise<void> => {
    try {
      await store.revoke(record.id)
      notify.success(`«${record.name}» er trukket tilbake.`)
      refresh()
    } catch (failure) {
      notify.error(failure instanceof Error ? failure.message : 'Kunne ikke trekke tilbake tokenet.')
    }
  }

  const remove = async (record: AgentTokenRecord): Promise<void> => {
    try {
      await store.remove(record.id)
      refresh()
    } catch (failure) {
      notify.error(failure instanceof Error ? failure.message : 'Kunne ikke slette tokenet.')
    }
  }

  const endpoint =
    typeof window === 'undefined' ? AGENT_API_BASE_PATH : `${window.location.origin}${AGENT_API_BASE_PATH}`

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Agenttokens"
        description="Nøkler en KI-agent bruker for å styre Slaids gjennom REST-API-et."
        width={720}
        testId="agent-tokens-modal"
        footer={
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Lukk
          </button>
        }
      >
        <p className="tokens__endpoint">
          API-et ligger på <code>{endpoint}</code>. Katalogen over operasjoner står på{' '}
          <code>{endpoint}/operations</code>, og et token sendes som{' '}
          <code>Authorization: Bearer …</code>.
        </p>

        {created && (
          <div className="tokens__secret" data-testid="new-agent-token">
            <p className="tokens__secret-title">
              Tokenet for «{created.name}» vises bare nå. Kopier det inn i agenten din – Slaids
              lagrer bare en hash og kan ikke vise det igjen.
            </p>
            <div className="tokens__secret-row">
              <input
                type="text"
                className="input tokens__secret-value"
                readOnly
                value={created.token}
                aria-label="Nytt agenttoken"
                data-testid="agent-token-value"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void copyToClipboard(created.token).then((ok) => {
                    setCopied(ok)
                    if (!ok) {
                      notify.error('Kunne ikke kopiere automatisk. Merk teksten i feltet og kopier.')
                    }
                  })
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Kopiert' : 'Kopier'}
              </button>
            </div>
          </div>
        )}

        <form
          className="tokens__form"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="field">
            <label htmlFor="agent-token-name">Navn</label>
            <input
              id="agent-token-name"
              type="text"
              className="input"
              value={name}
              maxLength={200}
              placeholder="Hva brukes tokenet til?"
              data-testid="agent-token-name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <fieldset className="tokens__scopes">
            <legend>Hva tokenet får lov til</legend>
            {AGENT_SCOPES.map((scope) => (
              <label key={scope} className="tokens__scope">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  data-testid={`agent-scope-${scope}`}
                  onChange={(event) =>
                    setScopes((current) =>
                      event.target.checked
                        ? AGENT_SCOPES.filter((entry) => entry === scope || current.includes(entry))
                        : current.filter((entry) => entry !== scope),
                    )
                  }
                />
                <span>
                  <code>{scope}</code> – {SCOPE_LABELS[scope]}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="field">
            <label htmlFor="agent-token-expiry">Utløp</label>
            <select
              id="agent-token-expiry"
              className="select"
              value={expiry}
              data-testid="agent-token-expiry"
              onChange={(event) => setExpiry(event.target.value as ExpiryChoice)}
            >
              {EXPIRY_CHOICES.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || name.trim().length === 0 || scopes.length === 0}
            data-testid="create-agent-token"
          >
            <Icon name="plus" /> Lag token
          </button>
        </form>

        <div className="tokens__list">
          {records === null && <p className="tokens__empty">Henter …</p>}
          {error && <p className="tokens__error">{error}</p>}
          {records !== null && !error && records.length === 0 && (
            <p className="tokens__empty">Ingen agenttokens ennå.</p>
          )}
          {(records ?? []).map((record) => {
            const status = statusOf(record, now)
            return (
              <div className="tokens__row" key={record.id} data-testid="agent-token-row">
                <div className="tokens__row-main">
                  <span className="tokens__name">{record.name}</span>
                  <span className={`tokens__status tokens__status--${status.tone}`}>
                    {status.label}
                  </span>
                </div>
                <div className="tokens__meta">
                  {record.scopes.map((scope) => (
                    <code key={scope} className="tokens__scope-tag">
                      {scope}
                    </code>
                  ))}
                </div>
                <div className="tokens__meta">
                  Laget {formatMoment(record.createdAt)} · Sist brukt{' '}
                  {formatMoment(record.lastUsedAt)}
                  {record.expiresAt ? ` · Utløper ${formatMoment(record.expiresAt)}` : ''}
                </div>
                <div className="tokens__row-actions">
                  {!record.revokedAt && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      data-testid="revoke-agent-token"
                      onClick={() => setRevoking(record)}
                    >
                      Trekk tilbake
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    aria-label={`Slett ${record.name}`}
                    onClick={() => setDeleting(record)}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      <ConfirmDialog
        open={revoking !== null}
        title="Trekke tilbake tokenet?"
        message={`«${revoking?.name ?? ''}» slutter å virke med én gang. Raden blir stående, så du fortsatt ser hva tokenet har gjort.`}
        confirmLabel="Trekk tilbake"
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const target = revoking
          setRevoking(null)
          if (target) void revoke(target)
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Slette tokenet?"
        message={`Raden for «${deleting?.name ?? ''}» forsvinner. Auditloggen blir stående, men mister navnet på tokenet den peker på.`}
        confirmLabel="Slett"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) void remove(target)
        }}
      />
    </>
  )
}
