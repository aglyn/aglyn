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

import {
  firebaseAdmin,
  isEditHintDeviceId,
  recordEditHintEnded,
} from '@aglyn/tenant-data-admin'
import { readCookie } from '../auth/read-cookie'
import { parseSignedOut } from '../auth/session/session-tombstone'
import { DEVICE_COOKIE } from './device-registry'

/**
 * The console half of "signing out ends the site edit bar in this browser"
 * (AGL-1842 follow-on; the tenant half is `edit-hint-end.ts` in the admin
 * lib, where the record and the refusal rule live).
 *
 * The browser is named by the `aglyn_device` cookie the session route already
 * keeps on every signed-in console browser: shared across workspace
 * subdomains exactly like `__session`, so a sign-out on `acme.aglyn.com` ends
 * the hint planted from `app.aglyn.com` in the same browser. No new cookie.
 */

/** This browser's device id, when it has a usable one. */
export function editHintDeviceId(request: Request): string | undefined {
  const deviceId = readCookie(request, DEVICE_COOKIE)
  return isEditHintDeviceId(deviceId) ? deviceId : undefined
}

/**
 * Records that the session in `sessionCookie` signed out of THIS browser, so
 * the tenant refuses every hint and hint-bought token minted here before now.
 *
 * Runs on `DELETE /api/auth/session`, the one place every deliberate sign-out
 * converges (the `/signout` page, the idle timeout, the reauth dialog's
 * "sign out", the impersonation exit). The uid comes from the session cookie
 * the DELETE is about to retire, VERIFIED, never from the request: an
 * unauthenticated caller can write nothing.
 *
 * Never throws and never decides the sign-out: signing out must always work,
 * so a failure here is logged and the DELETE answers as before.
 */
export async function endEditHintForBrowser(
  request: Request,
  session: { cookie: string | undefined; tenantId: string | undefined },
): Promise<void> {
  try {
    const deviceId = editHintDeviceId(request)
    // No device id, no hint to end: the blob route mints none without one.
    // A tombstone means this browser's sign-out already ran and recorded it.
    if (!deviceId || !session.cookie || parseSignedOut(session.cookie)) return
    const auth = firebaseAdmin.app().auth()
    const sessionAuth = session.tenantId
      ? auth.tenantManager().authForTenant(session.tenantId)
      : auth
    let uid: string
    try {
      // Checked against the account, the same call the session exchange
      // makes, so a DELETED account writes nothing: closing an account ends
      // on `/signout`, and a record written there would outlive the erasure.
      uid = (await sessionAuth.verifySessionCookie(session.cookie, true)).uid
    } catch (error) {
      // A session revoked elsewhere still names its owner, and ending its
      // hint is still right.
      if ((error as { code?: string })?.code !== 'auth/session-cookie-revoked') {
        throw error
      }
      uid = (await sessionAuth.verifySessionCookie(session.cookie)).uid
    }
    await recordEditHintEnded(firebaseAdmin.app().firestore(), uid, deviceId)
  } catch (error) {
    // An expired or garbled cookie names nobody, so there is nobody's hint to
    // end, and nothing worth a log line.
    const code = (error as { code?: string })?.code
    if (typeof code === 'string' && code.startsWith('auth/')) return
    console.error(
      '[auth/session] edit hint not ended at sign-out',
      JSON.stringify({
        code,
        message: (error as { message?: string })?.message,
      }),
    )
  }
}
