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

import { Alert, Box, Button, CircularProgress } from '@mui/material'
import { notFound } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { useIsStaff } from '../hooks/use-is-staff'
import {
  getSessionReauth,
  reopenSessionReauth,
  subscribeSessionReauth,
  type SessionReauthState,
} from '../utils/session-reauth'

/**
 * Route-group gate for the whole staff console (AGL-847). Mounted by the
 * `(app)/admin` layout so a non-staff visitor gets the ordinary 404 for the
 * entire area — they should not learn it exists, and should never see the old
 * "grant access with <script>" alert that named the internal grant script.
 *
 * Holds a spinner while the claim is still resolving (`null`, distinct from
 * `false`) so a real staff member never flashes the 404 on the way in.
 *
 * ## …but only while it IS resolving (AGL-3242)
 *
 * `null` is also what `useIsStaff` reports when the claim cannot be read at
 * all — no signed-in user to ask, or a forced token refresh that will not
 * land — and that state does not end on its own. Observed on production: the
 * staff tab strip, which mounts above this route boundary, drawn over a
 * spinner that turned for as long as anybody watched it. The reader is told
 * to wait for something that is not coming.
 *
 * So when the console has already diagnosed a session fault, this says so
 * instead of spinning. The notice names no staff surface and offers nothing a
 * stranger could learn from — it is the same thing any page would say — so
 * the enumeration guard above is untouched: a non-staff reader still gets the
 * 404 the moment a claim is actually readable.
 *
 * This is an enumeration/UX gate, not the security boundary: every
 * `/api/admin/*` handler independently verifies `decoded['staff']`, and
 * Firestore rules gate the underlying data. Hiding the surface just stops a
 * non-staff user from stumbling onto it.
 */
export function StaffGuard({ children }: { children?: ReactNode }) {
  const isStaff = useIsStaff()
  const [reauth, setReauth] = useState<SessionReauthState>(getSessionReauth)
  useEffect(() => subscribeSessionReauth(setReauth), [])

  if (isStaff === null) {
    // A fault the console diagnosed itself — the claim read is not slow, it
    // is blocked on a session that has to come back first.
    if (reauth.reason !== null) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <Alert
            severity="warning"
            // Only once the prompt has been dismissed: an undismissed one is
            // already on screen, and offering a second way to open it would
            // be a button pointing at the dialog covering it.
            action={
              reauth.dismissed ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={reopenSessionReauth}
                >
                  {'Sign in again'}
                </Button>
              ) : undefined
            }
          >
            {'This page is waiting on your session. Signing in again is what ' +
              'releases it — nothing here can load until then.'}
          </Alert>
        </Box>
      )
    }
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (!isStaff) notFound()
  return <>{children}</>
}
StaffGuard.displayName = 'StaffGuard'

export default StaffGuard
