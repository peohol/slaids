/**
 * Administrasjon → Brukere.
 *
 * Everything an administrator can do with accounts, on one screen: see who has
 * access, add someone by email, give or take the administrator role, and
 * deactivate or reactivate. There is deliberately nothing else — no password,
 * no invitation, no settings. A new user simply signs in with a code.
 *
 * The screen is a convenience, not a control. Every action goes to the server,
 * which checks that the caller is an active administrator; the database keeps
 * the last one. When either says no, the screen shows the server's sentence.
 *
 * Shares the card list styling with the agent-token screen beside it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminUsersClient, type AdminUser, type MemberChange } from '../../persistence/adminUsers'
import type { SlaidsRole } from '../../persistence/slaidsUsers'
import { notify } from '../../state/toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

export const ROLE_LABELS: Record<SlaidsRole, string> = {
  user: 'Bruker',
  admin: 'Administrator',
}

function formatMoment(iso: string | null): string {
  if (!iso) return 'Aldri'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Aldri'
  return new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

type UsersClient = Pick<AdminUsersClient, 'list' | 'add' | 'update'>

export interface AdminUsersModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The signed-in administrator, so the screen can say «deg». */
  currentUserId: string | null
  /** Injected in tests; the app talks to its own server. */
  client?: UsersClient
}

export function AdminUsersModal({ open, onOpenChange, currentUserId, client }: AdminUsersModalProps) {
  const api = useMemo<UsersClient>(() => client ?? new AdminUsersClient(), [client])

  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<SlaidsRole>('user')
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null)

  const [reloadToken, setReloadToken] = useState(0)
  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.list().then(
      (list) => {
        if (cancelled) return
        setUsers(list)
        setError(null)
      },
      (failure: unknown) => {
        if (cancelled) return
        setUsers([])
        setError(failure instanceof Error ? failure.message : 'Kunne ikke hente brukerne.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, api, reloadToken])

  const add = async (): Promise<void> => {
    const address = email.trim()
    if (busy || address.length === 0) return
    setBusy(true)
    try {
      const user = await api.add(address, role)
      notify.success(
        `${user.email} er lagt til. Personen logger inn på Slaids med e-postadressen sin og får en kode på e-post.`,
      )
      setEmail('')
      setRole('user')
      refresh()
    } catch (failure) {
      notify.error(failure instanceof Error ? failure.message : 'Kunne ikke legge til brukeren.')
    } finally {
      setBusy(false)
    }
  }

  const change = async (user: AdminUser, next: MemberChange, done: string): Promise<void> => {
    setBusy(true)
    try {
      await api.update(user.userId, next)
      notify.success(done)
      refresh()
    } catch (failure) {
      notify.error(failure instanceof Error ? failure.message : 'Kunne ikke endre brukeren.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Brukere"
        description="Hvem som har tilgang til Slaids. Hver bruker har sitt eget private bibliotek – som administrator ser du ikke andres presentasjoner."
        width={640}
        testId="admin-users-modal"
        footer={
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Lukk
          </button>
        }
      >
        <form
          className="tokens__form"
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <div className="admin-users__add">
            <div className="field admin-users__email">
              <label htmlFor="admin-user-email">Legg til bruker</label>
              <input
                id="admin-user-email"
                type="email"
                className="input"
                value={email}
                autoComplete="off"
                placeholder="navn@eksempel.no"
                data-testid="admin-user-email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="admin-user-role">Rolle</label>
              <select
                id="admin-user-role"
                className="select"
                value={role}
                data-testid="admin-user-role"
                onChange={(event) => setRole(event.target.value as SlaidsRole)}
              >
                <option value="user">{ROLE_LABELS.user}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </div>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || email.trim().length === 0}
              data-testid="admin-user-add"
            >
              <Icon name="plus" /> Legg til
            </button>
          </div>
          <p className="tokens__empty">
            Den nye brukeren får et tomt bibliotek og logger inn med en engangskode på e-post. Ingen
            invitasjon sendes.
          </p>
        </form>

        <div className="tokens__list" data-testid="admin-users-list">
          {users === null && <p className="tokens__empty">Henter …</p>}
          {error && (
            <p className="tokens__error" role="alert">
              {error}
            </p>
          )}
          {(users ?? []).map((user) => {
            const self = user.userId === currentUserId
            return (
              <div className="tokens__row" key={user.userId} data-testid="admin-user-row">
                <div className="tokens__row-main">
                  <span className="tokens__name">
                    {user.email}
                    {self ? ' (deg)' : ''}
                  </span>
                  <span className={`tokens__status${user.role === 'admin' ? ' tokens__status--active' : ''}`}>
                    {ROLE_LABELS[user.role]}
                  </span>
                  {!user.active && (
                    <span className="tokens__status tokens__status--revoked">Deaktivert</span>
                  )}
                </div>
                <div className="tokens__meta">Sist innlogget: {formatMoment(user.lastSignInAt)}</div>
                <div className="tokens__row-actions">
                  {user.role === 'admin' ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy}
                      data-testid="admin-user-demote"
                      onClick={() =>
                        void change(user, { role: 'user' }, `${user.email} er ikke lenger administrator.`)
                      }
                    >
                      Fjern administrator
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy}
                      data-testid="admin-user-promote"
                      onClick={() =>
                        void change(user, { role: 'admin' }, `${user.email} er nå administrator.`)
                      }
                    >
                      Gjør til administrator
                    </button>
                  )}
                  {user.active ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      disabled={busy}
                      data-testid="admin-user-deactivate"
                      onClick={() => setDeactivating(user)}
                    >
                      Deaktiver
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy}
                      data-testid="admin-user-reactivate"
                      onClick={() =>
                        void change(user, { active: true }, `${user.email} har tilgang igjen.`)
                      }
                    >
                      Reaktiver
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      <ConfirmDialog
        open={deactivating !== null}
        title="Deaktivere kontoen?"
        message={`${deactivating?.email ?? ''} mister tilgangen med én gang, også på enheter der personen er innlogget, og agenttokens slutter å virke. Presentasjonene blir liggende, og du kan reaktivere kontoen senere.`}
        confirmLabel="Deaktiver"
        onCancel={() => setDeactivating(null)}
        onConfirm={() => {
          const target = deactivating
          setDeactivating(null)
          if (target) void change(target, { active: false }, `${target.email} er deaktivert.`)
        }}
      />
    </>
  )
}
