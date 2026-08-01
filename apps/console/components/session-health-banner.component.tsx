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

import { Alert, Button } from '@mui/material'
import { signOut } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { useAuth, useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { markInteractiveSignOut } from '../utils/interactive-signin'
import {
  probePublicRead,
  type PublicReadProbe,
} from '../utils/probe-public-read'
import {
  subscribeSessionHealth,
  type SessionHealthState,
} from '../utils/session-health'

/**
 * "Your session needs refreshing" (AGL-1063).
 *
 * The user-visible half of the AGL-1062 diagnosis: a session whose server
 * reads are all denied leaves the console half-working — cached pages look
 * normal, one-shot pages render empty states, the shell and nav render, and
 * nothing says the session is the problem. The reasonable reading of that is
 * "my media is gone", not "I need to sign in again".
 *
 * A banner rather than a toast, because the state persists and a toast is
 * missable; a banner rather than a modal, because the trigger is a heuristic
 * and blocking a page — or signing someone out — on a heuristic is worse
 * than the silence it replaces. Signing in again is offered, never forced,
 * and unsaved work stays on screen until the user chooses.
 *
 * See `session-health` for why two distinct collections is the bar.
 */
export function SessionHealthBanner() {
  const { data: user } = useUser()
  const auth = useAuth()
  const firestore = useFirestore()
  // Which layer is refusing us — measured, not guessed (AGL-1143).
  const [probe, setProbe] = useState<PublicReadProbe | null>(null)
  const [health, setHealth] = useState<SessionHealthState>({
    staleSession: false,
    deniedCollections: [],
  })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => subscribeSessionHealth(setHealth), [])

  // Re-arm when the evidence clears (a successful server read) so a later
  // recurrence is not silenced by an earlier dismissal.
  useEffect(() => {
    if (!health.staleSession) {
      setDismissed(false)
      setProbe(null)
    }
  }, [health.staleSession])

  /**
   * Capture which credential went bad, while it is still reproducible.
   *
   * AGL-1062 could not answer this retrospectively — re-authenticating
   * destroyed the evidence — and that one missing fact is what turned a
   * ten-minute diagnosis into hours. A forced token refresh is the cheap
   * discriminator: if it FAILS the ID token is the problem.
   *
   * If it SUCCEEDS, this used to say "suspect App Check or the session
   * cookie" and stop there. AGL-1143 turned that hint into a measurement:
   * reading the one unconditionally public collection separates a refusal
   * BY the rules from a refusal in FRONT of them, and those need opposite
   * responses. Both facts are logged together, because the pair is what
   * identifies the layer — either alone is ambiguous.
   */
  useEffect(() => {
    if (!health.staleSession || !user) return
    let active = true
    void (async () => {
      const result = await (user as any)
        ?.getIdTokenResult?.()
        .catch(() => null)
      const refreshed = await (user as any)
        ?.getIdToken?.(true)
        .then(() => true)
        .catch((error: unknown) => error)
      const publicRead = await probePublicRead(firestore)
      if (!active) return
      setProbe(publicRead.outcome)
      console.error(
        'Session health: server reads denied across ' +
          `${health.deniedCollections.length} collections ` +
          `(${health.deniedCollections.join(', ')}).`,
        {
          uid: (user as any)?.uid,
          tokenExpiresAt: result?.expirationTime ?? 'unknown',
          tokenIssuedAt: result?.issuedAtTime ?? 'unknown',
          authTime: result?.authTime ?? 'unknown',
          forcedRefresh: refreshed === true ? 'ok' : refreshed,
          publicRead: publicRead.outcome,
          publicReadCode: publicRead.code,
          hint:
            refreshed === true
              ? publicRead.hint
              : 'ID token refresh FAILED — the sign-in itself is dead.',
        },
      )
    })()
    return () => void (active = false)
  }, [health.staleSession, health.deniedCollections, user, firestore])

  if (!health.staleSession || dismissed) return null

  // A public read being denied too means the refusal is in front of the
  // rules, so this is not the user's session and signing in again does
  // nothing. Offering that button anyway would send them through a sign-out
  // that destroys the evidence and changes nothing — the AGL-1062 trap, with
  // the console doing the misleading this time (AGL-1143).
  const notTheSession = probe === 'denied'

  return (
    <Alert
      severity={notTheSession ? 'error' : 'warning'}
      sx={{ borderRadius: 0, position: 'sticky', top: 0, zIndex: 1400 }}
      onClose={() => setDismissed(true)}
      action={
        notTheSession ? null : (
        <Button
          color="inherit"
          size="small"
          onClick={() => {
            // Same contract as the impersonation exit: mark the sign-out as
            // intentional so the session hook retires the shared cookie
            // instead of restoring from it (AGL-543).
            markInteractiveSignOut()
            void signOut(auth).then(() =>
              window.location.assign(
                `/signin?continue=${encodeURIComponent(
                  window.location.pathname + window.location.search,
                )}`,
              ),
            )
          }}
        >
          {'Sign in again'}
        </Button>
        )
      }
    >
      {notTheSession
        ? 'The console cannot reach your data right now. This is not your ' +
          'account and not your session — signing in again will not help, ' +
          'and nothing has been deleted. It usually clears on its own; if it ' +
          'does not, contact support and mention that public reads are being ' +
          'denied.'
        : 'Your session needs refreshing — this account can no longer read ' +
          'your data from the server, so pages may be empty or out of date. ' +
          'Nothing has been deleted. Signing in again fixes it.'}
    </Alert>
  )
}
SessionHealthBanner.displayName = 'SessionHealthBanner'

export default SessionHealthBanner
