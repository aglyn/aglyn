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

// lockdown-423: exempt — platform-global billing configuration with no org
// subject, feeding the self-serve billing page; the billing surface stays
// whole under a lock so members can see and fix what they owe (see
// billing/checkout).

/**
 * The metered-billing configuration the Billing card cannot read for itself
 * (AGL-1473's console half).
 *
 * `BILL_ORG_LIBRARY_STORAGE_FROM` decides whether THIS month's invoice
 * includes the org library's stored bytes, and it is a server env var — the
 * estimate card is a client component, so without this route it would have to
 * either guess or grow a `NEXT_PUBLIC_` mirror that can drift from what the
 * rollup actually bills. One env var, two readers, one evaluator: the raw
 * value is returned VERBATIM and both the rollup and the card pass it through
 * `billsOrgLibraryStorage`, so the fail-closed month parsing cannot fork.
 *
 * Bearer-authenticated like the other self-serve billing reads, but with no
 * org subject and no email-verified gate: the payload is one platform-wide
 * month string, not anyone's data, and a card that cannot reach this route
 * fails HIGH (it includes the library in the estimate) — so refusing an
 * unverified session here would only make its estimate overstate.
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
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    await firebaseAdmin.app().auth().verifyIdToken(idToken)
    return Response.json(
      {
        orgLibraryBilledFrom:
          process.env.BILL_ORG_LIBRARY_STORAGE_FROM ?? null,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
