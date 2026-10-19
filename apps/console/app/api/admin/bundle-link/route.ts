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
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  BundleLinkError,
  domainsRegistrarConfigured,
  mintBundleLink,
} from '@aglyn/tenant-data-admin/server/bundle-links'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Staff mint a bundle checkout link for one workspace (AGL-3955).
 *
 * `POST` validates the bundle (plan, add-ons, cadence, coupon, and an
 * optional domain quoted from the registrar's search), writes the
 * `bundleLinks` record and its `billing.bundle-link-minted` audit row in one
 * batch, and answers the URL the staff page copies and draws as a QR. The
 * record lives 24 hours and pre-clears the domains plugin's invoice-age gate
 * for one purchase; the link's Billing preselection needs no record at all.
 *
 * `GET` answers whether this deployment sells domains, so the dialog can
 * show the domain line disabled with the reason when it does not.
 *
 * Staff only, and written through the Admin SDK: the rules deny the
 * collection to every client.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (decoded['staff'] !== true) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    if (method === 'GET') {
      return Response.json({ domainsAvailable: domainsRegistrarConfigured() }, { status: 200 })
    }

    const orgId = String(body?.orgId ?? '')
    if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
    const origin = headers.origin ?? `https://${headers.host}`
    const minted = await mintBundleLink({
      orgId,
      actor: { uid: decoded.uid, email: decoded.email ?? null },
      origin,
      plan: body?.plan,
      addons: body?.addons,
      interval: body?.interval,
      coupon: body?.coupon,
      domain: body?.domain && typeof body.domain === 'object' ? body.domain : null,
    })
    return Response.json({ ok: true, ...minted }, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    if (error instanceof BundleLinkError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
    return Response.json({ error: 'The bundle link could not be made' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
