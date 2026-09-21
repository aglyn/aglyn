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

import ReadGatedEmptyState, {
  type ReadGatedEmptyStateProps,
} from '@aglyn/shared-ui-jsx/components/read-gated-empty-state.component'
import { Button } from '@mui/material'
import { useEffect, useState } from 'react'
import {
  getSessionReauth,
  reopenSessionReauth,
  subscribeSessionReauth,
  type SessionReauthState,
} from '../utils/session-reauth'

export type EmptyStateProps = Omit<
  ReadGatedEmptyStateProps,
  'degradedAction'
>

/**
 * The console's read-gated zero-state: `ReadGatedEmptyState` with the one
 * thing only this app can supply.
 *
 * The block itself moved to `@aglyn/shared-ui-jsx` in AGL-3080 so a plugin's
 * list surface could state the same rule — the gate is about EVIDENCE, and a
 * plugin's list is as capable of asserting an emptiness it never read as the
 * console's was (AGL-1066). What stayed is this: the session store.
 *
 * ## Why the re-auth affordance is here and not in the library
 *
 * The degraded branch normally offers `onRetry`, and for almost every failed
 * read that is the right button. It is the WRONG button for exactly one
 * cause: a stale session, where every server read is being refused and
 * retrying is an invitation to fail. AGL-2486's fix was to offer the way back
 * into the sign-in dialog instead — but only when the prompt is up and
 * DISMISSED, because an undismissed prompt is already on screen and a live
 * session has nothing to fix.
 *
 * That verdict is read from the store that owns it, never inferred from this
 * list's own denial (AGL-1179), and the store is the console's. A library
 * that reached for it would be a library that only one app can use; a
 * `degradedAction` prop is the same behaviour with the knowledge left where
 * it lives.
 *
 * A plugin surface therefore gets the retry button rather than this one. It
 * is the honest answer for a caller that cannot see the session, and the
 * console's own re-auth dialog is mounted above every authenticated page
 * regardless (`authenticated.layout.tsx`), so the way back does not depend on
 * this button existing.
 */
export function EmptyState(props: EmptyStateProps) {
  const [reauth, setReauth] = useState<SessionReauthState>(getSessionReauth)
  useEffect(() => subscribeSessionReauth(setReauth), [])
  // Both halves matter: `stale` is the only reason whose dialog leaves the
  // user signed in and the page usable, and `dismissed` is what means the
  // way back in has gone. An UNdismissed prompt is already on screen.
  const dismissedStalePrompt =
    reauth.reason === 'stale' && reauth.dismissed === true

  return (
    <ReadGatedEmptyState
      {...props}
      degradedAction={
        dismissedStalePrompt ? (
          // Retrying is what cannot work here — every server read is being
          // refused — so the button offers the thing that does.
          <Button color="inherit" size="small" onClick={reopenSessionReauth}>
            {'Sign in again'}
          </Button>
        ) : undefined
      }
    />
  )
}

EmptyState.displayName = 'EmptyState'
EmptyState.aglyn = true

export default EmptyState
