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

import { pluginRequestFromWeb, supportForPlan } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  isPlausibleEmail,
  readSuccessManager,
  writeSuccessManager,
} from '../../_lib/success-manager'

/**
 * Appointing an org's named success manager (AGL-2332).
 *
 * `support-tiers.md` promises Enterprise a named success manager and the
 * console tells the customer they are copied on every ticket. Until now
 * there was no field naming anyone and no way to name them — the claim rested
 * on a bare `namedManager: true` in the tier table. A capability nobody can
 * exercise is not a feature, so the assignment needs a surface, and this is
 * the one the staff org page posts to.
 *
 * **Staff only, and stored out of the org doc's reach.** The org document's
 * `allow update` rules are deny-lists, so a `support` key on it would be
 * writable by any org owner or admin — an admin could appoint themselves and
 * the console would then say, truthfully, that their own success manager is
 * copied on every ticket. `orgs/{orgId}/support/manager` has no rules `match`
 * at all, which is a default deny for every client and needs no rules deploy.
 *
 * `role` is deliberately plain `staff`, not `super`: this is support
 * bookkeeping, not a billing or entitlement override. It is audited either
 * way.
 */
async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    body,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const orgId = String((method === 'GET' ? query['orgId'] : body?.orgId) ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    if (method === 'GET') {
      const orgSnapshot = await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .get()
      const commitment = supportForPlan(
        (orgSnapshot.get('plan') as never) ?? null,
      )
      return Response.json(
        {
          manager: await readSuccessManager(orgId),
          // What the org is OWED, so the staff page can say whether an
          // unassigned manager is an outstanding promise or simply not
          // something this tier includes.
          promised: commitment.namedManager,
        },
        { status: 200 },
      )
    }

    if (method === 'POST') {
      const name = String(body?.name ?? '')
        .trim()
        .slice(0, 120)
      const email = String(body?.email ?? '')
        .trim()
        .slice(0, 200)
      // An empty email is the CLEAR action — un-appointing is a real thing
      // that has to be possible, and it is the only way to take the console's
      // sentence back down honestly when somebody leaves.
      if (!email) {
        await writeSuccessManager(orgId, null, decoded.uid)
        return Response.json({ ok: true, manager: null }, { status: 200 })
      }
      if (!isPlausibleEmail(email)) {
        return Response.json(
          { error: 'That does not look like an email address' },
          { status: 400 },
        )
      }
      if (!name) {
        // The whole promise is a NAMED human. An address with no name would
        // render the console's sentence as an email address, which is not
        // what anybody was sold.
        return Response.json(
          { error: 'A named manager needs a name' },
          { status: 400 },
        )
      }
      await writeSuccessManager(orgId, { name, email }, decoded.uid)
      return Response.json(
        { ok: true, manager: { name, email } },
        { status: 200 },
      )
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: 'Success manager request failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
