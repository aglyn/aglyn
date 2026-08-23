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

import { Alert } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  probePublicRead,
  type PublicReadProbe,
} from '../utils/probe-public-read'
import {
  subscribeSessionHealth,
  type SessionHealthState,
} from '../utils/session-health'
import {
  captureReauthIdentity,
  clearSessionReauth,
  getSessionReauth,
  requestSessionReauth,
} from '../utils/session-reauth'

/**
 * The stale-session watcher (AGL-1063, AGL-1143, AGL-2486).
 *
 * The user-visible half of the AGL-1062 diagnosis: a session whose server
 * reads are all denied leaves the console half-working — cached pages look
 * normal, one-shot pages render empty states, the shell and nav render, and
 * nothing says the session is the problem. The reasonable reading of that is
 * "my media is gone", not "I need to sign in again".
 *
 * ## Why this is no longer a banner (AGL-2486)
 *
 * It used to say so in a sticky amber Alert with a **Sign in again** button.
 * Two things were wrong with that. It described a problem instead of
 * offering the fix — the remedy was one more click away, behind a banner
 * people learn to scroll past. And it was the SECOND thing on screen saying
 * it: every list that failed to load already rendered its own "could not be
 * loaded" notice, so the same fact was told twice and neither telling was
 * the fix. The console now opens the re-auth dialog itself, which is the
 * thing that heals it (AGL-664), and the per-list notice keeps only the
 * fact it alone knows — that THAT list is incomplete.
 *
 * The original objection to a modal — "blocking a page on a heuristic is
 * worse than the silence it replaces" — is answered by the two gates below
 * rather than abandoned. The dialog is dismissible, it never signs anyone
 * out, and unsaved work stays on screen behind it.
 *
 * ## Which signal opens it — and which look identical but must not
 *
 * `permission-denied` covers three different failures with one code, and
 * only the first is a dead session:
 *
 *   1. **A dead session.** Every server read is refused while
 *      `persistentLocalCache` keeps listeners painting. `session-health`
 *      requires {@link SESSION_STALE_MIN_COLLECTIONS} DISTINCT collections
 *      to exhaust their retries inside its window, which is what separates
 *      this from the AGL-216 sign-in race and from a scoped collaborator
 *      reading the one collection AGL-1041 hides from them — their other
 *      collections keep being answered and clear the evidence outright.
 *   2. **App Check refusing in front of the rules.** Indistinguishable from
 *      a rules verdict at the client, and the opposite response: signing in
 *      again fixes nothing and destroys the evidence (AGL-1143). Measured,
 *      not guessed, by reading the one unconditionally public collection —
 *      if THAT is denied too, the refusal is not about this user.
 *   3. **Offline / a network blip.** The probe comes back with no permission
 *      verdict at all. Not a dead session; a modal here would interrupt an
 *      edit over a dropped wifi connection.
 *
 * So the dialog opens on case 1 ONLY: stale evidence AND a public read that
 * SUCCEEDED. Case 2 keeps a banner, because "signing in will not help" is a
 * diagnosis the user can get nowhere else and has no dialog to offer. Case 3
 * says nothing here — the failing surfaces already say they are incomplete,
 * and the probe verdict is still logged.
 *
 * ## It opens ONCE per episode
 *
 * `requestSessionReauth` re-opens a dismissed dialog by design, because
 * every other caller is a one-shot or an explicit click. This one is driven
 * by a heuristic that keeps firing for as long as the session stays dead, so
 * it latches: one automatic prompt per episode, and an episode ends only
 * when a read actually REACHES THE SERVER (`serverReads` moves). "Not now"
 * therefore survives every subsequent failed read — including a client-side
 * navigation, which keeps this component mounted — and the dialog cannot
 * come back until the session has demonstrably recovered and gone bad again.
 *
 * A full page LOAD does re-prompt, because both stores are module state and
 * reset with it. That is the right reading of the event rather than a hole:
 * loading the console afresh is a new decision to work, and the first two
 * reads of the new page failing is new evidence, not the old evidence
 * repeating.
 */
export function SessionHealthBanner() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  // Which layer is refusing us — measured, not guessed (AGL-1143).
  const [probe, setProbe] = useState<PublicReadProbe | null>(null)
  const [health, setHealth] = useState<SessionHealthState>({
    staleSession: false,
    deniedCollections: [],
    serverReads: 0,
  })
  /**
   * `serverReads` as of the last automatic prompt; `null` = never prompted.
   *
   * A ref rather than state on purpose: it must not re-render anything, and
   * it must be written in the same tick it is read so a second subscription
   * publish in the same episode cannot slip a second prompt through.
   */
  const promptedAt = useRef<number | null>(null)
  /** Applies to the App Check banner below, which is the only thing shown. */
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => subscribeSessionHealth(setHealth), [])

  // Re-arm the measurement when the evidence clears, so a later recurrence
  // is diagnosed afresh rather than inheriting the previous verdict.
  useEffect(() => {
    if (!health.staleSession) {
      setProbe(null)
      setDismissed(false)
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
   *
   * Since AGL-2486 the probe is also the gate on the dialog, so it runs
   * BEFORE anything is shown rather than alongside it.
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

  /**
   * Open the dialog — case 1 only, once per episode.
   *
   * `probe !== 'ok'` covers the unsettled `null` as well as the two verdicts
   * that must not prompt. That is deliberate rather than incidental:
   * `strictNullChecks` is off repo-wide, so an unsettled value that is
   * allowed to answer a question answers it wrongly, and the question here
   * ("is this user's session the problem?") is one a half-loaded page must
   * not be able to answer at all.
   */
  useEffect(() => {
    if (!health.staleSession || probe !== 'ok') return
    if (promptedAt.current !== null && promptedAt.current >= health.serverReads)
      return
    promptedAt.current = health.serverReads
    requestSessionReauth('stale', captureReauthIdentity(user as any))
  }, [health.staleSession, health.serverReads, probe, user])

  /**
   * Stand down when the session comes back.
   *
   * A read reached the server, so whatever we prompted about is over: a
   * dialog still sitting on screen (or dismissed and waiting behind the
   * degraded lists) is now asking for a sign-in nobody needs. Only OUR
   * reason is cleared — an `idle`/`revoked`/`signed-out` prompt is a
   * deliberately dead session and no successful cached-path read may
   * dismiss it.
   */
  useEffect(() => {
    if (health.staleSession) return
    if (getSessionReauth().reason === 'stale') clearSessionReauth()
  }, [health.staleSession])

  // A public read being denied too means the refusal is in front of the
  // rules, so this is not the user's session and signing in again does
  // nothing. Offering that would send them through a sign-out that destroys
  // the evidence and changes nothing — the AGL-1062 trap, with the console
  // doing the misleading this time (AGL-1143). It is also the ONE case with
  // no dialog to open, which is why it is the one case still shown here.
  if (!health.staleSession || probe !== 'denied' || dismissed) return null

  return (
    <Alert
      severity="error"
      sx={{ borderRadius: 0, position: 'sticky', top: 0, zIndex: 1400 }}
      onClose={() => setDismissed(true)}
    >
      {'The console cannot reach your data right now. This is not your ' +
        'account and not your session — signing in again will not help, ' +
        'and nothing has been deleted. It usually clears on its own; if it ' +
        'does not, contact support and mention that public reads are being ' +
        'denied.'}
    </Alert>
  )
}
SessionHealthBanner.displayName = 'SessionHealthBanner'

export default SessionHealthBanner
