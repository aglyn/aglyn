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

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  InviteReviewContext,
  PendingInvitesContext,
  usePendingInvitesSource,
  type InviteReviewState,
  type InviteReviewTarget,
} from '../hooks/use-pending-invites'
import InviteResponseDialog from './invite-response-dialog.component'

/**
 * The console shell's pending invitations (AGL-3402): one shared list, and
 * the one accept/decline dialog that the banner and the notification surfaces
 * open by calling `useInviteReview().review`.
 *
 * Mounted in the authenticated layout, above every route boundary, for the
 * reason the banner is: an invitation has to be answerable from whichever
 * page the person happens to be on.
 */
export function PendingInvitesProvider({ children }: { children: ReactNode }) {
  const pending = usePendingInvitesSource()
  const [target, setTarget] = useState<InviteReviewTarget | null>(null)
  const [inlineClaims, setInlineClaims] = useState(0)

  const claimInline = useCallback(() => {
    setInlineClaims((count) => count + 1)
    return () => setInlineClaims((count) => Math.max(0, count - 1))
  }, [])

  const review = useMemo<InviteReviewState>(
    () => ({ review: setTarget, claimInline, inlineClaims }),
    [claimInline, inlineClaims],
  )

  return (
    <PendingInvitesContext.Provider value={pending}>
      <InviteReviewContext.Provider value={review}>
        {children}
        <InviteResponseDialog target={target} onClose={() => setTarget(null)} />
      </InviteReviewContext.Provider>
    </PendingInvitesContext.Provider>
  )
}
PendingInvitesProvider.displayName = 'PendingInvitesProvider'

export default PendingInvitesProvider
