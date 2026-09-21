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

import { hostPublicOrigin, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { ENTRY_PREVIEW_PARAM } from '@aglyn/aglyn/app-utils/entry-preview-link'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  hostContentEditRefusal,
  isImpersonationSession,
  mintCollectionPreviewToken,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * Mint a live-site preview link for ONE not-yet-published collection entry
 * (AGL-3205).
 *
 * The console cannot answer "let me see the draft on the site" with a session:
 * it lives on `app.aglyn.com` and the site lives on `aglyn.com`, a
 * `.aglyn.app` subdomain or the customer's own domain — different registrable
 * domains, storage-partitioned, no shared cookie. What crosses is a URL, so
 * this route hands back a signed, two-hour, single-entry capability and the
 * tenant verifies it server-side before it loads anything withheld.
 *
 * Authorization is the SAME question the edit bar asks, minus the edit bar's
 * own release flag: a role on THIS host that may write content, or an org role
 * above viewer held org-wide, plus the lockdown verdict. Someone who could
 * publish this post may look at it early; nobody else may.
 *
 * The response carries the URL fully formed. The ORIGIN is resolved here from
 * the host document rather than accepted from the caller — a caller-chosen
 * origin would put a valid signature on a link pointing anywhere — and it is
 * the site's canonical public origin, which is also what keeps the preview off
 * the tenant's canonical-domain redirect.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  const collectionSlug = String(body?.collectionSlug ?? '').trim()
  const entrySlug = String(body?.entrySlug ?? '').trim()
  if (!hostId || !collectionSlug || !entrySlug) {
    return Response.json(
      { error: 'Missing hostId, collectionSlug or entrySlug' },
      { status: 400 },
    )
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()

    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const orgId = host.get('orgId') as string | undefined
    if (!orgId) {
      return Response.json(
        { error: 'Site has no organization' },
        { status: 409 },
      )
    }
    // lockdown-423: via libs/tenant/data/admin/src/lib/server/edit-access-authz.ts
    // — hostContentEditRefusal runs lockdownRefusal at intent 'write'.
    //
    // `write`, on a route that only signs a string, for the reason the edit
    // bar's mint records: what the link buys is a look at content a read-only
    // lock has frozen, and it outlives this check by its whole TTL. A site
    // whose writes are suspended should not be handing out fresh windows onto
    // the work in progress.
    const refusal = await hostContentEditRefusal({
      request,
      firestore,
      host,
      orgId,
      uid: decoded.uid,
      staff: decoded['staff'] === true,
    })
    if (refusal) return refusal

    // The site's own public address. A host with no public origin at all has
    // no page to preview, so there is nothing to sign.
    const origin = hostPublicOrigin({
      cname: host.get('cname') as string | undefined,
      subdomain: host.get('subdomain') as string | undefined,
    })
    if (!origin) {
      return Response.json(
        { error: 'Site has no public address yet' },
        { status: 409 },
      )
    }

    const { token, expiresAtMs } = mintCollectionPreviewToken({
      hostId,
      collectionSlug,
      entrySlug,
    })
    // Each segment encoded on its own: a slug carrying a slash or a question
    // mark would otherwise rewrite the address it is supposed to be part of.
    const path = `/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(entrySlug)}`
    const url = `${origin}${path}?${ENTRY_PREVIEW_PARAM}=${encodeURIComponent(token)}`
    return Response.json({ url, expiresAtMs }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json(
      { error: 'Could not create a preview link' },
      { status: 500 },
    )
  }
}

export const POST = handler
