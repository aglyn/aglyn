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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { DEVICE_LIST_LIMIT, readDeviceRows } from '../../_lib/device-registry'

// lockdown-423: exempt — a read-only view of the caller's OWN sign-in history,
// and the one page somebody is sent to BY a security email. A lockdown that
// hid it would take the review surface away at exactly the moment an incident
// makes it worth reading, while granting nobody any new capability: there is
// no write here, and the answer is already scoped to the caller's own uid.

/**
 * The second half of the new-device email (AGL-2318).
 *
 * `recordDeviceAndMaybeAlert` writes `userAgent`, `deviceName`, `ip`,
 * `location`, `createdAt` and `lastSeenAt` on every sign-in, and read back
 * exactly two things: `snapshot.exists` and `devices.limit(1).get()` — pure
 * existence checks that gate the alert email. Six descriptive fields, written
 * for every sign-in of every account, and no surface anywhere displayed one.
 *
 * So a person received "new sign-in from Chrome on Windows, Dallas, TX" and
 * had NOWHERE TO GO: no list of devices to compare it against, no way to see
 * whether the one before it was theirs. The field names describe a review
 * surface that did not exist, and the data for it was already there.
 *
 * ## Why a route rather than a client read
 *
 * `users/{userId}` grants owner read, but that match covers the DOCUMENT — the
 * rules carry no wildcard, and every subcollection that a client may read
 * (`orgs`, `hostMemberships`, `notifications`, `passkeys`, `legalAcceptances`)
 * is granted by its own explicit block. `devices` has none, so it is
 * default-deny for clients.
 *
 * Adding a block would mean deploying rules by hand, outside the git pipeline,
 * and until that deploy landed the page would read as empty for everyone —
 * indistinguishable from "you have signed in from one device". The Admin SDK
 * behind the caller's own token has neither problem and changes no posture:
 * the answer is scoped to `decoded.uid`, never to a uid from the request.
 *
 * Revocation lives in the sibling `revoke/` route (AGL-1959) rather than as a
 * method here, so that this one stays a pure read: it is the endpoint a
 * security email sends someone to, and a route that both reads and revokes is
 * a route where a bug in the read path can end sessions.
 */

/**
 * The read itself lives in `_lib/device-registry.ts` (AGL-1513): the staff
 * console renders the same history for a support call, and two shapings of the
 * same rows is how one of them quietly loses a field.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const devices = await readDeviceRows(
      firebaseAdmin.app().firestore(),
      // THE TOKEN'S uid, never one from the request. This is the whole access
      // control on the endpoint, and a uid parameter would make it a way to
      // read anyone's sign-in history.
      decoded.uid,
      DEVICE_LIST_LIMIT,
    )

    return Response.json(
      { devices },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[account/devices]', error)
    return Response.json({ error: 'Sign-in history failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
