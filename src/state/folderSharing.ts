/**
 * Which folders are shared, and to which link — for the library's folder list.
 *
 * Kept out of the `Folder` domain object for the reason `state/sharing.ts`
 * gives for presentations: sharing is a fact about the row in the database,
 * not about the folder, so it is never exported, imported or copied with it.
 *
 * Nothing here is guessed. A folder's state only ever comes from what the
 * server confirmed, so a switch cannot show "on" for a publication that did
 * not happen.
 */

import { useCallback, useEffect, useState } from 'react'
import { folderSharing, isSharingSupported } from '../persistence/activeRepository'
import type { ShareState } from '../persistence/repository'
import { folderShareUrl } from '../routing'
import { notify } from './toast'

export type FolderSharingStatus = 'unsupported' | 'loading' | 'ready' | 'error'

const NOT_SHARED: ShareState = { shared: false, token: null }

export interface FolderSharing {
  status: FolderSharingStatus
  /** The confirmed state of one folder. A folder the server did not list is not shared. */
  stateOf: (folderId: string) => ShareState
  /** The folder a publish or revoke is in flight for; a second one is refused meanwhile. */
  busyFolderId: string | null
  setShared: (folderId: string, shared: boolean) => Promise<void>
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** `reloadToken` is the library's own: a refresh of the library rereads this too. */
export function useFolderSharing(reloadToken: number): FolderSharing {
  const supported = isSharingSupported()
  const [status, setStatus] = useState<FolderSharingStatus>(supported ? 'loading' : 'unsupported')
  const [states, setStates] = useState<Record<string, ShareState>>({})
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null)

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    folderSharing
      .listFolderShareStates()
      .then((next) => {
        if (cancelled) return
        setStates(next)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [supported, reloadToken])

  const stateOf = useCallback((folderId: string) => states[folderId] ?? NOT_SHARED, [states])

  const setShared = useCallback(
    async (folderId: string, shared: boolean) => {
      if (!supported || busyFolderId) return
      setBusyFolderId(folderId)
      try {
        const next = shared
          ? await folderSharing.enableFolderSharing(folderId)
          : await folderSharing.disableFolderSharing(folderId)
        setStates((current) => ({ ...current, [folderId]: next }))
        setStatus('ready')
      } catch (error) {
        notify.error(
          describe(error, shared ? 'Kunne ikke dele mappen.' : 'Kunne ikke slå av delingen av mappen.'),
        )
      } finally {
        setBusyFolderId(null)
      }
    },
    [supported, busyFolderId],
  )

  return { status, stateOf, busyFolderId, setShared }
}

/** The address to hand out, or `null` when there is nothing live to hand out. */
export function folderShareLink(state: ShareState): string | null {
  if (!state.shared || !state.token || typeof window === 'undefined') return null
  return folderShareUrl(window.location.origin, state.token)
}
