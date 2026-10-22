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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  emailGateWouldRefuse,
  type ClaimSource,
} from '@aglyn/aglyn/app-utils/console/email-verification-gate'

/**
 * Mints the shared `__session` cookie, and reports whether it worked
 * (AGL-1142).
 *
 * Every mint site used to be `try { await fetch(…) } catch {}` with the
 * response discarded, and `mintedForUid` set BEFORE the request. That treats
 * "refused" as "done": `POST /api/auth/session` answers 401 for an
 * unverifiable token or a failed `createSessionCookie`, and 403 for an
 * unverified email — and `await fetch(...)` RESOLVES on all of those rather
 * than throwing, so the catch never ran. Having marked the uid as minted, the
 * tab then never tried again.
 *
 * That is how a sign-out tombstone survives an interactive sign-in, which is
 * the nine-day cookie measured on production 2026-07-31: nothing overwrote it,
 * and nothing noticed.
 *
 * On failure the uid is cleared rather than left set, so a later auth emission
 * gets another attempt — the mint is still best-effort and still never signs
 * anyone out, but a refusal is no longer indistinguishable from success.
 *
 * Exported for the cross-domain handoff (AGL-1902), which mints outside this
 * hook: its landing page has to AWAIT the mint before navigating, and D5's
 * whole lesson from AGL-466 is that a fire-and-forget mint racing a navigation
 * is the redirect loop. Callers with no ref of their own pass
 * `{ current: null }`.
 */
export async function mintSession(
  user: MintUser,
  mintedForUid: { current: string | null },
  options: { forceRefresh?: boolean } = {},
): Promise<boolean> {
  // One sign-in, one mint (AGL-3843). Several places mint on the same landing
  // (this hook, the auth layout's delegated hand-off, the hand-off pages), and
  // each POST made before the first one answered carries no `aglyn_device`
  // cookie yet, so the route records each as a NEW device. A call made while
  // a mint for the same account is in flight shares that request instead.
  const key = `${user.tenantId ?? ''}:${user.uid}`
  let pending = mintsInFlight.get(key)
  if (!pending) {
    pending = requestMint(user, options.forceRefresh === true).finally(() => {
      mintsInFlight.delete(key)
    })
    mintsInFlight.set(key, pending)
  }
  const minted = await pending
  mintedForUid.current = minted ? user.uid : null
  return minted
}

/** The account `mintSession` mints for. */
type MintUser = {
  uid: string
  tenantId?: string | null
  getIdToken: (forceRefresh?: boolean) => Promise<string>
} & ClaimSource

/** Mints in flight, by pool and uid (AGL-3843). */
const mintsInFlight = new Map<string, Promise<boolean>>()

async function requestMint(user: MintUser, forceRefresh: boolean): Promise<boolean> {
  // An unverified session is refused (AGL-479), and the token says so before
  // the request is made — so on the sign-up path this warned, in the voice
  // reserved for a real refusal, about the most ordinary event the console
  // has (AGL-2691). The warning below has to keep meaning something.
  //
  // ⚑ This does forgo the tombstone clear the refusal path performs
  // server-side (AGL-1142), and that is safe HERE and only here: everything
  // a shared cookie unlocks sits behind the same gate that refuses the mint,
  // so a tombstone standing through the unverified window denies access the
  // account does not have. It heals the moment it starts to matter — the
  // verified user hard-navigates, the restore branch below reads
  // `401 signed-out`, `tombstoneEndsSession` finds it older than this
  // account's sign-in, and the re-mint replaces it. Do not extend this to a
  // refusal the token cannot predict; the AGL-1142 nine-day cookie was a
  // VERIFIED account locked out, which this path can no longer produce.
  if (await emailGateWouldRefuse(user)) return false
  try {
    const response = forceRefresh
      ? await authorizedFetch(
          user,
          '/api/auth/session',
          { method: 'POST' },
          { forceRefresh: true },
        )
      : await authorizedFetch(user, '/api/auth/session', { method: 'POST' })
    if (!response.ok) {
      const payload = await response.json().catch((): null => null)
      // Named, like the AGL-467 server-side mint-failure log. A silent refusal
      // here is invisible for as long as the tombstone lives.
      console.warn(
        '[auth/session] mint refused',
        JSON.stringify({
          status: response.status,
          reason: payload?.reason ?? null,
        }),
      )
      return false
    }
    return true
  } catch {
    // Network trouble: still best effort, but do not claim it happened.
    return false
  }
}

export default mintSession
