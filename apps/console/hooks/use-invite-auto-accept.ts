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

import { createContext, useContext } from 'react'

/**
 * Where each automatic join stands (AGL-4023), keyed by invite id.
 *
 * - `joining`: the accept request is in flight.
 * - `joined`: the server accepted it; the membership is on its way.
 * - `failed`: the server refused it, because the workspace changed after the
 *   invitation was sent (a seat removed, say). The sender has been told; the
 *   invitee waits, and the next visit tries again.
 */
export type InviteAutoAcceptStatus = 'joining' | 'joined' | 'failed'

export interface InviteAutoAcceptState {
  /**
   * Whether invitations are joined automatically in this session: `false`
   * for staff impersonation, `null` until the session's claims are read.
   */
  enabled: boolean | null
  statusOf: (inviteId: string) => InviteAutoAcceptStatus | undefined
  /** Workspace slugs joined in this tab, kept until their membership arrives. */
  joinedSlugs: ReadonlySet<string>
  /**
   * An automatic join in this tab is in flight, or has succeeded (AGL-4047).
   * The accepted invitation leaves the pending list before its membership
   * reaches the workspace list, and the home page reads this so that gap
   * never looks like an account with no invitation and no workspace.
   */
  joining: boolean
}

export const InviteAutoAcceptContext = createContext<InviteAutoAcceptState>({
  enabled: false,
  statusOf: () => undefined,
  joinedSlugs: new Set(),
  joining: false,
})

export function useInviteAutoAccept(): InviteAutoAcceptState {
  return useContext(InviteAutoAcceptContext)
}

/**
 * Whether an automatic join should also open the workspace: only when the
 * person is already on one of its pages (the link they were invited by) or on
 * the console home. Anyone working in another workspace stays where they are.
 *
 * On the home page only the NEWEST invitation opens (AGL-4047): with two
 * waiting, each join used to navigate and whichever answered last won.
 */
export function autoJoinOpensWorkspace(
  pathname: string,
  orgSlug: string | null | undefined,
  newest = true,
): boolean {
  if (pathname === '/' || pathname === '') return newest
  if (!orgSlug) return false
  return pathname === `/${orgSlug}` || pathname.startsWith(`/${orgSlug}/`)
}
