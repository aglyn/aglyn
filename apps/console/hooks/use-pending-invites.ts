/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

export interface PendingInvite {
  $id: string
  orgId: string | null
  orgName: string | null
  orgSlug?: string | null
  role: string | null
}

export interface PendingInvitesState {
  invites: PendingInvite[]
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * The one pending-invites list the console shell shares (AGL-3402), so the
 * banner, the accept/decline dialog and the pages that react to an invite
 * (the workspace chooser, the sites zero-state) all see an answer the moment
 * any one of them records it. Null outside `PendingInvitesProvider`.
 */
export const PendingInvitesContext = createContext<PendingInvitesState | null>(
  null,
)

/**
 * Fetches the signed-in user's pending invites. Best-effort: a failed fetch
 * resolves to an empty list rather than throwing — the team page remains the
 * authoritative invite list.
 *
 * Re-read when the tab comes back into view, because an invite sent while the
 * console sat open would otherwise wait for a reload to reach the banner.
 * `enabled: false` is the shape a caller inside the provider takes, so the
 * shared list is the only one fetched.
 */
export function usePendingInvitesSource(enabled = true): PendingInvitesState {
  const { data: user } = useUser()
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      const response = await authorizedFetch(user, '/api/orgs/invites?mine=1')
      // A refusal — the route's, or an unobtainable token — empties the list
      // rather than leaving somebody else's invitations on screen.
      if (!response.ok) return void setInvites([])
      const payload = await response.json()
      setInvites(
        (payload.invites ?? []).filter((invite: PendingInvite) => invite.orgId),
      )
    } catch {
      // best-effort; leave the last known list in place
    } finally {
      setLoading(false)
    }
  }, [user, enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, enabled])

  return useMemo(() => ({ invites, loading, refresh }), [invites, loading, refresh])
}

/**
 * Pending organization invites (AGL-234) for the signed-in user: the shell's
 * shared list inside `PendingInvitesProvider`, else a list of its own.
 */
export function usePendingInvites(): PendingInvitesState {
  const shared = useContext(PendingInvitesContext)
  const own = usePendingInvitesSource(shared === null)
  return shared ?? own
}

/** Which invitation the accept/decline dialog is about. */
export interface InviteReviewTarget {
  orgId: string
  inviteId: string
  /** Open straight on the decline confirmation (the banner's Decline). */
  decline?: boolean
}

export interface InviteReviewState {
  /** Opens the accept/decline dialog for one invitation. */
  review: (target: InviteReviewTarget) => void
  /**
   * Declares that the page renders the invites itself, so the shell banner
   * steps aside while it is mounted. Returns the release.
   */
  claimInline: () => () => void
  /** How many mounted surfaces render the invites inline. */
  inlineClaims: number
}

export const InviteReviewContext = createContext<InviteReviewState>({
  review: () => undefined,
  claimInline: () => () => undefined,
  inlineClaims: 0,
})

export function useInviteReview(): InviteReviewState {
  return useContext(InviteReviewContext)
}

export default usePendingInvites
