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

import { useUser } from '@aglyn/tenant-feature-instance'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  InviteAutoAcceptContext,
  autoJoinOpensWorkspace,
  type InviteAutoAcceptState,
  type InviteAutoAcceptStatus,
} from '../hooks/use-invite-auto-accept'
import { useInviteResponse } from '../hooks/use-invite-response'
import { usePendingInvites } from '../hooks/use-pending-invites'

/**
 * Invitations take effect on their own (AGL-4023): the moment a person is in
 * the console with a confirmed address an invitation was sent to, they join.
 * Nobody has to find and press Accept.
 *
 * An invitation sent to an address that already had an account was always
 * honored at once; the ones left pending are for people who signed up AFTER
 * being invited, which is every client handed a workspace. Before this they
 * signed up, followed the email's link, and met a 404 for the workspace they
 * had just been given, with the Accept button in a banner above it.
 *
 * Every acceptance goes through the same request the banner sends, so the
 * server keeps every check it already makes: the address must be confirmed
 * and be one of the account's, the seat quota is charged in the same
 * transaction, and an owner hand-off still runs the single sign-on lockout
 * check. A refusal leaves the invitation pending, with the reason shown, for
 * the banner or the workspace page to answer by hand.
 *
 * Never during a staff impersonation session: that is staff looking at an
 * account, and joining a workspace is the account holder's own act.
 */
export function InviteAutoAcceptProvider({ children }: { children: ReactNode }) {
  const { data: user } = useUser()
  const { invites } = usePendingInvites()
  const { respond } = useInviteResponse()
  const pathname = usePathname() ?? ''
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  const attempted = useRef(new Set<string>())
  const [statuses, setStatuses] = useState<Record<string, InviteAutoAcceptStatus>>({})
  const [joinedSlugs, setJoinedSlugs] = useState<ReadonlySet<string>>(new Set())
  // Unknown until the token's claims are read; unreadable claims fail closed.
  const [impersonating, setImpersonating] = useState<boolean | null>(null)

  const uid = user?.uid
  useEffect(() => {
    setImpersonating(null)
    if (!user) return undefined
    let active = true
    void user
      .getIdTokenResult()
      .then((result) => {
        if (active) setImpersonating(Boolean(result?.claims?.['impersonatedBy']))
      })
      .catch(() => {
        if (active) setImpersonating(true)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the account, not the object
  }, [uid])

  useEffect(() => {
    if (impersonating !== false) return
    for (const invite of invites) {
      if (attempted.current.has(invite.$id)) continue
      attempted.current.add(invite.$id)
      setStatuses((current) => ({ ...current, [invite.$id]: 'joining' }))
      const navigate = autoJoinOpensWorkspace(pathnameRef.current, invite.orgSlug)
      void respond(invite, 'accept', { navigate }).then((accepted) => {
        setStatuses((current) => ({
          ...current,
          [invite.$id]: accepted ? 'joined' : 'failed',
        }))
        const slug = invite.orgSlug
        if (accepted && slug) {
          setJoinedSlugs((current) => new Set(current).add(slug))
        }
      })
    }
  }, [invites, impersonating, respond])

  const value = useMemo<InviteAutoAcceptState>(
    () => ({
      enabled: impersonating === null ? null : !impersonating,
      statusOf: (inviteId) => statuses[inviteId],
      joinedSlugs,
    }),
    [impersonating, statuses, joinedSlugs],
  )

  return (
    <InviteAutoAcceptContext.Provider value={value}>
      {children}
    </InviteAutoAcceptContext.Provider>
  )
}
InviteAutoAcceptProvider.displayName = 'InviteAutoAcceptProvider'

export default InviteAutoAcceptProvider
